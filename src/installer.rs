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

#[cfg(test)]
mod tests {
    use super::*;
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
