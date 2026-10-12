use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    ops::Range,
    path::Path,
    time::Duration,
};

const SOURCE: &str =
    "https://api.github.com/repos/tsukidan/hotori/contents/assets/hotori.theme.css";
const LIMIT: u64 = 2 * 1024 * 1024;
const MARKER: &str = "END OF USER SETTINGS";

#[derive(Serialize)]
pub struct UpdateResult {
    pub changed: bool,
    pub version: String,
}

pub fn update(folder: &Path) -> Result<UpdateResult, String> {
    let path = folder.join(crate::installer::DESTINATION);
    let original = fs::read_to_string(&path)
        .map_err(|_| "Install Hotori before updating its theme.".to_owned())?;
    let published = download()?;
    // Cache the uncustomized source so Reset and slider bounds use the published defaults.
    // Prepare it before touching the installed theme; an unwritable cache must not leave a partial update.
    merge(&original, &published)?;
    let cache = folder.join("hotori-assets").join("theme-defaults.css");
    fs::create_dir_all(cache.parent().unwrap()).map_err(|e| e.to_string())?;
    let previous = match fs::read_to_string(&cache) {
        Ok(value) => Some(value),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    replace(&cache, previous.as_deref(), &published)?;
    apply(&path, &original, &published)
}

pub fn defaults(folder: &Path) -> crate::customization::Settings {
    let cached = fs::read_to_string(folder.join("hotori-assets/theme-defaults.css")).ok();
    let installed = fs::read_to_string(folder.join(crate::installer::DESTINATION)).ok();
    if let (Some(source), Some(installed)) = (cached, installed) {
        if metadata(&source, "@name") == Some("Hotori")
            && metadata(&source, "@version") == metadata(&installed, "@version")
            && variables(&source).is_ok()
        {
            if let Ok(parsed) = crate::customization::parse(source) {
                return parsed;
            }
        }
    }
    crate::customization::parse(crate::installer::BUNDLED_THEME.to_owned())
        .expect("Bundled theme defaults")
}

fn download() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Hotori/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(SOURCE)
        .header("Accept", "application/vnd.github.raw+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Cache-Control", "no-cache")
        .send()
        .map_err(|e| format!("Could not reach GitHub. Check your connection and try again. {e}"))?;
    read_download(response)
}

fn read_download(response: reqwest::blocking::Response) -> Result<String, String> {
    match response.status().as_u16() {
        200 => {},
        404 => return Err("The published theme is unavailable. Publish assets/hotori.theme.css in the public tsukidan/hotori repository.".into()),
        403 | 429 => return Err("GitHub temporarily limited update requests. Please try again later.".into()),
        status => return Err(format!("GitHub returned HTTP {status}. Your installed theme was not changed.")),
    }
    if response.content_length().is_some_and(|size| size > LIMIT) {
        return Err("The published theme exceeds the 2 MB download limit.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("The published theme exceeds the 2 MB download limit.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The published theme is not valid UTF-8.".into())
}

// Keep byte offsets intact while masking comments. Reject incomplete downloads before writing.
fn mask_comments(css: &str) -> Result<Vec<u8>, String> {
    let bytes = css.as_bytes();
    let mut masked = bytes.to_vec();
    let (mut i, mut quote, mut stack) = (0, None, Vec::new());
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
            }
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let start = i;
            i += 2;
            while i + 1 < bytes.len() && &bytes[i..i + 2] != b"*/" {
                i += 1;
            }
            if i + 1 >= bytes.len() {
                return Err("Theme contains an unfinished comment.".into());
            }
            i += 2;
            for byte in &mut masked[start..i] {
                if *byte != b'\n' && *byte != b'\r' {
                    *byte = b' ';
                }
            }
            continue;
        } else {
            match b {
                b'\'' | b'"' => quote = Some(b),
                b'{' | b'(' | b'[' => stack.push(b),
                b'}' | b')' | b']' => {
                    let expected = match b {
                        b'}' => b'{',
                        b')' => b'(',
                        _ => b'[',
                    };
                    if stack.pop() != Some(expected) {
                        return Err("Theme contains unbalanced CSS.".into());
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    if quote.is_some() || !stack.is_empty() {
        return Err("Theme contains incomplete CSS.".into());
    }
    Ok(masked)
}

struct Variable {
    name: String,
    value: String,
    range: Range<usize>,
}

// All settings, including variables hidden from the UI and future additions, are preserved.
// The published theme keeps one declaration per line, as in assets/hotori.theme.css.
fn variables(css: &str) -> Result<Vec<Variable>, String> {
    if css.matches(MARKER).count() != 1 {
        return Err("Theme must contain exactly one user-settings marker.".into());
    }
    let end = css.find(MARKER).unwrap();
    let masked = mask_comments(css)?;
    let prefix = std::str::from_utf8(&masked[..end]).map_err(|e| e.to_string())?;
    let mut variables = Vec::new();
    let mut offset = 0;
    for line in prefix.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("--") {
            let start = offset + line.len() - trimmed.len();
            let colon = trimmed
                .find(':')
                .ok_or("Invalid user setting declaration.")?;
            let name = &trimmed[..colon];
            if !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                return Err("Invalid user setting name.".into());
            }
            let value_start = start + colon + 1;
            let (mut i, mut quote, mut depth) = (value_start, None, 0usize);
            while i < end {
                let b = masked[i];
                if let Some(q) = quote {
                    if b == b'\\' {
                        i += 2;
                        continue;
                    }
                    if b == q {
                        quote = None;
                    }
                } else {
                    match b {
                        b'\'' | b'"' => quote = Some(b),
                        b'(' => depth += 1,
                        b')' => depth = depth.checked_sub(1).ok_or("Invalid setting value.")?,
                        b';' if depth == 0 => break,
                        b'{' | b'}' => return Err("Missing semicolon in user settings.".into()),
                        _ => {}
                    }
                }
                i += 1;
            }
            if i == end {
                return Err("Missing semicolon in user settings.".into());
            }
            let tail_end = masked[i + 1..end]
                .iter()
                .position(|b| *b == b'\n')
                .map_or(end, |n| i + 1 + n);
            let tail = std::str::from_utf8(&masked[i + 1..tail_end])
                .map_err(|e| e.to_string())?
                .trim();
            if !tail.is_empty() && tail != "}" {
                return Err("Keep each user-setting declaration on its own line before updating. Nothing was updated.".into());
            }
            let value = css[value_start..i].trim().to_owned();
            if value.is_empty() {
                return Err("Empty user setting value.".into());
            }
            variables.push(Variable {
                name: name.into(),
                value,
                range: value_start..i,
            });
        }
        offset += line.len();
    }
    if variables.is_empty() {
        return Err("Theme has no user settings.".into());
    }
    let mut seen = HashMap::new();
    for variable in &variables {
        if seen
            .insert(&variable.name, &variable.value)
            .is_some_and(|v| v != &variable.value)
        {
            return Err(format!(
                "Conflicting values for {}. Nothing was updated.",
                variable.name
            ));
        }
    }
    Ok(variables)
}

fn metadata<'a>(css: &'a str, key: &str) -> Option<&'a str> {
    let header = css.trim_start().strip_prefix("/**")?.split_once("*/")?.0;
    header.lines().find_map(|line| {
        line.trim()
            .trim_start_matches('*')
            .trim()
            .strip_prefix(key)?
            .strip_prefix(' ')
            .map(str::trim)
    })
}

fn merge(original: &str, published: &str) -> Result<(String, String), String> {
    if metadata(published, "@name") != Some("Hotori") {
        return Err("The published file is not the Hotori release theme.".into());
    }
    let version = metadata(published, "@version")
        .filter(|v| !v.is_empty() && v.len() <= 64 && !v.chars().any(char::is_control))
        .ok_or("The published theme is missing its version.")?
        .to_owned();
    let current = variables(original)?;
    let latest = variables(published)?;
    let masked = mask_comments(published)?;
    if !masked[published.find(MARKER).unwrap()..].contains(&b'{') {
        return Err("The published theme has no implementation. Nothing was updated.".into());
    }
    for required in ["--main-color", "--main-bg", "--settings-bg"] {
        if !latest.iter().any(|v| v.name == required) {
            return Err(format!(
                "The published theme is missing {required}. Nothing was updated."
            ));
        }
    }
    let old: HashMap<_, _> = current.iter().map(|v| (&v.name, &v.value)).collect();
    let mut merged = published.to_owned();
    for variable in latest.iter().rev() {
        if let Some(value) = old.get(&variable.name) {
            merged.replace_range(variable.range.clone(), &format!(" {value}"));
        }
    }
    variables(&merged)?;
    crate::customization::parse(merged.clone()).map_err(|e| e.to_string())?;
    Ok((merged, version))
}

fn apply(path: &Path, original: &str, published: &str) -> Result<UpdateResult, String> {
    let (merged, version) = merge(original, published)?;
    if fs::read_to_string(path).map_err(|e| e.to_string())? != original {
        return Err(
            "Your theme changed while downloading. Try updating again to preserve those changes."
                .into(),
        );
    }
    let changed = merged != original;
    if changed {
        replace(path, Some(original), &merged)?;
    }
    Ok(UpdateResult { changed, version })
}

// Stage and flush beside the installed file, then replace in one filesystem operation.
fn replace(path: &Path, expected: Option<&str>, content: &str) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = path.with_extension(format!("update-{}-{stamp}.tmp", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        let actual = match fs::read_to_string(path) {
            Ok(value) => Some(value),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        if actual.as_deref() != expected {
            return Err("Your theme changed during the update. Try again.".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
            }
            let from: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloaded_defaults_survive_restart_and_ignore_mismatched_versions() {
        let folder =
            std::env::temp_dir().join(format!("hotori-default-cache-test-{}", std::process::id()));
        fs::create_dir_all(folder.join("hotori-assets")).unwrap();
        let published = BUNDLED_THEME
            .replace("@version 0.7.1", "@version 0.8.0")
            .replace("--blur-val: 24px;", "--blur-val: 30px;");
        let path = folder.join("hotori-assets/theme-defaults.css");
        replace(&path, None, &published).unwrap();
        let installed = folder.join(crate::installer::DESTINATION);
        fs::write(
            &installed,
            published.replace("--blur-val: 30px;", "--blur-val: 33px;"),
        )
        .unwrap();
        assert_eq!(
            defaults(&folder)
                .fields
                .iter()
                .find(|v| v.0 == "--blur-val")
                .unwrap()
                .1,
            "30px"
        );
        fs::write(&installed, BUNDLED_THEME).unwrap();
        assert_eq!(
            defaults(&folder)
                .fields
                .iter()
                .find(|v| v.0 == "--blur-val")
                .unwrap()
                .1,
            "24px"
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn http_download_handles_success_missing_file_rate_limit_and_oversize() {
        use std::net::TcpListener;
        for (status, body) in [
            (200, BUNDLED_THEME.as_bytes().to_vec()),
            (404, b"Not Found".to_vec()),
            (429, Vec::new()),
            (200, vec![b'x'; LIMIT as usize + 1]),
            (200, vec![0xff]),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let expected = body.clone();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request).unwrap();
                let header = format!(
                    "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                socket.write_all(header.as_bytes()).unwrap();
                let _ = socket.write_all(&body);
            });
            let response = reqwest::blocking::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(format!("http://{address}"))
                .send()
                .unwrap();
            let result = read_download(response);
            if status == 200 && expected == BUNDLED_THEME.as_bytes() {
                assert_eq!(result.unwrap(), BUNDLED_THEME);
            } else {
                assert!(result.is_err());
            }
            server.join().unwrap();
        }
    }
    use crate::installer::BUNDLED_THEME;

    #[test]
    fn update_preserves_all_settings_and_uses_new_defaults_and_implementation() {
        let original = BUNDLED_THEME
            .replace(
                "--main-color: #5865f2;",
                "--main-color: #123456 !important;",
            )
            .replace(
                "--main-bg: none;",
                "--main-bg: url('vencord:///themes/hotori-assets/0123456789abcdef.png');",
            )
            .replace(
                "--settings-bg: none;",
                "--settings-bg: url('https://example.com/a;b.jpg');",
            )
            .replace("--chat-input-gap: 0px;", "--chat-input-gap: 7px;")
            .replace(
                "--server-list-top-padding: 12px;",
                "--server-list-top-padding: 21px;",
            );
        let published = BUNDLED_THEME
            .replace("@version 0.7.1", "@version 0.8.0")
            .replace(
                "--blur-val: 24px;",
                "--blur-val: 30px;\n    --new-option: 13px;",
            )
            + "\n.new-implementation { color: blue; }\n";
        let (merged, version) = merge(&original, &published).unwrap();
        assert_eq!(version, "0.8.0");
        for old in variables(&original).unwrap() {
            assert_eq!(
                variables(&merged)
                    .unwrap()
                    .iter()
                    .find(|v| v.name == old.name)
                    .unwrap()
                    .value,
                old.value,
                "{}",
                old.name
            );
        }
        assert!(merged.contains("--new-option: 13px;"));
        assert!(merged.ends_with(".new-implementation { color: blue; }\n"));
        assert!(merged.contains("@version 0.8.0"));
        assert_eq!(merge(&merged, &published).unwrap().0, merged);
    }

    #[test]
    fn rejects_invalid_or_ambiguous_downloads_without_touching_installed_theme() {
        let path =
            std::env::temp_dir().join(format!("hotori-update-test-{}.css", std::process::id()));
        fs::write(&path, BUNDLED_THEME).unwrap();
        for invalid in [
            "<html>Not Found</html>".to_owned(),
            BUNDLED_THEME.replace("@name Hotori", "@name Hotori DEV"),
            BUNDLED_THEME.replace(MARKER, "missing"),
            format!("{BUNDLED_THEME}\n.broken {{"),
            BUNDLED_THEME.replace(
                "--main-color: #5865f2;",
                "--main-color: #5865f2;\n--main-color: #ffffff;",
            ),
        ] {
            assert!(apply(&path, BUNDLED_THEME, &invalid).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), BUNDLED_THEME);
        }
        let published = BUNDLED_THEME.replace("@version 0.7.1", "@version 0.8.0");
        fs::write(&path, format!("{BUNDLED_THEME}\n/* external change */")).unwrap();
        assert!(apply(&path, BUNDLED_THEME, &published).is_err());
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .ends_with("/* external change */")
        );
        fs::write(&path, BUNDLED_THEME).unwrap();
        assert!(apply(&path, BUNDLED_THEME, &published).unwrap().changed);
        let updated = fs::read_to_string(&path).unwrap();
        assert!(updated.contains("@version 0.8.0"));
        assert!(!apply(&path, &updated, &published).unwrap().changed);
        fs::remove_file(path).unwrap();
    }
}
