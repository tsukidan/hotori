//! User-owned theme snapshots. Never package these with the app or mutate CSS on capture.
use crate::{
    customization::{self, Settings},
    settings, true_liquid_glass,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
static WRITER: Mutex<()> = Mutex::new(());
const MAX_FILE: u64 = 4 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Companion {
    pub requested_enabled: bool,
    pub quality: true_liquid_glass::Quality,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub values: BTreeMap<String, String>,
    pub companion: Option<Companion>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Library {
    schema_version: u8,
    presets: Vec<Preset>,
}

pub fn path() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("APPDATA").ok_or("Could not locate AppData.")?)
            .join("Hotori")
            .join("presets.json"),
    )
}
fn read(path: &Path) -> Result<Library, String> {
    if !path.exists() {
        return Ok(Library {
            schema_version: 1,
            presets: vec![],
        });
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE {
        return Err("Preset library is too large.".into());
    }
    let library: Library = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Preset library could not be read. Your saved file has been kept.")?;
    if library.schema_version != 1 || library.presets.len() > 100 {
        return Err("Unsupported preset library. Your saved file has been kept.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for preset in &library.presets {
        if preset.id.is_empty()
            || !ids.insert(&preset.id)
            || preset.name.trim().is_empty()
            || preset.name.chars().count() > 80
            || preset.values.len() > 500
        {
            return Err("Invalid preset library. Your saved file has been kept.".into());
        }
    }
    Ok(library)
}
fn write(path: &Path, library: &Library) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("Preset library is full.".into());
    }
    fs::create_dir_all(path.parent().ok_or("Invalid preset storage path.")?)
        .map_err(|e| e.to_string())?;
    true_liquid_glass::atomic_write(path, &bytes).map_err(|e| e.to_string())
}
pub fn list(path: &Path) -> Result<Vec<Preset>, String> {
    Ok(read(path)?.presets)
}
pub fn capture(
    path: &Path,
    current: &Settings,
    edits: &[settings::Edit],
    name: &str,
    companion: Option<Companion>,
) -> Result<Vec<Preset>, String> {
    let _lock = WRITER.lock().map_err(|e| e.to_string())?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Enter a preset name between 1 and 80 characters.".into());
    }
    let mut library = read(path)?;
    if library.presets.len() >= 100 {
        return Err("You can save up to 100 presets. Delete one before adding another.".into());
    }
    let values = settings::values(current, edits)?;
    let mut saved = BTreeMap::new();
    for ((key, old, _), value) in current.fields.iter().zip(values) {
        if value != *old {
            customization::validate(key, &value).map_err(|e| e.to_string())?;
        }
        saved.insert(key.clone(), value);
    }
    let id = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    library.presets.push(Preset {
        id,
        name: name.into(),
        values: saved,
        companion,
    });
    write(path, &library)?;
    Ok(library.presets)
}
pub fn delete(path: &Path, id: &str) -> Result<Vec<Preset>, String> {
    let _lock = WRITER.lock().map_err(|e| e.to_string())?;
    let mut library = read(path)?;
    let previous = library.presets.len();
    library.presets.retain(|p| p.id != id);
    if previous == library.presets.len() {
        return Err("This preset no longer exists. Reopen Presets.".into());
    }
    write(path, &library)?;
    Ok(library.presets)
}
pub fn rename(path: &Path, id: &str, name: &str) -> Result<Vec<Preset>, String> {
    let _lock = WRITER.lock().map_err(|e| e.to_string())?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Enter a preset name between 1 and 80 characters.".into());
    }
    let mut library = read(path)?;
    let preset = library
        .presets
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("This preset no longer exists. Reopen Presets.")?;
    preset.name = name.into();
    write(path, &library)?;
    Ok(library.presets)
}
pub fn find(path: &Path, id: &str) -> Result<Preset, String> {
    list(path)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "This preset no longer exists. Reopen Presets.".into())
}
pub fn apply(
    theme: &Path,
    folder: &Path,
    current: &Settings,
    preset: &Preset,
) -> Result<Settings, String> {
    let values: Vec<_> = current
        .fields
        .iter()
        .map(|(name, value, _)| {
            preset
                .values
                .get(name)
                .cloned()
                .unwrap_or_else(|| value.clone())
        })
        .collect();
    for ((name, _, _), value) in current.fields.iter().zip(&values) {
        if customization::is_image(name) {
            let uri = customization::display_value(name, value);
            if crate::wallpapers::valid_uri(&uri)
                && !folder
                    .join("hotori-assets")
                    .join(uri.rsplit('/').next().unwrap_or(""))
                    .is_file()
            {
                return Err(format!(
                    "The saved image for {} is missing. Restore it before applying this preset.",
                    customization::label(name)
                ));
            }
        }
    }
    customization::save(theme, current, &values).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(tag: &str) -> (PathBuf, Settings) {
        let root =
            std::env::temp_dir().join(format!("hotori-presets-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("theme.css"), crate::installer::BUNDLED_THEME).unwrap();
        (
            root,
            customization::parse(crate::installer::BUNDLED_THEME.into()).unwrap(),
        )
    }
    fn edits(s: &Settings) -> Vec<settings::Edit> {
        s.fields
            .iter()
            .map(|(n, v, _)| settings::Edit {
                name: n.clone(),
                value: customization::display_value(n, v),
            })
            .collect()
    }
    #[test]
    fn capture_apply_reload_delete_preserves_theme_and_alpha() {
        let (root, current) = setup("roundtrip");
        let library = root.join("presets.json");
        assert!(list(&library).unwrap().is_empty());
        let mut e = edits(&current);
        e.iter_mut()
            .find(|e| e.name == "--main-color")
            .unwrap()
            .value = "#abcdef".into();
        e.iter_mut()
            .find(|e| e.name == "--message-bubble-self-tint")
            .unwrap()
            .value = "#12345678".into();
        let presets = capture(
            &library,
            &current,
            &e,
            "  My theme  ",
            Some(Companion {
                requested_enabled: true,
                quality: true_liquid_glass::Quality::High,
            }),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("theme.css")).unwrap(),
            current.original
        );
        assert_eq!(presets[0].name, "My theme");
        let reloaded = find(&library, &presets[0].id).unwrap();
        assert_eq!(reloaded.values["--message-bubble-self-tint"], "#12345678");
        assert!(reloaded.companion.as_ref().unwrap().requested_enabled);
        let next = apply(&root.join("theme.css"), &root, &current, &reloaded).unwrap();
        assert!(next.original.contains("--main-color: #abcdef;"));
        assert!(
            next.original
                .contains("--message-bubble-self-tint: #12345678;")
        );
        let renamed = rename(&library, &reloaded.id, "  Renamed  ").unwrap();
        assert_eq!(renamed[0].name, "Renamed");
        assert_eq!(renamed[0].values, reloaded.values);
        assert!(rename(&library, &reloaded.id, "   ").is_err());
        assert!(rename(&library, "missing", "x").is_err());
        delete(&library, &reloaded.id).unwrap();
        assert!(list(&library).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join("theme.css")).unwrap(),
            next.original
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failures_leave_library_and_theme_untouched() {
        let (root, current) = setup("failure");
        let path = root.join("presets.json");
        let mut e = edits(&current);
        assert!(capture(&path, &current, &e, " ", None).is_err());
        e.iter_mut()
            .find(|e| e.name == "--main-color")
            .unwrap()
            .value = "red; injected: yes".into();
        assert!(capture(&path, &current, &e, "Bad", None).is_err());
        assert!(!path.exists());
        let mut p = capture(&path, &current, &edits(&current), "Good", None)
            .unwrap()
            .remove(0);
        p.values.insert(
            "--home-logo".into(),
            "url('vencord:///themes/hotori-assets/0123456789abcdef.png')".into(),
        );
        assert!(apply(&root.join("theme.css"), &root, &current, &p).is_err());
        assert_eq!(
            fs::read_to_string(root.join("theme.css")).unwrap(),
            current.original
        );
        fs::write(&path, "broken").unwrap();
        assert!(capture(&path, &current, &edits(&current), "Keep", None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn older_presets_keep_new_settings_and_never_restore_old_css() {
        let (root, current) = setup("upgrade");
        let mut p = Preset {
            id: "old".into(),
            name: "Old".into(),
            values: BTreeMap::from([
                ("--main-color".into(), "#aabbcc".into()),
                ("--removed-setting".into(), "1".into()),
            ]),
            companion: None,
        };
        let next = apply(&root.join("theme.css"), &root, &current, &p).unwrap();
        assert!(next.original.contains("--collapse-member-list: 0;"));
        assert!(!next.original.contains("--removed-setting"));
        p.values.insert("--main-color".into(), "x; bad: 1".into());
        assert!(apply(&root.join("theme.css"), &root, &next, &p).is_err());
        assert_eq!(
            fs::read_to_string(root.join("theme.css")).unwrap(),
            next.original
        );
        fs::remove_dir_all(root).unwrap();
    }
}
