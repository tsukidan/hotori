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
        assert_eq!(
            fs::read_dir(folder.join("hotori-assets")).unwrap().count(),
            1
        );
        assert!(preview(&folder, "vencord:///themes/hotori-assets/../../secret.png").is_err());
        assert!(import(&folder, "data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(!valid_uri("file:///C:/secret.png"));
        fs::remove_dir_all(folder).unwrap();
    }
}
