//! Version-one companion bridge. Never installs/enables a Vencord plugin.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SAFE: u64 = 9_007_199_254_740_991;
static WRITER: Mutex<()> = Mutex::new(());
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Low,
    Balanced,
    High,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    schema_version: u8,
    revision: u64,
    requested_enabled: bool,
    quality: Quality,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeStatus {
    Active,
    Disabled,
    Suspended,
    Fallback,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Instance {
    schema_version: u8,
    instance_id: String,
    pid: u32,
    plugin_enabled: bool,
    requested_revision: Option<u64>,
    applied_revision: Option<u64>,
    requested_enabled: bool,
    quality: Quality,
    status: RuntimeStatus,
    reason: Option<String>,
    updated_at: String,
    heartbeat_expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    config: Option<Request>,
    error: Option<String>,
    instances: Vec<Instance>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn invalid(message: &str) -> io::Error {
    io::Error::other(message)
}

pub fn root() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(|p| PathBuf::from(p).join("Hotori/TrueLiquidGlass"))
        .ok_or_else(|| "Could not locate your roaming AppData folder.".into())
}

fn regular(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !metadata.file_type().is_symlink()
}

// Reject directory junctions as well as file symlinks; never traverse a bridge redirect.
pub(crate) fn safe_path(path: &Path) -> io::Result<()> {
    for component in path.ancestors() {
        match fs::symlink_metadata(component) {
            Ok(m) if !regular(&m) => {
                return Err(invalid(
                    "The companion path contains a symbolic link or reparse point.",
                ));
            }
            Ok(_) => (),
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

fn bounded(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    safe_path(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !regular(&metadata) || !metadata.is_file() || metadata.len() > limit {
        return Err(invalid("Invalid or oversized companion file."));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(invalid("Oversized companion file."));
    }
    Ok(bytes)
}

fn request(root: &Path) -> io::Result<Option<Request>> {
    let bytes = match bounded(&root.join("config.json"), 4096) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let value: Request = serde_json::from_slice(&bytes)?;
    if value.schema_version != 1 || value.revision > SAFE {
        return Err(invalid("Unsupported companion configuration."));
    }
    Ok(Some(value))
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
fn timestamp(value: &str) -> Option<i128> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|v| v.unix_timestamp_nanos() / 1_000_000)
}
fn valid_instance(instance: &Instance) -> bool {
    instance.schema_version == 1
        && instance.pid > 0
        && uuid(&instance.instance_id)
        && instance
            .reason
            .as_ref()
            .is_none_or(|s| s.chars().count() <= 256)
        && instance.requested_revision.is_none_or(|r| r <= SAFE)
        && instance.applied_revision.is_none_or(|r| r <= SAFE)
}
fn fresh(instance: &Instance, now: u64) -> bool {
    let Some(updated) = timestamp(&instance.updated_at) else {
        return false;
    };
    let Some(expires) = timestamp(&instance.heartbeat_expires_at) else {
        return false;
    };
    let now = now as i128;
    valid_instance(instance)
        && updated <= now + 2000
        && updated >= now - 10_000
        && expires > now
        && expires > updated
        && expires <= updated + 10_000
}

fn instances(root: &Path, now: u64, fresh_only: bool) -> io::Result<Vec<Instance>> {
    let path = root.join("status");
    safe_path(&path)?;
    let directory = match fs::read_dir(path) {
        Ok(d) => d,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let mut result = Vec::new();
    for (index, entry) in directory.enumerate() {
        if index >= 1024 {
            return Err(invalid("Too many companion status files to check safely."));
        }
        let entry = entry?;
        let path = entry.path();
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if path.extension().and_then(|s| s.to_str()) != Some("json") || !uuid(id) {
            continue;
        }
        let Ok(bytes) = bounded(&path, 4096) else {
            continue;
        };
        // Check mandatory nullable fields too: serde Option alone permits missing fields.
        let Ok(object) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        if !["requestedRevision", "appliedRevision", "reason"]
            .iter()
            .all(|k| object.get(k).is_some())
        {
            continue;
        }
        let Ok(status) = serde_json::from_value::<Instance>(object) else {
            continue;
        };
        if status.instance_id == id
            && valid_instance(&status)
            && (!fresh_only || fresh(&status, now))
        {
            result.push(status);
        }
    }
    result.sort_by(|a, b| a.instance_id.cmp(&b.instance_id));
    Ok(result)
}

pub fn read(root: &Path) -> Snapshot {
    let (config, mut error) = match request(root) {
        Ok(v) => (v, None),
        Err(e) => (
            None,
            Some(format!("Cannot read True Liquid Glass request: {e}")),
        ),
    };
    let instances = match instances(root, now_ms(), true) {
        Ok(v) => v,
        Err(e) => {
            error = Some(format!("Cannot read plugin status: {e}"));
            vec![]
        }
    };
    Snapshot {
        config,
        error,
        instances,
    }
}

pub(crate) fn connected_after(root: &Path, after: u64) -> bool {
    instances(root, now_ms(), true).unwrap_or_default().iter().any(|instance| {
        instance.plugin_enabled && timestamp(&instance.updated_at).is_some_and(|t| t >= after as i128)
    })
}

// The persistent lock file is opened without sharing, serializing separate installer
// processes as well as the in-process mutex. Never remove someone else's lock/temp.
fn writer_lock(root: &Path) -> io::Result<File> {
    let path = root.join("installer.lock");
    safe_path(&path)?;
    for attempt in 0..10 {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0).custom_flags(0x00200000);
        }
        match options.open(&path) {
            Ok(f) if regular(&f.metadata()?) && f.metadata()?.is_file() => return Ok(f),
            Ok(_) => return Err(invalid("Invalid companion writer lock.")),
            Err(e) if attempt == 9 => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(40)),
        }
    }
    unreachable!()
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    safe_path(path)?;
    let temporary = path.with_file_name(format!(
        ".installer-{}-{}-{}.tmp",
        std::process::id(),
        now_ms(),
        TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        for attempt in 0..6 {
            safe_path(path)?;
            #[cfg(windows)]
            let result = {
                use std::os::windows::ffi::OsStrExt;
                use windows_sys::Win32::Storage::FileSystem::{
                    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
                };
                let from: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                if unsafe {
                    MoveFileExW(
                        from.as_ptr(),
                        to.as_ptr(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                } != 0
                {
                    Ok(())
                } else {
                    Err(io::Error::last_os_error())
                }
            };
            #[cfg(not(windows))]
            let result = fs::rename(&temporary, path);
            match result {
                Ok(()) => return Ok(()),
                Err(e) if attempt == 5 => return Err(e),
                Err(_) => std::thread::sleep(Duration::from_millis(30 * (attempt + 1))),
            }
        }
        unreachable!()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn save(root: &Path, enabled: bool, quality: Quality) -> Result<Snapshot, String> {
    save_inner(root, enabled, quality)
        .map_err(|e| format!("True Liquid Glass request was not saved: {e}"))
}
fn save_inner(root: &Path, enabled: bool, quality: Quality) -> io::Result<Snapshot> {
    let _guard = WRITER
        .lock()
        .map_err(|_| invalid("Companion writer is unavailable."))?;
    safe_path(root)?;
    fs::create_dir_all(root)?;
    safe_path(root)?;
    let _lock = writer_lock(root)?;
    // Missing/invalid configuration is only repaired by an explicit save, never by opening settings.
    let previous = request(root).ok().flatten();
    if previous
        .as_ref()
        .is_some_and(|p| p.requested_enabled == enabled && p.quality == quality)
    {
        return Ok(read(root));
    }
    let mut revision = now_ms().max(
        previous
            .as_ref()
            .map_or(0, |p| p.revision.saturating_add(1)),
    );
    let counter_path = root.join("installer-revision.json");
    match bounded(&counter_path, 64) {
        Ok(bytes) => {
            let high: u64 = serde_json::from_slice(&bytes)?;
            revision = revision.max(high.saturating_add(1));
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => (),
        Err(e) => return Err(e),
    }
    // Even an expired instance can have observed a higher durable revision.
    for instance in instances(root, now_ms(), false)? {
        for observed in [instance.requested_revision, instance.applied_revision]
            .into_iter()
            .flatten()
        {
            revision = revision.max(observed.saturating_add(1));
        }
    }
    if revision > SAFE {
        return Err(invalid("Companion revision limit reached."));
    }
    let config = Request {
        schema_version: 1,
        revision,
        requested_enabled: enabled,
        quality,
    };
    // Persist the high-water mark first. A failed request replacement can skip a
    // revision but must never allow its later reuse after a restart.
    atomic_write(&counter_path, &serde_json::to_vec(&revision)?)?;
    atomic_write(&root.join("config.json"), &serde_json::to_vec(&config)?)?;
    Ok(read(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "hotori-companion-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn status(revision: u64) -> Instance {
        Instance {
            schema_version: 1,
            instance_id: "71fb3a2d-4bc0-45ba-81cd-7b2dc574a2c0".into(),
            pid: 123,
            plugin_enabled: true,
            requested_revision: Some(revision),
            applied_revision: Some(revision),
            requested_enabled: true,
            quality: Quality::Balanced,
            status: RuntimeStatus::Active,
            reason: None,
            updated_at: "2026-11-18T12:00:00.000Z".into(),
            heartbeat_expires_at: "2026-11-18T12:00:10.000Z".into(),
        }
    }
    #[test]
    fn request_validation_defaults_and_no_open_side_effects() {
        let p = folder();
        assert!(read(&p).config.is_none());
        assert!(read(&p).error.is_none());
        assert!(!p.join("config.json").exists());
        for bad in [
            r#"{}"#,
            r#"{"schemaVersion":2,"revision":1,"requestedEnabled":true,"quality":"balanced"}"#,
            r#"{"schemaVersion":1,"revision":-1,"requestedEnabled":true,"quality":"balanced"}"#,
            r#"{"schemaVersion":1,"revision":9007199254740992,"requestedEnabled":true,"quality":"balanced"}"#,
            r#"{"schemaVersion":1,"revision":1,"requestedEnabled":1,"quality":"balanced"}"#,
            r#"{"schemaVersion":1,"revision":1,"requestedEnabled":true,"quality":"ultra"}"#,
            r#"{"schemaVersion":1,"revision":1,"requestedEnabled":true,"quality":"balanced","extra":0}"#,
        ] {
            fs::write(p.join("config.json"), bad).unwrap();
            assert!(read(&p).config.is_none());
            assert!(read(&p).error.is_some());
            assert_eq!(fs::read_to_string(p.join("config.json")).unwrap(), bad);
        }
        fs::write(p.join("config.json"), vec![b' '; 4097]).unwrap();
        assert!(request(&p).is_err());
        let repaired = save(&p, false, Quality::Balanced).unwrap().config.unwrap();
        assert!(!repaired.requested_enabled);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(p.join("config.json")).unwrap()).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 4);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn serialized_atomic_requests_preserve_quality_and_revision_history() {
        let p = folder();
        let a = save(&p, true, Quality::High).unwrap().config.unwrap();
        let same = save(&p, true, Quality::High).unwrap().config.unwrap();
        assert_eq!(a, same);
        let handles: Vec<_> = [Quality::Low, Quality::Balanced]
            .into_iter()
            .map(|quality| {
                let p = p.clone();
                std::thread::spawn(move || save(&p, false, quality).unwrap().config.unwrap())
            })
            .collect();
        let b = handles
            .into_iter()
            .map(|h| h.join().unwrap().revision)
            .max()
            .unwrap();
        assert!(b > a.revision);
        fs::remove_file(p.join("config.json")).unwrap();
        let c = save(&p, true, Quality::Balanced).unwrap().config.unwrap();
        assert!(c.revision > b);
        fs::create_dir(p.join("status")).unwrap();
        let observed = c.revision + 500_000;
        fs::write(
            p.join("status")
                .join(format!("{}.json", status(observed).instance_id)),
            serde_json::to_vec(&status(observed)).unwrap(),
        )
        .unwrap();
        fs::write(p.join("config.json"), "invalid").unwrap();
        let recovered = save(&p, false, Quality::Balanced).unwrap().config.unwrap();
        assert!(recovered.revision > observed);
        assert!(
            !fs::read_dir(&p).unwrap().any(|e| e
                .unwrap()
                .path()
                .extension()
                .is_some_and(|e| e == "tmp"))
        );
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn heartbeats_and_status_schema_are_checked() {
        let p = folder();
        fs::create_dir(p.join("status")).unwrap();
        let good = status(7);
        let now = timestamp("2026-11-18T12:00:05Z").unwrap() as u64;
        assert!(fresh(&good, now));
        assert!(!fresh(&good, now + 6000));
        assert!(!fresh(&good, now - 10_000));
        let file = p.join("status").join(format!("{}.json", good.instance_id));
        fs::write(&file, serde_json::to_vec(&good).unwrap()).unwrap();
        fs::write(p.join("status/ignored.tmp"), "garbage").unwrap();
        assert_eq!(instances(&p, now, true).unwrap().len(), 1);
        assert_eq!(instances(&p, now + 6000, true).unwrap().len(), 0);
        let mut bad = serde_json::to_value(&good).unwrap();
        bad.as_object_mut().unwrap().remove("appliedRevision");
        fs::write(&file, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(instances(&p, now, true).unwrap().is_empty());
        bad = serde_json::to_value(&good).unwrap();
        bad["extra"] = true.into();
        fs::write(&file, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(instances(&p, now, true).unwrap().is_empty());
        fs::write(&file, vec![b' '; 4097]).unwrap();
        assert!(instances(&p, now, true).unwrap().is_empty());
        fs::remove_dir_all(p).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn failed_replacement_preserves_previous_request_and_writer_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        let p = folder();
        save(&p, true, Quality::High).unwrap();
        let before = fs::read(p.join("config.json")).unwrap();
        let handle = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(p.join("config.json"))
            .unwrap();
        assert!(save(&p, false, Quality::Balanced).is_err());
        assert_eq!(fs::read(p.join("config.json")).unwrap(), before);
        drop(handle);
        let lock = writer_lock(&p).unwrap();
        assert!(save(&p, false, Quality::Balanced).is_err());
        drop(lock);
        assert!(save(&p, false, Quality::Balanced).is_ok());
        fs::remove_dir_all(p).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn bridge_rejects_file_and_directory_links() {
        use std::os::windows::fs::{symlink_dir, symlink_file};
        let p = folder();
        let target = p.join("outside.json");
        fs::write(&target, b"untouched").unwrap();
        if symlink_file(&target, p.join("config.json")).is_ok() {
            assert!(request(&p).is_err());
            assert!(save(&p, true, Quality::Balanced).is_err());
            assert_eq!(fs::read(&target).unwrap(), b"untouched");
            fs::remove_file(p.join("config.json")).unwrap();
        }
        let link = p.join("redirect");
        if symlink_dir(&p, &link).is_ok() {
            assert!(save(&link, true, Quality::Balanced).is_err());
            fs::remove_dir(&link).unwrap();
        }
        fs::remove_dir_all(p).unwrap();
    }
}
