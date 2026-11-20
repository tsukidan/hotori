//! Embedded, signed-with-the-EXE Vencord delivery. Applying is an explicit,
//! closed-Discord transaction; settings/themes/companion requests are never written.
use crate::true_liquid_glass::{atomic_write, safe_path};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
static APPLY: Mutex<()> = Mutex::new(());
#[path = "runtime_payload.rs"]
mod payload;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Clone, Deserialize, Serialize)]
struct Baseline {
    label: String,
    files: BTreeMap<String, String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bundle {
    schema_version: u8,
    id: String,
    plugin_version: String,
    upstream_revision: String,
    files: Vec<Entry>,
    baselines: Vec<Baseline>,
}
#[derive(Clone)]
pub struct Locations {
    roaming: PathBuf,
    local: PathBuf,
}
impl Locations {
    pub fn current() -> Result<Self, String> {
        Ok(Self {
            roaming: std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .ok_or("AppData unavailable")?,
            local: std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .ok_or("Local AppData unavailable")?,
        })
    }
    fn root(&self) -> PathBuf {
        self.roaming.join("Hotori/TrueLiquidGlass/runtime")
    }
    fn dist(&self) -> PathBuf {
        self.roaming.join("Vencord/dist")
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub state: String,
    pub message: String,
    pub payload_ready: bool,
    pub can_apply: bool,
    pub can_rollback: bool,
    pub build_id: String,
    pub plugin_version: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bootstrap {
    relative: String,
    before: String,
    original: Option<String>,
    patched: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u8,
    transaction: String,
    phase: String,
    bundle_id: String,
    before: BTreeMap<String, String>,
    after: BTreeMap<String, String>,
    bootstraps: Vec<Bootstrap>,
    applied_at: u64,
}
const NAMES: &[&str] = &[
    "patcher.js",
    "preload.js",
    "renderer.js",
    "renderer.css",
    "patcher.js.LEGAL.txt",
    "renderer.js.LEGAL.txt",
    "package.json",
];
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn file_hash(path: &Path) -> Result<String, String> {
    safe_path(path).map_err(err)?;
    let mut f = fs::File::open(path).map_err(err)?;
    let m = f.metadata().map_err(err)?;
    if !m.is_file() || m.len() > 128 * 1024 * 1024 {
        return Err("Invalid runtime file".into());
    }
    let mut sha = Sha256::new();
    let mut b = [0; 65536];
    loop {
        let n = f.read(&mut b).map_err(err)?;
        if n == 0 {
            break;
        }
        sha.update(&b[..n]);
    }
    Ok(format!("{:x}", sha.finalize()))
}
fn json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    safe_path(path).map_err(err)?;
    let m = fs::metadata(path).map_err(err)?;
    if !m.is_file() || m.len() > 1024 * 1024 {
        return Err("Invalid delivery metadata".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    atomic_write(path, &serde_json::to_vec_pretty(value).map_err(err)?).map_err(err)
}
fn identifier(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}
fn bundle() -> Result<Bundle, String> {
    let b: Bundle = serde_json::from_str(payload::MANIFEST).map_err(err)?;
    if b.schema_version != 1 || !identifier(&b.id) || b.files.len() != payload::FILES.len() {
        return Err("Invalid embedded payload manifest".into());
    }
    for (name, data) in payload::FILES {
        let e = b
            .files
            .iter()
            .find(|e| e.path == *name)
            .ok_or("Missing payload manifest entry")?;
        if !safe_relative(name) || e.size != data.len() as u64 || e.sha256 != digest(data) {
            return Err("Embedded runtime hash mismatch".into());
        }
    }
    for n in NAMES {
        if !b.files.iter().any(|e| e.path == format!("dist/{n}")) {
            return Err("Incomplete embedded runtime".into());
        }
    }
    Ok(b)
}
fn safe_relative(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(['\\', ':'])
        && s.split('/').all(|p| !p.is_empty() && p != "." && p != "..")
        && !s.starts_with('/')
}
fn tree(path: &Path) -> Result<BTreeMap<String, String>, String> {
    safe_path(path).map_err(err)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let mut result = BTreeMap::new();
    for entry in fs::read_dir(path).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Invalid runtime filename")?;
        if !safe_relative(&name) || name.contains('/') {
            return Err("Invalid runtime filename".into());
        }
        result.insert(name, file_hash(&entry.path())?);
    }
    Ok(result)
}
fn expected(b: &Bundle) -> BTreeMap<String, String> {
    b.files
        .iter()
        .filter_map(|e| {
            e.path
                .strip_prefix("dist/")
                .map(|n| (n.into(), e.sha256.clone()))
        })
        .collect()
}
fn stage(loc: &Locations, b: &Bundle) -> Result<PathBuf, String> {
    let folder = loc.root().join("payloads").join(&b.id);
    safe_path(&folder).map_err(err)?;
    fs::create_dir_all(&folder).map_err(err)?;
    for (name, bytes) in payload::FILES {
        let p = folder.join(name);
        safe_path(&p).map_err(err)?;
        let hash = b.files.iter().find(|e| e.path == *name).unwrap();
        if p.is_file() && file_hash(&p)? == hash.sha256 {
            continue;
        }
        fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
        safe_path(p.parent().unwrap()).map_err(err)?;
        atomic_write(&p, bytes).map_err(err)?;
        if file_hash(&p)? != hash.sha256 {
            return Err("Staged runtime verification failed".into());
        }
    }
    let manifest_path = folder.join("bundle.json");
    safe_path(&manifest_path).map_err(err)?;
    if fs::read(&manifest_path).ok().as_deref() != Some(payload::MANIFEST.as_bytes()) {
        atomic_write(&manifest_path, payload::MANIFEST.as_bytes()).map_err(err)?;
    }
    Ok(folder)
}

pub fn sources(loc: &Locations) -> Result<PathBuf, String> {
    let b = bundle()?;
    stage(loc, &b)
}
fn asar_file(path: &Path, name: &str) -> Result<Vec<u8>, String> {
    safe_path(path).map_err(err)?;
    let mut f = fs::File::open(path).map_err(err)?;
    let mut h = [0; 16];
    f.read_exact(&mut h).map_err(err)?;
    let length = u32::from_le_bytes(h[12..16].try_into().unwrap()) as usize;
    let offset = 8 + u32::from_le_bytes(h[4..8].try_into().unwrap()) as u64;
    if length > 1024 * 1024 || offset < 16 + length as u64 {
        return Err("Invalid Discord bootstrap archive".into());
    }
    let mut header = vec![0; length];
    f.read_exact(&mut header).map_err(err)?;
    let j: serde_json::Value = serde_json::from_slice(&header).map_err(err)?;
    let files = j["files"].as_object().ok_or("Invalid archive entries")?;
    let e = files.get(name).ok_or("Missing bootstrap entry")?;
    let size = e["size"]
        .as_u64()
        .filter(|s| *s <= 65536)
        .ok_or("Oversized bootstrap entry")?;
    let pos = e["offset"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or("Invalid bootstrap offset")?;
    f.seek(SeekFrom::Start(
        offset.checked_add(pos).ok_or("Invalid bootstrap offset")?,
    ))
    .map_err(err)?;
    let mut bytes = vec![0; size as usize];
    f.read_exact(&mut bytes).map_err(err)?;
    Ok(bytes)
}
fn original_discord(path: &Path) -> bool {
    asar_file(path, "package.json")
        .ok()
        .and_then(|s| serde_json::from_slice::<serde_json::Value>(&s).ok())
        .is_some_and(|j| j["name"] == "discord" && j["main"] == "bundle.js" && j["private"] == true)
}
fn wrapper(patcher: &Path) -> Result<Vec<u8>, String> {
    let index = format!(
        "require({})",
        serde_json::to_string(&patcher.to_string_lossy()).map_err(err)?
    );
    let package = r#"{"name":"discord","main":"index.js"}"#;
    let header = serde_json::json!({"files":{"index.js":{"size":index.len(),"offset":"0"},"package.json":{"size":package.len(),"offset":index.len().to_string()}}});
    let bytes = serde_json::to_vec(&header).map_err(err)?;
    let aligned = (bytes.len() + 3) & !3;
    let mut result = Vec::new();
    for n in [4, aligned + 8, aligned + 4, bytes.len()] {
        result.extend_from_slice(&(n as u32).to_le_bytes())
    }
    result.extend_from_slice(&bytes);
    result.resize(16 + aligned, 0);
    result.extend_from_slice(index.as_bytes());
    result.extend_from_slice(package.as_bytes());
    Ok(result)
}
fn points_to(path: &Path, patcher: &Path) -> bool {
    let Ok(index) = asar_file(path, "index.js") else {
        return false;
    };
    let Ok(s) = std::str::from_utf8(&index) else {
        return false;
    };
    let Some(value) = s
        .trim()
        .trim_end_matches(';')
        .strip_prefix("require(")
        .and_then(|s| s.strip_suffix(')'))
    else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<String>(value) else {
        return false;
    };
    value
        .replace('\\', "/")
        .eq_ignore_ascii_case(&patcher.to_string_lossy().replace('\\', "/"))
}
fn resource(loc: &Locations, relative: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() != 3
        || ![
            "Discord",
            "DiscordPTB",
            "DiscordCanary",
            "DiscordDevelopment",
        ]
        .contains(&parts[0])
        || !parts[1].starts_with("app-")
        || semver::Version::parse(&parts[1][4..]).is_err()
        || parts[2] != "resources"
    {
        return Err("Invalid Discord deployment target".into());
    }
    let p = loc.local.join(relative);
    safe_path(&p).map_err(err)?;
    Ok(p)
}
fn discover(loc: &Locations) -> Result<Vec<Bootstrap>, String> {
    let mut plans = Vec::new();
    for channel in [
        "Discord",
        "DiscordPTB",
        "DiscordCanary",
        "DiscordDevelopment",
    ] {
        let base = loc.local.join(channel);
        safe_path(&base).map_err(err)?;
        if !base.exists() {
            continue;
        }
        let mut versions = Vec::new();
        for e in fs::read_dir(&base).map_err(err)? {
            let e = e.map_err(err)?;
            let s = e.file_name().to_string_lossy().into_owned();
            if let Some(v) = s
                .strip_prefix("app-")
                .and_then(|s| semver::Version::parse(s).ok())
            {
                versions.push((v, s))
            }
        }
        versions.sort();
        let Some((_, version)) = versions.pop() else {
            continue;
        };
        let relative = format!("{channel}/{version}/resources");
        let p = resource(loc, &relative)?;
        let app = p.join("app.asar");
        let original = p.join("_app.asar");
        let patched = original.exists();
        if patched {
            if !original_discord(&original) || !points_to(&app, &loc.dist().join("patcher.js")) {
                return Err(format!(
                    "{channel} has a different or unrecognized bootstrap. It was preserved; merge/install the custom build manually."
                ));
            }
        } else if !original_discord(&app) {
            return Err(format!(
                "{channel} is not a recognized stock Discord bootstrap. Nothing was replaced."
            ));
        }
        plans.push(Bootstrap {
            relative,
            before: file_hash(&app)?,
            original: if patched {
                Some(file_hash(&original)?)
            } else {
                None
            },
            patched,
        });
    }
    if plans.is_empty() {
        return Err("Install Discord desktop first. The bundled runtime is ready but has not been installed.".into());
    }
    Ok(plans)
}
fn journal(loc: &Locations) -> Result<Option<Journal>, String> {
    let path = loc.root().join("transaction.json");
    safe_path(&path).map_err(err)?;
    if !path.exists() {
        return Ok(None);
    }
    let j: Journal = json(&path)?;
    if j.schema_version != 1
        || !identifier(&j.transaction)
        || !identifier(&j.bundle_id)
        || ![
            "prepared",
            "swapped",
            "complete",
            "rolling_back",
            "rolled_back",
        ]
        .contains(&j.phase.as_str())
    {
        return Err("Invalid runtime recovery record. Backups were preserved.".into());
    }
    for b in &j.bootstraps {
        resource(loc, &b.relative)?;
    }
    Ok(Some(j))
}
fn eligible(
    _loc: &Locations,
    b: &Bundle,
    current: &BTreeMap<String, String>,
    j: Option<&Journal>,
) -> bool {
    current.is_empty()
        || current == &expected(b)
        || b.baselines.iter().any(|x| &x.files == current)
        || j.is_some_and(|j| j.phase == "complete" && &j.after == current)
}
fn status_impl(loc: &Locations, b: &Bundle) -> Result<Delivery, String> {
    stage(loc, b)?;
    let current = tree(&loc.dist())?;
    let j = journal(loc)?;
    let rollback = j.as_ref().is_some_and(|j| {
        j.phase != "rolled_back"
            && loc
                .root()
                .join("transactions")
                .join(&j.transaction)
                .exists()
    });
    let make = |state: &str, message: String, apply: bool| Delivery {
        state: state.into(),
        message,
        payload_ready: true,
        can_apply: apply,
        can_rollback: rollback,
        build_id: b.id.clone(),
        plugin_version: b.plugin_version.clone(),
    };
    if j.as_ref()
        .is_some_and(|j| !["complete", "rolled_back"].contains(&j.phase.as_str()))
    {
        return Ok(make("recovery_required","An interrupted runtime installation needs rollback before retrying. Your backup is preserved.".into(),false));
    }
    let plans = match discover(loc) {
        Ok(p) => p,
        Err(e) => return Ok(make("blocked", e, false)),
    };
    if !eligible(loc, b, &current, j.as_ref()) {
        return Ok(make("custom_build","Your existing custom or unrecognized Vencord build was preserved. Merge Hotori's included source into that build; it will not be replaced automatically.".into(),false));
    }
    if current == expected(b) && plans.iter().all(|p| p.patched) {
        let since = j.as_ref().map_or(0, |j| j.applied_at);
        if crate::true_liquid_glass::connected_after(
            &loc.roaming.join("Hotori/TrueLiquidGlass"),
            since,
        ) {
            return Ok(make("installed", "Runtime files and bootstrap verified; a fresh companion connection confirms Discord restarted. Effect state is shown separately below the switch.".into(), false));
        }
        return Ok(make("pending_restart","Runtime files and Discord bootstrap verified. Restart Discord and enable HotoriTrueLiquidGlass in Vencord → Plugins; live effect status is shown separately.".into(),false));
    }
    Ok(make("ready","Plugin runtime received and verified. Fully quit Discord, then apply it. Settings, themes, plugins and your saved effect preference are preserved.".into(),true))
}
pub fn status(loc: &Locations) -> Delivery {
    let result = (|| {
        let b = bundle()?;
        status_impl(loc, &b)
    })();
    let mut result = result.unwrap_or_else(|message| Delivery {
        state: "failed".into(),
        message,
        payload_ready: false,
        can_apply: false,
        can_rollback: false,
        build_id: String::new(),
        plugin_version: String::new(),
    });
    let failure = loc.root().join("last-failure.json");
    if failure.exists() {
        if let Ok(message) = json::<String>(&failure) {
            if result.state != "recovery_required" {
                result.state = "failed".into();
            }
            result.message = format!("Last operation failed: {message} {}", result.message);
        }
    }
    result
}
fn closed() -> Result<(), String> {
    crate::installer::ensure_discord_closed().map_err(|_|"Fully quit Discord and Vesktop, including tray icons, before applying or rolling back the runtime.".into())
}
fn acquire(loc: &Locations) -> Result<fs::File, String> {
    let root = loc.root();
    safe_path(&root).map_err(err)?;
    fs::create_dir_all(&root).map_err(err)?;
    safe_path(&root.join("delivery.lock")).map_err(err)?;
    let mut o = fs::OpenOptions::new();
    o.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.share_mode(0).custom_flags(0x00200000);
    }
    let file = o
        .open(root.join("delivery.lock"))
        .map_err(|_| "Another installer is applying the runtime. Try again when it finishes.")?;
    Ok(file)
}
fn apply_impl(
    loc: &Locations,
    guard: &dyn Fn() -> Result<(), String>,
    fail_after_swap: bool,
) -> Result<Delivery, String> {
    let _mutex = APPLY.lock().map_err(err)?;
    let _file = acquire(loc)?;
    guard()?;
    let b = bundle()?;
    let staged = stage(loc, &b)?;
    let old = journal(loc)?;
    if old
        .as_ref()
        .is_some_and(|j| !["complete", "rolled_back"].contains(&j.phase.as_str()))
    {
        return Err("Rollback the interrupted installation first.".into());
    }
    let before = tree(&loc.dist())?;
    if !eligible(loc, &b, &before, old.as_ref()) {
        return Err(
            "Unrecognized custom build preserved; merge the plugin into your build instead.".into(),
        );
    }
    let bootstraps = discover(loc)?;
    let id = format!("{:x}-{:x}", now(), std::process::id());
    let transaction = loc.root().join("transactions").join(&id);
    safe_path(&transaction).map_err(err)?;
    fs::create_dir(&transaction)
        .or_else(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                fs::create_dir_all(transaction.parent().unwrap())?;
                fs::create_dir(&transaction)
            } else {
                Err(e)
            }
        })
        .map_err(err)?;
    if let Some(j) = old {
        write_json(&transaction.join("previous-transaction.json"), &j)?
    }
    let next = transaction.join("new-dist");
    fs::create_dir(&next).map_err(err)?;
    for n in NAMES {
        fs::copy(staged.join("dist").join(n), next.join(n)).map_err(err)?;
    }
    if tree(&next)? != expected(&b) {
        return Err("Prepared runtime verification failed.".into());
    }
    let mut j = Journal {
        schema_version: 1,
        transaction: id,
        phase: "prepared".into(),
        bundle_id: b.id.clone(),
        before,
        after: expected(&b),
        bootstraps,
        applied_at: now(),
    };
    write_json(&loc.root().join("transaction.json"), &j)?;
    let operation: Result<(), String> = (|| {
        guard()?;
        if tree(&loc.dist())? != j.before {
            return Err("Vencord changed during preparation. Nothing was overwritten.".into());
        }
        for p in &j.bootstraps {
            let r = resource(loc, &p.relative)?;
            if file_hash(&r.join("app.asar"))? != p.before {
                return Err("Discord bootstrap changed during preparation.".into());
            }
            if p.patched
                && file_hash(&r.join("_app.asar"))?
                    != p.original
                        .clone()
                        .ok_or("Missing original bootstrap hash")?
            {
                return Err("Original Discord archive changed during preparation.".into());
            }
        }
        if loc.dist().exists() {
            fs::rename(loc.dist(), transaction.join("old-dist")).map_err(err)?;
        }
        fs::create_dir_all(loc.dist().parent().unwrap()).map_err(err)?;
        fs::rename(&next, loc.dist()).map_err(err)?;
        j.phase = "swapped".into();
        write_json(&loc.root().join("transaction.json"), &j)?;
        if fail_after_swap {
            return Err("Injected deployment failure".into());
        }
        for p in &j.bootstraps {
            guard()?;
            let r = resource(loc, &p.relative)?;
            if !p.patched {
                if r.join("_app.asar").exists() {
                    return Err(
                        "Discord bootstrap changed before application; original archive preserved."
                            .into(),
                    );
                }
                fs::rename(r.join("app.asar"), r.join("_app.asar")).map_err(err)?;
                atomic_write(
                    &r.join("app.asar"),
                    &wrapper(&loc.dist().join("patcher.js"))?,
                )
                .map_err(err)?;
            }
            if !points_to(&r.join("app.asar"), &loc.dist().join("patcher.js")) {
                return Err("Discord bootstrap verification failed.".into());
            }
            if file_hash(&r.join("_app.asar"))?
                != p.original.clone().unwrap_or_else(|| p.before.clone())
            {
                return Err("Original Discord archive verification failed.".into());
            }
        }
        if tree(&loc.dist())? != j.after {
            return Err("Installed runtime hash verification failed.".into());
        }
        j.phase = "complete".into();
        write_json(&loc.root().join("transaction.json"), &j)?;
        fs::create_dir_all(loc.roaming.join("Vencord/themes")).map_err(err)?;
        Ok(())
    })();
    if let Err(error) = operation {
        match rollback_impl(loc, guard) {
            Ok(_) => return Err(format!("{error} The previous runtime was restored.")),
            Err(recovery) => {
                return Err(format!(
                    "{error} Recovery required: {recovery}. Backup: {}",
                    transaction.display()
                ));
            }
        }
    }
    status_impl(loc, &b)
}
pub fn apply(loc: &Locations) -> Result<Delivery, String> {
    match apply_impl(loc, &closed, false) {
        Ok(_) => {
            let _ = fs::remove_file(loc.root().join("last-failure.json"));
            Ok(status(loc))
        }
        Err(error) => {
            let _ = write_json(&loc.root().join("last-failure.json"), &error);
            Err(error)
        }
    }
}
fn rollback_impl(
    loc: &Locations,
    guard: &dyn Fn() -> Result<(), String>,
) -> Result<Delivery, String> {
    guard()?;
    let mut j = journal(loc)?.ok_or("No runtime rollback is available")?;
    if j.phase == "rolled_back" {
        return Err("This runtime transaction was already rolled back.".into());
    }
    let transaction = loc.root().join("transactions").join(&j.transaction);
    safe_path(&transaction).map_err(err)?;
    let backup = transaction.join("old-dist");
    if backup.exists() && tree(&backup)? != j.before {
        return Err("Backup hash mismatch. It was preserved.".into());
    }
    let current = tree(&loc.dist())?;
    if !current.is_empty() && current != j.after && current != j.before {
        return Err(
            "Vencord changed after installation; refusing to overwrite those changes.".into(),
        );
    }
    // Validate every bootstrap before changing any of them. A retry may find a
    // stock bootstrap already restored by an interrupted previous rollback.
    for p in &j.bootstraps {
        let r = resource(loc, &p.relative)?;
        if p.patched {
            if file_hash(&r.join("app.asar"))? != p.before
                || file_hash(&r.join("_app.asar"))?
                    != p.original
                        .clone()
                        .ok_or("Missing original bootstrap record")?
            {
                return Err("Existing bootstrap changed; refusing rollback.".into());
            }
        } else if r.join("_app.asar").exists() {
            if file_hash(&r.join("_app.asar"))? != p.before
                || (r.join("app.asar").exists()
                    && !points_to(&r.join("app.asar"), &loc.dist().join("patcher.js")))
            {
                return Err("Discord bootstrap changed; refusing rollback.".into());
            }
        } else if file_hash(&r.join("app.asar"))? != p.before {
            return Err("Original Discord bootstrap is unavailable; backup preserved.".into());
        }
    }
    j.phase = "rolling_back".into();
    write_json(&loc.root().join("transaction.json"), &j)?;
    for p in j.bootstraps.iter().rev() {
        let r = resource(loc, &p.relative)?;
        if !p.patched {
            let original = r.join("_app.asar");
            if original.exists() {
                if file_hash(&original)? != p.before {
                    return Err("Original Discord archive changed; refusing rollback.".into());
                }
                let app = r.join("app.asar");
                if app.exists() {
                    if !points_to(&app, &loc.dist().join("patcher.js")) {
                        return Err("Discord bootstrap changed; refusing rollback.".into());
                    }
                    fs::rename(
                        &app,
                        transaction.join(format!(
                            "{}-bootstrap.asar",
                            p.relative.split('/').next().unwrap()
                        )),
                    )
                    .map_err(err)?;
                }
                guard()?;
                fs::rename(original, app).map_err(err)?;
            }
        } else {
            if file_hash(&r.join("app.asar"))? != p.before
                || file_hash(&r.join("_app.asar"))? != p.original.clone().unwrap()
            {
                return Err("Existing bootstrap changed; refusing rollback.".into());
            }
        }
    }
    guard()?;
    if tree(&loc.dist())? != current {
        return Err("Vencord changed during rollback; backup preserved.".into());
    }
    if backup.exists() {
        if loc.dist().exists() {
            if current != j.after && current != j.before {
                return Err("Current runtime changed".into());
            }
            fs::rename(loc.dist(), transaction.join("removed-dist")).map_err(err)?;
        }
        fs::rename(&backup, loc.dist()).map_err(err)?;
    } else if j.before.is_empty() && loc.dist().exists() {
        fs::rename(loc.dist(), transaction.join("removed-dist")).map_err(err)?;
    } else if current != j.before {
        return Err("Runtime backup unavailable; no files were deleted.".into());
    }
    if tree(&loc.dist())? != j.before {
        return Err("Rollback verification failed.".into());
    }
    j.phase = "rolled_back".into();
    write_json(&loc.root().join("transaction.json"), &j)?;
    let previous = transaction.join("previous-transaction.json");
    if previous.exists() {
        let prior: Journal = json(&previous)?;
        write_json(&loc.root().join("transaction.json"), &prior)?;
    }
    let mut s = status(loc);
    s.state = "rolled_back".into();
    s.message="Previous runtime and bootstrap restored and verified. Settings, themes and effect preference were not changed. Restart Discord.".into();
    Ok(s)
}
pub fn rollback(loc: &Locations) -> Result<Delivery, String> {
    let _mutex = APPLY.lock().map_err(err)?;
    let _file = acquire(loc)?;
    match rollback_impl(loc, &closed) {
        Ok(result) => {
            let _ = fs::remove_file(loc.root().join("last-failure.json"));
            Ok(result)
        }
        Err(error) => {
            let _ = write_json(&loc.root().join("last-failure.json"), &error);
            Err(error)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static ID: AtomicU64 = AtomicU64::new(0);
    fn fixture() -> Locations {
        let base = std::env::temp_dir().join(format!(
            "hotori-delivery-{}-{}",
            std::process::id(),
            ID.fetch_add(1, Ordering::Relaxed)
        ));
        let loc = Locations {
            roaming: base.join("Roaming"),
            local: base.join("Local"),
        };
        let resources = loc.local.join("Discord/app-1.2.3/resources");
        fs::create_dir_all(&resources).unwrap();
        fs::write(resources.join("app.asar"), original()).unwrap();
        loc
    }
    fn original() -> Vec<u8> {
        let package = br#"{"name":"discord","main":"bundle.js","private":true}"#;
        let content = b"stock-bootstrap";
        let header=serde_json::to_vec(&serde_json::json!({"files":{"package.json":{"size":package.len(),"offset":"0"},"bundle.js":{"size":content.len(),"offset":package.len().to_string()}}})).unwrap();
        let aligned = (header.len() + 3) & !3;
        let mut out = Vec::new();
        for n in [4, aligned + 8, aligned + 4, header.len()] {
            out.extend_from_slice(&(n as u32).to_le_bytes())
        }
        out.extend_from_slice(&header);
        out.resize(16 + aligned, 0);
        out.extend_from_slice(package);
        out.extend_from_slice(content);
        out
    }
    fn clean(loc: &Locations) {
        fs::remove_dir_all(loc.roaming.parent().unwrap()).unwrap()
    }
    fn before_user_data(loc: &Locations) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        for (name,value)in [("Vencord/settings/settings.json",b"user plugins enabled".as_slice()),("Vencord/themes/hotori.theme.css",b"personal theme"),("Vencord/themes/devhotori.theme.css",b"personal dev"),("Hotori/TrueLiquidGlass/config.json",br#"{"schemaVersion":1,"revision":999,"requestedEnabled":true,"quality":"balanced"}"#)]{let p=loc.roaming.join(name);fs::create_dir_all(p.parent().unwrap()).unwrap();fs::write(&p,value).unwrap();files.insert(name.into(),value.to_vec());}
        files
    }
    fn preserved(loc: &Locations, files: &BTreeMap<String, Vec<u8>>) {
        for (n, b) in files {
            assert_eq!(&fs::read(loc.roaming.join(n)).unwrap(), b, "{}", n)
        }
    }
    #[test]
    fn embedded_payload_is_complete_and_excludes_private_artifacts() {
        let b = bundle().unwrap();
        assert_eq!(
            b.upstream_revision,
            "e75ac9ace41f6212cfaa2d5f3670830be392da4e"
        );
        for e in &b.files {
            assert!(
                ![
                    "rollback/",
                    "node_modules/",
                    ".git/",
                    ".build/",
                    "status/",
                    "settings/"
                ]
                .iter()
                .any(|n| e.path.starts_with(n))
            );
            assert!(!e.path.ends_with(".map"));
        }
        assert!(b.files.iter().any(|e| e.path == "sources/vencord.zip"));
        assert!(
            b.files
                .iter()
                .any(|e| e.path == "licenses/LiquidGlass-MIT.txt")
        );
        for p in [
            "../dist/patcher.js",
            "/dist/x",
            "dist/../x",
            "dist\\x",
            "C:/x",
        ] {
            assert!(!safe_relative(p))
        }
    }
    #[test]
    fn receive_is_not_install_and_stage_tampering_is_repaired() {
        let loc = fixture();
        let old = fs::read(loc.local.join("Discord/app-1.2.3/resources/app.asar")).unwrap();
        let first = status(&loc);
        assert!(first.payload_ready);
        assert_eq!(first.state, "ready");
        assert!(!loc.dist().exists());
        let b = bundle().unwrap();
        let p = loc
            .root()
            .join("payloads")
            .join(&b.id)
            .join("dist/renderer.js");
        fs::write(&p, "tampered").unwrap();
        assert!(status(&loc).payload_ready);
        assert_eq!(file_hash(&p).unwrap(), expected(&b)["renderer.js"]);
        assert_eq!(
            fs::read(loc.local.join("Discord/app-1.2.3/resources/app.asar")).unwrap(),
            old
        );
        clean(&loc);
    }
    #[test]
    fn first_install_verified_update_and_rollback_preserve_every_setting() {
        let loc = fixture();
        let user = before_user_data(&loc);
        let original = fs::read(loc.local.join("Discord/app-1.2.3/resources/app.asar")).unwrap();
        let installed = apply_impl(&loc, &|| Ok(()), false).unwrap();
        assert_eq!(installed.state, "pending_restart");
        assert_eq!(tree(&loc.dist()).unwrap(), expected(&bundle().unwrap()));
        preserved(&loc, &user);
        assert!(points_to(
            &loc.local.join("Discord/app-1.2.3/resources/app.asar"),
            &loc.dist().join("patcher.js")
        ));
        // A later owned update keeps a verified older runtime and receipt as rollback.
        let mut prior = journal(&loc).unwrap().unwrap();
        fs::write(loc.dist().join("renderer.js"), b"previous owned renderer").unwrap();
        prior.after = tree(&loc.dist()).unwrap();
        write_json(&loc.root().join("transaction.json"), &prior).unwrap();
        apply_impl(&loc, &|| Ok(()), false).unwrap();
        preserved(&loc, &user);
        rollback_impl(&loc, &|| Ok(())).unwrap();
        assert_eq!(
            fs::read(loc.dist().join("renderer.js")).unwrap(),
            b"previous owned renderer"
        );
        rollback_impl(&loc, &|| Ok(())).unwrap();
        assert!(!loc.dist().exists());
        assert_eq!(
            fs::read(loc.local.join("Discord/app-1.2.3/resources/app.asar")).unwrap(),
            original
        );
        preserved(&loc, &user);
        clean(&loc);
    }
    #[test]
    fn running_discord_guard_and_unknown_custom_build_never_overwrite() {
        let loc = fixture();
        let files = before_user_data(&loc);
        assert!(apply_impl(&loc, &|| Err("Discord running".into()), false).is_err());
        assert!(!loc.dist().exists());
        fs::create_dir_all(loc.dist()).unwrap();
        fs::write(loc.dist().join("renderer.js"), b"my custom plugins").unwrap();
        assert_eq!(status(&loc).state, "custom_build");
        assert!(apply_impl(&loc, &|| Ok(()), false).is_err());
        assert_eq!(
            fs::read(loc.dist().join("renderer.js")).unwrap(),
            b"my custom plugins"
        );
        preserved(&loc, &files);
        clean(&loc);
    }
    #[test]
    fn injection_failure_rolls_back_and_rejects_changed_backup() {
        let loc = fixture();
        let user = before_user_data(&loc);
        let error = apply_impl(&loc, &|| Ok(()), true).err().unwrap();
        assert!(error.contains("previous runtime was restored"));
        assert!(!loc.dist().exists());
        preserved(&loc, &user);
        apply_impl(&loc, &|| Ok(()), false).unwrap();
        // Replacing an installed owned file externally must not be erased by rollback.
        fs::write(loc.dist().join("renderer.js"), b"external edit").unwrap();
        assert!(rollback_impl(&loc, &|| Ok(())).is_err());
        assert_eq!(
            fs::read(loc.dist().join("renderer.js")).unwrap(),
            b"external edit"
        );
        preserved(&loc, &user);
        clean(&loc);
    }
    #[test]
    fn unknown_bootstrap_and_corrupt_journal_fail_closed() {
        let loc = fixture();
        fs::write(
            loc.local.join("Discord/app-1.2.3/resources/app.asar"),
            b"other mod",
        )
        .unwrap();
        assert_eq!(status(&loc).state, "blocked");
        assert!(apply_impl(&loc, &|| Ok(()), false).is_err());
        assert!(!loc.dist().exists());
        fs::write(
            loc.root().join("transaction.json"),
            br#"{"transaction":"../../outside"}"#,
        )
        .unwrap();
        assert_eq!(status(&loc).state, "failed");
        clean(&loc);
    }
    #[test]
    fn recognized_stock_policy_requires_exact_files_and_preserves_custom_additions() {
        let loc = fixture();
        let b = bundle().unwrap();
        for baseline in &b.baselines {
            assert!(eligible(&loc, &b, &baseline.files, None));
            let mut custom = baseline.files.clone();
            custom.insert("my-plugin.js".into(), "hash".into());
            assert!(!eligible(&loc, &b, &custom, None));
        }
        clean(&loc);
    }

    #[test]
    fn interrupted_update_recovers_and_corrupt_backup_is_never_restored() {
        let loc = fixture();
        let user = before_user_data(&loc);
        let calls = std::sync::atomic::AtomicU64::new(0);
        let guard = || {
            if calls.fetch_add(1, Ordering::Relaxed) >= 2 {
                Err("Discord started during operation".into())
            } else {
                Ok(())
            }
        };
        assert!(apply_impl(&loc, &guard, true).is_err());
        let pending = status(&loc);
        assert_eq!(pending.state, "recovery_required");
        assert!(pending.can_rollback);
        rollback_impl(&loc, &|| Ok(())).unwrap();
        assert!(!loc.dist().exists());
        preserved(&loc, &user);
        apply_impl(&loc, &|| Ok(()), false).unwrap();
        // A second installation creates an older runtime backup for the rollback test.
        apply_impl(&loc, &|| Ok(()), false).unwrap();
        let j = journal(&loc).unwrap().unwrap();
        let old = loc
            .root()
            .join("transactions")
            .join(j.transaction)
            .join("old-dist/renderer.js");
        fs::write(old, b"corrupt backup").unwrap();
        let current = tree(&loc.dist()).unwrap();
        assert!(rollback_impl(&loc, &|| Ok(())).is_err());
        assert_eq!(tree(&loc.dist()).unwrap(), current);
        preserved(&loc, &user);
        clean(&loc);
    }

    #[test]
    fn verified_files_remain_pending_until_fresh_post_install_connection() {
        let loc = fixture();
        apply_impl(&loc, &|| Ok(()), false).unwrap();
        assert_eq!(status(&loc).state, "pending_restart");
        let dir = loc.roaming.join("Hotori/TrueLiquidGlass/status");
        fs::create_dir_all(&dir).unwrap();
        let id = "71fb3a2d-4bc0-45ba-81cd-7b2dc574a2c0";
        let iso = |ms: u64| {
            let d =
                time::OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000).unwrap();
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                d.year(),
                d.month() as u8,
                d.day(),
                d.hour(),
                d.minute(),
                d.second(),
                d.millisecond()
            )
        };
        let report = |ms| serde_json::json!({"schemaVersion":1,"instanceId":id,"pid":123,"pluginEnabled":true,"requestedRevision":1,"appliedRevision":1,"requestedEnabled":false,"quality":"balanced","status":"disabled","reason":null,"updatedAt":iso(ms),"heartbeatExpiresAt":iso(ms+10000)});
        fs::write(
            dir.join(format!("{id}.json")),
            serde_json::to_vec(&report(now() - 20000)).unwrap(),
        )
        .unwrap();
        assert_eq!(status(&loc).state, "pending_restart");
        fs::write(
            dir.join(format!("{id}.json")),
            serde_json::to_vec(&report(now())).unwrap(),
        )
        .unwrap();
        assert_eq!(status(&loc).state, "installed");
        clean(&loc);
    }
}
