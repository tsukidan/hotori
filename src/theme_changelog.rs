use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Read, path::Path, time::Duration};

const BUNDLED: &str = include_str!("../assets/theme-changelog.json");
const LIMIT: u64 = 128 * 1024;
const SOURCE: &str =
    "https://api.github.com/repos/tsukidan/hotori/contents/assets/theme-changelog.json";

#[derive(Clone, Deserialize, Serialize)]
pub struct Note {
    title: String,
    description: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    schema_version: u32,
    versions: BTreeMap<String, Vec<Note>>,
}
fn parse(text: &str) -> Result<Catalog, String> {
    if text.len() > LIMIT as usize {
        return Err("Theme changelog exceeds its size limit.".into());
    }
    let catalog: Catalog = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if catalog.schema_version != 1 || catalog.versions.len() > 256 {
        return Err("Unsupported theme changelog.".into());
    }
    for (version, notes) in &catalog.versions {
        if semver::Version::parse(version).is_err() || notes.is_empty() || notes.len() > 12 {
            return Err("Invalid theme changelog version or notes.".into());
        }
        if notes.iter().any(|note| {
            note.title.trim().is_empty()
                || note.description.trim().is_empty()
                || note.title.len() > 100
                || note.description.len() > 600
        }) {
            return Err("Invalid theme changelog text.".into());
        }
    }
    Ok(catalog)
}
fn download() -> Result<Catalog, String> {
    let response = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("Hotori/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?
        .get(SOURCE)
        .header("Accept", "application/vnd.github.raw+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Cache-Control", "no-cache")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|size| size > LIMIT) {
        return Err("Theme changelog is too large.".into());
    }
    let mut text = String::new();
    response
        .take(LIMIT + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    parse(&text)
}
pub fn load(cache_dir: &Path, refresh: bool) -> Catalog {
    let path = cache_dir.join("theme-changelog.json");
    let bundled = parse(BUNDLED).expect("Valid bundled theme changelog");
    let mut catalog = bundled;
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() <= LIMIT) {
        if let Ok(cached) = fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| parse(&text))
        {
            catalog.versions.extend(cached.versions);
        }
    }
    if refresh {
        if let Ok(remote) = download() {
            catalog.versions.extend(remote.versions);
            if fs::create_dir_all(cache_dir).is_ok() {
                if let Ok(text) = serde_json::to_string(&catalog) {
                    let _ = fs::write(&path, text);
                }
            }
        }
    }
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_bundled_theme_and_history() {
        let catalog = parse(BUNDLED).unwrap();
        let theme_version = crate::installer::BUNDLED_THEME
            .lines()
            .find_map(|line| line.trim().strip_prefix("* @version "))
            .unwrap()
            .trim();
        assert!(
            catalog.versions.contains_key(theme_version),
            "Every published theme must include release notes"
        );
        for version in ["0.7.1", "0.8.0", "0.8.10", "0.8.11", "0.8.12"] {
            assert!(catalog.versions.contains_key(version));
        }
    }
    #[test]
    fn rejects_invalid_or_oversized_catalogs() {
        for invalid in [
            r#"{"schemaVersion":2,"versions":{}}"#,
            r#"{"schemaVersion":1,"versions":{"bad":[]}}"#,
            r#"{"schemaVersion":1,"versions":{"0.8.12":[{"title":"","description":"empty"}]}}"#,
        ] {
            assert!(parse(invalid).is_err());
        }
        assert!(parse(&" ".repeat(LIMIT as usize + 1)).is_err());
    }
    #[test]
    fn cached_future_notes_work_offline_and_bad_cache_falls_back() {
        let cache = std::env::temp_dir().join(format!("hotori-changelog-{}", std::process::id()));
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("theme-changelog.json"), r#"{"schemaVersion":1,"versions":{"0.9.0":[{"title":"New theme","description":"Future release."}]}}"#).unwrap();
        let catalog = load(&cache, false);
        assert!(catalog.versions.contains_key("0.9.0"));
        assert!(catalog.versions.contains_key("0.8.12"));
        fs::write(cache.join("theme-changelog.json"), "broken").unwrap();
        assert!(load(&cache, false).versions.contains_key("0.8.12"));
        fs::remove_dir_all(cache).unwrap();
    }
}
