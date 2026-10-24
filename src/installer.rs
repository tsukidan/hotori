use std::{fs, io, path::Path};
pub const BUNDLED_THEME: &str = include_str!("../assets/hotori.theme.css");
pub const DESTINATION: &str = "hotori.theme.css";

pub fn uninstall(folder: &Path) -> io::Result<()> {
    fs::remove_file(folder.join(DESTINATION))
}

pub fn install(folder: &Path) -> io::Result<()> {
    use io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join(DESTINATION))?;
    file.write_all(BUNDLED_THEME.as_bytes())?;
    file.sync_all()
}

fn is_discord_process(name: &str) -> bool {
    [
        "discord.exe",
        "discordptb.exe",
        "discordcanary.exe",
        "discorddevelopment.exe",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

// Vencord loads settings into memory at startup and does not watch external
// settings-file edits. Never race a running Discord's settings writer.
pub fn ensure_discord_closed() -> io::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
            System::Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                TH32CS_SNAPPROCESS,
            },
        };
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut present = Process32FirstW(snapshot, &mut entry);
            let mut running = false;
            while present != 0 {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|value| *value == 0)
                    .unwrap_or(entry.szExeFile.len());
                if is_discord_process(&String::from_utf16_lossy(&entry.szExeFile[..length])) {
                    running = true;
                    break;
                }
                present = Process32NextW(snapshot, &mut entry);
            }
            let error = io::Error::last_os_error();
            CloseHandle(snapshot);
            if running {
                return Err(io::Error::other(
                    "Fully quit Discord first, including its system-tray icon, then click Install again. Hotori will be enabled automatically when you reopen Discord.",
                ));
            }
            if error.raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
                return Err(error);
            }
        }
    }
    Ok(())
}

fn enabled_settings(original: Option<&str>) -> io::Result<String> {
    let mut settings: serde_json::Value = match original {
        Some(text) => serde_json::from_str(text).map_err(|_| {
            io::Error::other("Vencord settings could not be read. They have not been changed.")
        })?,
        None => serde_json::json!({}),
    };
    let object = settings.as_object_mut().ok_or_else(|| {
        io::Error::other("Vencord settings must be a JSON object. They have not been changed.")
    })?;
    let enabled = object
        .entry("enabledThemes")
        .or_insert_with(|| serde_json::json!([]));
    let themes = enabled
        .as_array_mut()
        .filter(|themes| themes.iter().all(|theme| theme.is_string()))
        .ok_or_else(|| {
            io::Error::other("Vencord's enabled themes list is invalid. It has not been changed.")
        })?;
    if !themes
        .iter()
        .any(|theme| theme.as_str() == Some(DESTINATION))
    {
        themes.push(serde_json::Value::String(DESTINATION.into()));
    } else if let Some(original) = original {
        return Ok(original.to_owned());
    }
    serde_json::to_string_pretty(&settings)
        .map(|value| value + "\n")
        .map_err(io::Error::other)
}

pub fn install_and_enable(folder: &Path) -> io::Result<()> {
    use io::Write;
    let settings_dir = folder
        .parent()
        .ok_or_else(|| io::Error::other("Invalid Vencord themes folder."))?
        .join("settings");
    let path = settings_dir.join("settings.json");
    let original = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let updated = enabled_settings(original.as_deref())?;
    install(folder)?;
    let result = (|| {
        if original.as_deref() == Some(updated.as_str()) {
            return Ok(());
        }
        fs::create_dir_all(&settings_dir)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let temporary = settings_dir.join(format!(
            "hotori-settings-{}-{stamp}.tmp",
            std::process::id()
        ));
        let save = (|| {
            let mut staged = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            staged.write_all(updated.as_bytes())?;
            staged.sync_all()?;
            drop(staged);
            let actual = match fs::read_to_string(&path) {
                Ok(text) => Some(text),
                Err(error) if error.kind() == io::ErrorKind::NotFound => None,
                Err(error) => return Err(error),
            };
            if actual != original {
                return Err(io::Error::other(
                    "Vencord settings changed during installation. Close Discord and try again.",
                ));
            }
            if let Some(text) = &original {
                let mut backup = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(settings_dir.join(format!("settings.json.hotori-backup-{stamp}")))?;
                backup.write_all(text.as_bytes())?;
                backup.sync_all()?;
            }
            #[cfg(windows)]
            {
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
                } == 0
                {
                    return Err(io::Error::last_os_error());
                }
            }
            #[cfg(not(windows))]
            fs::rename(&temporary, &path)?;
            Ok(())
        })();
        if save.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        save
    })();
    if result.is_err() {
        fs::remove_file(folder.join(DESTINATION))?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn activation_folder(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("hotori-enable-{name}-{}", std::process::id()));
        fs::create_dir_all(root.join("themes")).unwrap();
        root
    }
    #[test]
    fn enables_hotori_preserving_other_settings_and_original_backup() {
        let root = activation_folder("preserve");
        fs::create_dir_all(root.join("settings")).unwrap();
        let path = root.join("settings/settings.json");
        let original = r#"{"enabledThemes":["other.theme.css"],"plugins":{"Example":{"enabled":true}},"themeLinks":["https://example.com/theme.css"],"unknown":{"future":42}}"#;
        fs::write(&path, original).unwrap();
        install_and_enable(&root.join("themes")).unwrap();
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let mut expected: serde_json::Value = serde_json::from_str(original).unwrap();
        expected["enabledThemes"] = serde_json::json!(["other.theme.css", DESTINATION]);
        assert_eq!(updated, expected);
        let backup = fs::read_dir(root.join("settings"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("settings.json.hotori-backup-")
            })
            .unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), original);
        uninstall(&root.join("themes")).unwrap();
        let before = fs::read(&path).unwrap();
        install_and_enable(&root.join("themes")).unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            before,
            "Reinstall must not duplicate or rewrite an already enabled theme"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn enables_with_missing_settings_and_rejects_invalid_settings_unchanged() {
        let root = activation_folder("validation");
        install_and_enable(&root.join("themes")).unwrap();
        let path = root.join("settings/settings.json");
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["enabledThemes"], serde_json::json!([DESTINATION]));
        uninstall(&root.join("themes")).unwrap();
        for invalid in [
            "not JSON",
            "[]",
            r#"{"enabledThemes":null}"#,
            r#"{"enabledThemes":[5]}"#,
        ] {
            fs::write(&path, invalid).unwrap();
            assert!(install_and_enable(&root.join("themes")).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), invalid);
            assert!(!root.join("themes").join(DESTINATION).exists());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn activation_failure_keeps_existing_theme_untouched() {
        let root = activation_folder("existing");
        fs::write(root.join("themes").join(DESTINATION), "custom theme").unwrap();
        assert_eq!(
            install_and_enable(&root.join("themes")).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(
            fs::read_to_string(root.join("themes").join(DESTINATION)).unwrap(),
            "custom theme"
        );
        assert!(!root.join("settings/settings.json").exists());
        for name in [
            "Discord.exe",
            "DiscordPTB.exe",
            "discordcanary.exe",
            "DiscordDevelopment.exe",
        ] {
            assert!(is_discord_process(name));
        }
        for name in ["hotori.exe", "DiscordHelper.exe", "not-discord.exe"] {
            assert!(!is_discord_process(name));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn failed_settings_replace_rolls_back_new_theme() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = activation_folder("rollback");
        fs::create_dir_all(root.join("settings")).unwrap();
        let path = root.join("settings/settings.json");
        let original = r#"{"enabledThemes":["other.theme.css"],"keep":true}"#;
        fs::write(&path, original).unwrap();
        // Allow reads, but deny replacement of the destination file.
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        assert!(install_and_enable(&root.join("themes")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(!root.join("themes").join(DESTINATION).exists());
        assert!(!fs::read_dir(root.join("settings")).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "tmp")
        }));
        drop(lock);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn installs_bundle_without_dev_source_and_preserves_other_themes() {
        let folder =
            std::env::temp_dir().join(format!("hotori-bundle-test-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        install(&folder).unwrap();
        assert_eq!(
            fs::read_to_string(folder.join(DESTINATION)).unwrap(),
            BUNDLED_THEME
        );
        fs::write(folder.join("devhotori.theme.css"), b"development").unwrap();
        fs::write(
            folder.join("testhotori.theme.css"),
            b"legacy customized theme",
        )
        .unwrap();
        fs::write(folder.join(DESTINATION), b"customized").unwrap();
        assert_eq!(
            install(&folder).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(folder.join(DESTINATION)).unwrap(), b"customized");
        uninstall(&folder).unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
        assert_eq!(
            fs::read(folder.join("devhotori.theme.css")).unwrap(),
            b"development"
        );
        assert_eq!(
            fs::read(folder.join("testhotori.theme.css")).unwrap(),
            b"legacy customized theme"
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn bundled_defaults_can_be_saved_with_empty_wallpapers() {
        assert!(
            BUNDLED_THEME.contains("@name Hotori\n") || BUNDLED_THEME.contains("@name Hotori\r\n")
        );
        let parsed = crate::customization::parse(BUNDLED_THEME.to_owned()).unwrap();
        for name in ["--main-bg", "--settings-bg"] {
            let value = &parsed.fields.iter().find(|f| f.0 == name).unwrap().1;
            assert_eq!(value, "none");
            assert_eq!(crate::customization::display_value(name, value), "");
        }
        assert_eq!(
            parsed
                .fields
                .iter()
                .find(|f| f.0 == "--main-color")
                .unwrap()
                .1,
            "#5865f2"
        );
        let folder =
            std::env::temp_dir().join(format!("hotori-bundle-save-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        install(&folder).unwrap();
        let values = parsed
            .fields
            .iter()
            .map(|f| f.1.clone())
            .collect::<Vec<_>>();
        crate::customization::save(&folder.join(DESTINATION), &parsed, &values).unwrap();
        assert_eq!(
            fs::read_to_string(folder.join(DESTINATION)).unwrap(),
            BUNDLED_THEME
        );
        fs::remove_dir_all(folder).unwrap();
    }
}
