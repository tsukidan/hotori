use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::{self, Write},
    path::{Path, PathBuf},
};
const PREFIX: &str = "vencord:///themes/hotori-assets/";
const MAX_BYTES: usize = 10 * 1024 * 1024;

pub fn installed_background(folder: &Path) -> Option<String> {
    let text = fs::read_to_string(folder.join(crate::installer::DESTINATION)).ok()?;
    let parsed = crate::customization::parse(text).ok()?;
    let (_, value, _) = parsed
        .fields
        .iter()
        .find(|(name, _, _)| name == "--main-bg")?;
    let uri = crate::customization::display_value("--main-bg", value);
    (!uri.is_empty()).then_some(uri)
}

// Convert the selected wallpaper to an origin-clean image for the app's GPU
// renderer. Remote hosts need not grant canvas access to the WebView origin.
pub fn app_preview(folder: &Path, uri: &str) -> io::Result<String> {
    if valid_uri(uri) {
        return preview(folder, uri);
    }
    let url = reqwest::Url::parse(uri).map_err(io::Error::other)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(io::Error::other(
            "Choose an HTTP/HTTPS image or a local Hotori wallpaper.",
        ));
    }
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(io::Error::other)?
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(io::Error::other)?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BYTES as u64)
    {
        return Err(io::Error::other("Wallpaper exceeds 10 MB."));
    }
    let mut bytes = Vec::new();
    use io::Read;
    response
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BYTES {
        return Err(io::Error::other("Wallpaper exceeds 10 MB."));
    }
    let (_, mime) = image_type(&bytes)?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn valid_uri(uri: &str) -> bool {
    uri.strip_prefix(PREFIX)
        .and_then(|name| name.split_once('.'))
        .is_some_and(|(hash, ext)| {
            hash.len() == 16
                && hash.bytes().all(|b| b.is_ascii_hexdigit())
                && ["png", "jpg", "gif", "webp"].contains(&ext)
        })
}
fn asset_path(folder: &Path, uri: &str) -> io::Result<PathBuf> {
    if !valid_uri(uri) {
        return Err(io::Error::other("Invalid Hotori wallpaper path."));
    }
    Ok(folder
        .join("hotori-assets")
        .join(uri.strip_prefix(PREFIX).unwrap()))
}
fn image_type(bytes: &[u8]) -> io::Result<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("png", "image/png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok(("gif", "image/gif"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok(("webp", "image/webp"))
    } else {
        Err(io::Error::other("Choose a PNG, JPEG, GIF, or WebP image."))
    }
}
pub fn import(folder: &Path, data: &str) -> io::Result<String> {
    if !folder.is_dir() {
        return Err(io::Error::other("Install Vencord first."));
    }
    if data.len() > MAX_BYTES * 4 / 3 + 100 {
        return Err(io::Error::other("Choose an image smaller than 10 MB."));
    }
    let (header, encoded) = data
        .split_once(',')
        .ok_or_else(|| io::Error::other("Invalid image."))?;
    if ![
        "data:image/png;base64",
        "data:image/jpeg;base64",
        "data:image/gif;base64",
        "data:image/webp;base64",
    ]
    .contains(&header)
    {
        return Err(io::Error::other("Choose a PNG, JPEG, GIF, or WebP image."));
    }
    let bytes = STANDARD.decode(encoded).map_err(io::Error::other)?;
    if bytes.len() > MAX_BYTES {
        return Err(io::Error::other("Choose an image smaller than 10 MB."));
    }
    let (ext, _) = image_type(&bytes)?;
    let mut hash = DefaultHasher::new();
    bytes.hash(&mut hash);
    let uri = format!("{PREFIX}{:016x}.{ext}", hash.finish());
    let path = asset_path(folder, &uri)?;
    fs::create_dir_all(folder.join("hotori-assets"))?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(mut file) => {
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            if fs::read(&path)? != bytes {
                return Err(io::Error::other(
                    "Wallpaper filename collision. Choose another image.",
                ));
            }
        }
        Err(e) => return Err(e),
    }
    Ok(uri)
}
pub fn preview(folder: &Path, uri: &str) -> io::Result<String> {
    let path = asset_path(folder, uri)?;
    if fs::metadata(&path)?.len() > MAX_BYTES as u64 {
        return Err(io::Error::other("Wallpaper exceeds 10 MB."));
    }
    let bytes = fs::read(path)?;
    let (_, mime) = image_type(&bytes)?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_image_is_copied_deduplicated_and_scoped() {
        let folder =
            std::env::temp_dir().join(format!("hotori-wallpaper-test-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(include_bytes!("../icons/icon.png"))
        );
        let uri = import(&folder, &data).unwrap();
        assert!(valid_uri(&uri));
        assert_eq!(import(&folder, &data).unwrap(), uri);
        assert_eq!(preview(&folder, &uri).unwrap(), data);
        assert_eq!(app_preview(&folder, &uri).unwrap(), data);
        assert_eq!(
            fs::read_dir(folder.join("hotori-assets")).unwrap().count(),
            1
        );
        assert!(preview(&folder, "vencord:///themes/hotori-assets/../../secret.png").is_err());
        assert!(import(&folder, "data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(!valid_uri("file:///C:/secret.png"));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn app_background_reads_saved_theme_without_an_editor_session() {
        let folder = std::env::temp_dir().join(format!("hotori-app-bg-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        assert_eq!(installed_background(&folder), None);
        let path = folder.join(crate::installer::DESTINATION);
        let theme = crate::installer::BUNDLED_THEME;
        fs::write(&path, theme).unwrap();
        assert_eq!(installed_background(&folder), None);
        fs::write(
            &path,
            theme.replace(
                "--main-bg: none;",
                "--main-bg: url('https://example.com/main.png');",
            ),
        )
        .unwrap();
        assert_eq!(
            installed_background(&folder).as_deref(),
            Some("https://example.com/main.png")
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(installed_background(&folder), None);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn remote_app_background_is_bounded_and_canvas_readable_without_cors() {
        use std::io::Read;
        fn serve(body: &'static [u8], declared: usize) -> String {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0u8; 4096];
                let _ = socket.read(&mut request);
                let _ = write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n"
                );
                let _ = socket.write_all(body);
            });
            format!("http://{address}/wallpaper.png")
        }
        let bytes = include_bytes!("../icons/icon.png");
        let uri = serve(bytes, bytes.len());
        assert_eq!(
            app_preview(Path::new("."), &uri).unwrap(),
            format!("data:image/png;base64,{}", STANDARD.encode(bytes))
        );
        assert!(app_preview(Path::new("."), &serve(b"", MAX_BYTES + 1)).is_err());
        assert!(app_preview(Path::new("."), &serve(b"not an image", 12)).is_err());
        assert!(app_preview(Path::new("."), "file:///C:/secret.png").is_err());
    }
}
