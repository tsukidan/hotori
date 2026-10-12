use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const API: &str = "https://api.github.com/repos/tsukidan/hotori/releases/latest";
const RELEASES: &str = "https://github.com/tsukidan/hotori/releases/download/";
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const MAX_EXE: u64 = 128 * 1024 * 1024;
const MANIFEST: &str = "hotori-update.json";
const SIGNATURE: &str = "hotori-update.json.sig";
const STAGE_PREFIX: &str = ".hotori-update-";

#[derive(Default)]
pub struct State(pub Arc<Mutex<Option<Candidate>>>);

#[derive(Clone)]
pub struct Candidate {
    manifest: Manifest,
    raw: Vec<u8>,
    signature: String,
    url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u32,
    version: String,
    platform: String,
    filename: String,
    size: u64,
    sha256: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub available: bool,
    pub current_version: String,
    pub version: String,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub percent: u32,
    pub phase: &'static str,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    target: PathBuf,
    parent_pid: u32,
    old_sha256: String,
}

fn client(seconds: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .https_only(true)
        .user_agent(concat!("Hotori/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(seconds))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("Unexpected update redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn response(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<reqwest::blocking::Response, String> {
    let result = client
        .get(url)
        .header(
            "Accept",
            if url == API {
                "application/vnd.github+json"
            } else {
                "application/octet-stream"
            },
        )
        .header("Cache-Control", "no-cache")
        .send()
        .map_err(|_| "Could not reach GitHub. Check your connection and try again.".to_owned())?;
    match result.status().as_u16() {
        200 => Ok(result),
        404 => Err("This app update is not published yet. Please try again later.".into()),
        403 | 429 => {
            Err("GitHub temporarily limited update requests. Please try again later.".into())
        }
        status => Err(format!(
            "GitHub returned HTTP {status}. Hotori has not been changed."
        )),
    }
}

fn read_limited(mut reader: impl Read, max: u64) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    reader
        .by_ref()
        .take(max + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > max {
        return Err("The update file exceeds its size limit.".into());
    }
    Ok(data)
}

fn hex_bytes(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid hexadecimal value.".into());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn public_key() -> Result<VerifyingKey, String> {
    let bytes: [u8; 32] = hex_bytes(include_str!("../assets/update-public-key.hex").trim())?
        .try_into()
        .map_err(|_| "Invalid update public key")?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| e.to_string())
}

fn stable_version(value: &str) -> Result<Version, String> {
    let version = Version::parse(value).map_err(|_| "The update version is invalid.")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Only stable app updates are supported.".into());
    }
    Ok(version)
}

fn verify_manifest(raw: &[u8], signature: &str, key: &VerifyingKey) -> Result<Manifest, String> {
    let bytes = STANDARD
        .decode(signature.trim())
        .map_err(|_| "Invalid update signature.")?;
    let signature = Signature::from_slice(&bytes).map_err(|_| "Invalid update signature.")?;
    key.verify_strict(raw, &signature)
        .map_err(|_| "The update signature could not be verified. Hotori has not been changed.")?;
    let manifest: Manifest =
        serde_json::from_slice(raw).map_err(|_| "Invalid signed update manifest.")?;
    stable_version(&manifest.version)?;
    if manifest.schema != 1
        || manifest.platform != "windows-x86_64"
        || manifest.filename != "hotori.exe"
        || !(1024..=MAX_EXE).contains(&manifest.size)
        || manifest.sha256.len() != 64
        || hex_bytes(&manifest.sha256).is_err()
    {
        return Err("This update is not compatible with Hotori on Windows.".into());
    }
    Ok(manifest)
}

fn asset_url(release: &Release, name: &str) -> Result<String, String> {
    let expected = format!("{RELEASES}{}/{name}", release.tag_name);
    let matches: Vec<_> = release
        .assets
        .iter()
        .filter(|asset| asset.name == name)
        .collect();
    if matches.len() != 1 || matches[0].browser_download_url != expected {
        return Err("This release does not include a complete signed app update yet.".into());
    }
    Ok(expected)
}

pub fn check() -> Result<(Check, Option<Candidate>), String> {
    let client = client(30)?;
    let raw = read_limited(response(&client, API)?, 512 * 1024)?;
    let release: Release =
        serde_json::from_slice(&raw).map_err(|_| "GitHub returned invalid release information.")?;
    let latest = stable_version(
        release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name),
    )?;
    if release.draft || release.prerelease {
        return Err("No stable Hotori release is available.".into());
    }
    if latest <= stable_version(CURRENT)? {
        return Ok((
            Check {
                available: false,
                current_version: CURRENT.into(),
                version: CURRENT.into(),
            },
            None,
        ));
    }
    let raw = read_limited(
        response(&client, &asset_url(&release, MANIFEST)?)?,
        16 * 1024,
    )?;
    let signature = String::from_utf8(read_limited(
        response(&client, &asset_url(&release, SIGNATURE)?)?,
        1024,
    )?)
    .map_err(|_| "Invalid update signature file.")?;
    let manifest = verify_manifest(&raw, &signature, &public_key()?)?;
    if stable_version(&manifest.version)? != latest {
        return Err("The signed update version does not match the release.".into());
    }
    let result = Check {
        available: true,
        current_version: CURRENT.into(),
        version: manifest.version.clone(),
    };
    let url = asset_url(&release, "hotori.exe")?;
    Ok((
        result,
        Some(Candidate {
            manifest,
            raw,
            signature,
            url,
        }),
    ))
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn verify_binary(path: &Path, manifest: &Manifest) -> Result<(), String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() != manifest.size
        || hash_file(path)? != manifest.sha256.to_ascii_lowercase()
    {
        return Err("The downloaded app failed verification. Hotori has not been changed.".into());
    }
    let mut magic = [0; 2];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut magic))
        .map_err(|e| e.to_string())?;
    if magic != *b"MZ" {
        return Err("The update is not a Windows executable.".into());
    }
    Ok(())
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

pub fn prepare(
    candidate: &Candidate,
    mut progress: impl FnMut(Progress),
) -> Result<PathBuf, String> {
    let target = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|e| e.to_string())?;
    let parent = target.parent().ok_or("Could not locate Hotori's folder.")?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let stage = parent.join(format!("{STAGE_PREFIX}{}-{stamp}", std::process::id()));
    fs::create_dir(&stage).map_err(|_| {
        "Hotori cannot write to its folder. Move the EXE to a writable folder and try again."
            .to_owned()
    })?;
    let result = (|| {
        progress(Progress {
            percent: 0,
            phase: "downloading",
        });
        let mut source = response(&client(300)?, &candidate.url)?;
        if source
            .content_length()
            .is_some_and(|n| n != candidate.manifest.size)
        {
            return Err("The download size does not match the signed update.".into());
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(stage.join("hotori.exe"))
            .map_err(|e| e.to_string())?;
        let mut buffer = [0u8; 64 * 1024];
        let (mut total, mut last_percent) = (0u64, 0u32);
        loop {
            let count = source
                .read(&mut buffer)
                .map_err(|_| "The download was interrupted. Please try again.")?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > candidate.manifest.size {
                return Err("The download exceeds its signed size.".into());
            }
            output
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
            let percent = (total * 100 / candidate.manifest.size) as u32;
            if percent != last_percent {
                progress(Progress {
                    percent,
                    phase: "downloading",
                });
                last_percent = percent;
            }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        progress(Progress {
            percent: 100,
            phase: "verifying",
        });
        verify_manifest(&candidate.raw, &candidate.signature, &public_key()?)?;
        verify_binary(&stage.join("hotori.exe"), &candidate.manifest)?;
        write_new(&stage.join(MANIFEST), &candidate.raw)?;
        write_new(&stage.join(SIGNATURE), candidate.signature.as_bytes())?;
        let old_sha256 = hash_file(&target)?;
        fs::copy(&target, stage.join("helper.exe")).map_err(|e| e.to_string())?;
        if hash_file(&stage.join("helper.exe"))? != old_sha256 {
            return Err("Could not prepare the update helper.".into());
        }
        let plan = Plan {
            target,
            parent_pid: std::process::id(),
            old_sha256,
        };
        write_new(
            &stage.join("plan.json"),
            &serde_json::to_vec(&plan).map_err(|e| e.to_string())?,
        )?;
        Ok(stage.clone())
    })();
    if result.is_err() {
        cleanup(&stage);
    }
    result
}

fn hidden_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    command
}

pub fn launch_helper(stage: &Path) -> Result<(), String> {
    let mut child = hidden_command(&stage.join("helper.exe"))
        .arg("--apply-app-update")
        .arg(stage)
        .spawn()
        .map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("The update helper could not start. Hotori is still running.".into());
        }
        if stage.join("helper-ready").is_file() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("The update helper did not respond. Please try again.".into())
}

fn stage_plan(stage: &Path) -> Result<(PathBuf, Plan, Manifest), String> {
    let stage = fs::canonicalize(stage).map_err(|e| e.to_string())?;
    if !stage
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.starts_with(STAGE_PREFIX))
    {
        return Err("Invalid update folder.".into());
    }
    let plan: Plan = serde_json::from_slice(&read_limited(
        fs::File::open(stage.join("plan.json")).map_err(|e| e.to_string())?,
        16 * 1024,
    )?)
    .map_err(|_| "Invalid update plan.")?;
    let target = fs::canonicalize(&plan.target).map_err(|e| e.to_string())?;
    if target != plan.target
        || target.parent() != stage.parent()
        || target
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            != Some("exe".into())
    {
        return Err("The update target is outside Hotori's folder.".into());
    }
    let raw = read_limited(
        fs::File::open(stage.join(MANIFEST)).map_err(|e| e.to_string())?,
        16 * 1024,
    )?;
    let signature = String::from_utf8(read_limited(
        fs::File::open(stage.join(SIGNATURE)).map_err(|e| e.to_string())?,
        1024,
    )?)
    .map_err(|e| e.to_string())?;
    let manifest = verify_manifest(&raw, &signature, &public_key()?)?;
    Ok((stage, plan, manifest))
}

#[cfg(windows)]
fn wait_for_parent(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, GetLastError, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };
    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if process.is_null() {
        return if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
            Ok(())
        } else {
            Err("Could not wait for Hotori to close.".into())
        };
    }
    let result = unsafe { WaitForSingleObject(process, 60_000) };
    unsafe {
        CloseHandle(process);
    }
    if result != WAIT_OBJECT_0 {
        return Err("Hotori did not close in time. The update was cancelled.".into());
    }
    Ok(())
}

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn replace_exe(target: &Path, replacement: &Path, backup: &Path) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let (target, replacement, backup) = (wide(target), wide(replacement), wide(backup));
    if unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            backup.as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn restore_exe(target: &Path, backup: &Path) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let (target, backup) = (wide(target), wide(backup));
    if unsafe {
        MoveFileExW(
            backup.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn helper(stage: &Path) -> Result<(), String> {
    let (stage, plan, manifest) = stage_plan(stage)?;
    let own = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|e| e.to_string())?;
    if own != stage.join("helper.exe")
        || hash_file(&own)? != plan.old_sha256
        || hash_file(&plan.target)? != plan.old_sha256
    {
        return Err("Hotori changed before the update could start.".into());
    }
    if stable_version(&manifest.version)? <= stable_version(CURRENT)? {
        return Err("Refusing an older or identical app update.".into());
    }
    verify_binary(&stage.join("hotori.exe"), &manifest)?;
    write_new(&stage.join("helper-ready"), b"ready")?;
    wait_for_parent(plan.parent_pid)?;
    if hash_file(&plan.target)? != plan.old_sha256 {
        return Err("Hotori changed during the update.".into());
    }
    verify_binary(&stage.join("hotori.exe"), &manifest)?;
    let backup = stage.join("previous.exe");
    let result: Result<(), String> = (|| {
        replace_exe(&plan.target, &stage.join("hotori.exe"), &backup)?;
        let mut child = hidden_command(&plan.target)
            .arg("--finish-app-update")
            .arg(&stage)
            .spawn()
            .map_err(|e| e.to_string())?;
        let until = Instant::now() + Duration::from_secs(45);
        while Instant::now() < until {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("The new app closed before it could start.".into());
            }
            if stage.join("app-ready").is_file() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
        Err("The new app did not start in time.".into())
    })();
    if let Err(error) = result {
        if backup.exists() {
            restore_exe(&plan.target, &backup).map_err(|restore| {
                format!(
                    "{error} Could not restore the previous app: {restore}. It is saved in {}.",
                    backup.display()
                )
            })?;
        }
        if hash_file(&plan.target)? == plan.old_sha256 {
            let _ = hidden_command(&plan.target).spawn();
        }
        return Err(format!("{error} The previous version was restored."));
    }
    Ok(())
}

fn cleanup(stage: &Path) {
    // Only fixed updater-owned names are removed; never recursively delete a computed directory.
    for name in [
        "hotori.exe",
        "helper.exe",
        "previous.exe",
        MANIFEST,
        SIGNATURE,
        "plan.json",
        "helper-ready",
        "app-ready",
    ] {
        let _ = fs::remove_file(stage.join(name));
    }
    let _ = fs::remove_dir(stage);
}

pub fn complete_startup() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|s| s != "--finish-app-update") {
        return Ok(());
    }
    let stage = args.get(2).ok_or("Missing update completion folder.")?;
    let (stage, plan, manifest) = stage_plan(Path::new(stage))?;
    let own = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|e| e.to_string())?;
    if own != plan.target || manifest.version != CURRENT {
        return Err("The updated app version does not match its signed manifest.".into());
    }
    verify_binary(&own, &manifest)?;
    write_new(&stage.join("app-ready"), b"ready")?;
    std::thread::spawn(move || {
        // Let the helper observe the startup acknowledgement and exit before removing its files.
        std::thread::sleep(Duration::from_secs(2));
        for _ in 0..30 {
            // A running helper cannot be deleted on Windows. Keep the receipt/backup until it exits.
            if fs::remove_file(stage.join("helper.exe")).is_ok() {
                cleanup(&stage);
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    Ok(())
}

pub fn helper_entry() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|s| s != "--apply-app-update") {
        return false;
    }
    #[cfg(windows)]
    {
        let result = args
            .get(2)
            .ok_or_else(|| "Missing update folder.".to_owned())
            .and_then(|s| helper(Path::new(s)));
        if let Err(error) = result {
            use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
            let text: Vec<u16> = error.encode_utf16().chain(Some(0)).collect();
            let title: Vec<u16> = "Hotori update".encode_utf16().chain(Some(0)).collect();
            unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    text.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed(version: &str, data: &[u8]) -> (Vec<u8>, String, VerifyingKey) {
        let key = SigningKey::from_bytes(&[42; 32]);
        let manifest = Manifest {
            schema: 1,
            version: version.into(),
            platform: "windows-x86_64".into(),
            filename: "hotori.exe".into(),
            size: data.len() as u64,
            sha256: format!("{:x}", Sha256::digest(data)),
        };
        let raw = serde_json::to_vec(&manifest).unwrap();
        let signature = STANDARD.encode(key.sign(&raw).to_bytes());
        (raw, signature, key.verifying_key())
    }

    #[test]
    fn signatures_bind_version_size_platform_and_hash() {
        let data = vec![0u8; 1024];
        let (raw, signature, key) = signed("1.2.0", &data);
        assert_eq!(
            verify_manifest(&raw, &signature, &key).unwrap().version,
            "1.2.0"
        );
        let mut tampered = raw.clone();
        tampered[12] ^= 1;
        assert!(verify_manifest(&tampered, &signature, &key).is_err());
        assert!(verify_manifest(&raw, "invalid", &key).is_err());
        assert!(
            verify_manifest(
                &raw,
                &signature,
                &SigningKey::from_bytes(&[43; 32]).verifying_key()
            )
            .is_err()
        );
        let (raw, signature, key) = signed("1.2.0-beta.1", &data);
        assert!(verify_manifest(&raw, &signature, &key).is_err());
        assert!(stable_version("1.10.0").unwrap() > stable_version("1.9.0").unwrap());
        assert!(read_limited(&b"12345"[..], 4).is_err());
    }

    #[test]
    fn reject_untrusted_or_missing_release_assets() {
        let mut release = Release {
            tag_name: "v1.2.0".into(),
            draft: false,
            prerelease: false,
            assets: vec![],
        };
        assert!(asset_url(&release, MANIFEST).is_err());
        release.assets.push(Asset {
            name: MANIFEST.into(),
            browser_download_url: format!("{RELEASES}v1.2.0/{MANIFEST}"),
        });
        assert!(asset_url(&release, MANIFEST).is_ok());
        release.assets[0].browser_download_url = "https://example.com/hotori-update.json".into();
        assert!(asset_url(&release, MANIFEST).is_err());
    }

    #[test]
    fn corrupted_binary_is_rejected_before_replacement() {
        let path =
            std::env::temp_dir().join(format!("hotori-integrity-{}.exe", std::process::id()));
        let mut data = vec![0; 1024];
        data[..2].copy_from_slice(b"MZ");
        let (raw, signature, key) = signed("1.2.0", &data);
        let manifest = verify_manifest(&raw, &signature, &key).unwrap();
        fs::write(&path, &data).unwrap();
        verify_binary(&path, &manifest).unwrap();
        data[100] = 1;
        fs::write(&path, &data).unwrap();
        assert!(verify_binary(&path, &manifest).is_err());
        fs::remove_file(path).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn replacement_keeps_a_recoverable_previous_exe() {
        let dir = std::env::temp_dir().join(format!("hotori-replace-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (target, next, backup) = (
            dir.join("hotori.exe"),
            dir.join("next.exe"),
            dir.join("previous.exe"),
        );
        fs::write(&target, b"original").unwrap();
        fs::write(&next, b"updated").unwrap();
        replace_exe(&target, &next, &backup).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"updated");
        assert_eq!(fs::read(&backup).unwrap(), b"original");
        restore_exe(&target, &backup).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(target).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
