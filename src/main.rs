#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod customization;
mod installer;
mod settings;
mod updates;
mod wallpapers;

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};

struct AppState {
    folder: Option<PathBuf>,
    settings: Mutex<Option<customization::Settings>>,
}

impl AppState {
    fn folder(&self) -> Result<&std::path::Path, String> {
        self.folder
            .as_deref()
            .ok_or_else(|| "Could not locate your Windows AppData folder.".into())
    }
}

#[derive(Serialize)]
struct InstallStatus {
    ready: bool,
    installed: bool,
}

#[tauri::command]
fn get_status(state: tauri::State<AppState>) -> InstallStatus {
    let folder = state.folder.as_ref();
    InstallStatus {
        ready: folder.is_some_and(|p| p.is_dir()),
        installed: folder.is_some_and(|p| p.join(installer::DESTINATION).is_file()),
    }
}

#[tauri::command]
async fn install_theme(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || installer::install(&folder))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn uninstall_theme(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || installer::uninstall(&folder))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_settings(state: tauri::State<AppState>) -> Result<Vec<settings::Field>, String> {
    let path = state.folder()?.join(installer::DESTINATION);
    let mut session = state.settings.lock().map_err(|e| e.to_string())?;
    let parsed = std::fs::read_to_string(path)
        .and_then(customization::parse)
        .map_err(|e| e.to_string())?;
    let defaults = updates::defaults(state.folder()?);
    let fields = settings::fields(&parsed, Some(&defaults));
    *session = Some(parsed);
    Ok(fields)
}

#[tauri::command]
fn save_settings(
    state: tauri::State<AppState>,
    edits: Vec<settings::Edit>,
) -> Result<Vec<settings::Field>, String> {
    let path = state.folder()?.join(installer::DESTINATION);
    let mut session = state.settings.lock().map_err(|e| e.to_string())?;
    let parsed = session
        .as_ref()
        .ok_or("Open Customize before saving settings.")?;
    let values = settings::values(parsed, &edits)?;
    let next = customization::save(&path, parsed, &values).map_err(|e| e.to_string())?;
    let defaults = updates::defaults(state.folder()?);
    let fields = settings::fields(&next, Some(&defaults));
    *session = Some(next);
    Ok(fields)
}

#[tauri::command]
fn reset_settings(state: tauri::State<AppState>) -> Result<Vec<settings::Field>, String> {
    let path = state.folder()?.join(installer::DESTINATION);
    let mut session = state.settings.lock().map_err(|e| e.to_string())?;
    let parsed = session
        .as_ref()
        .ok_or("Open Customize before resetting settings.")?;
    let defaults = updates::defaults(state.folder()?);
    let values = parsed
        .fields
        .iter()
        .map(|(name, _, _)| {
            defaults
                .fields
                .iter()
                .find(|(default_name, _, _)| default_name == name)
                .map(|(_, value, _)| value.clone())
                .ok_or_else(|| format!("No published default for {name}. Nothing was reset."))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let next = customization::save(&path, parsed, &values).map_err(|e| e.to_string())?;
    let fields = settings::fields(&next, Some(&defaults));
    *session = Some(next);
    Ok(fields)
}

#[tauri::command]
async fn update_theme(state: tauri::State<'_, AppState>) -> Result<updates::UpdateResult, String> {
    let folder = state.folder()?.to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || updates::update(&folder))
        .await
        .map_err(|e| e.to_string())??;
    *state.settings.lock().map_err(|e| e.to_string())? = None;
    Ok(result)
}

#[tauri::command]
fn open_theme_folder(state: tauri::State<AppState>) -> Result<bool, String> {
    let folder = state.folder()?;
    let exists = folder.is_dir();
    std::process::Command::new("explorer.exe")
        .arg(if exists {
            folder.as_os_str()
        } else {
            std::ffi::OsStr::new("https://vencord.dev/download/")
        })
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(exists)
}

#[tauri::command]
async fn import_wallpaper(
    state: tauri::State<'_, AppState>,
    data: String,
) -> Result<String, String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || wallpapers::import(&folder, &data))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn wallpaper_preview(
    state: tauri::State<'_, AppState>,
    uri: String,
) -> Result<String, String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || wallpapers::preview(&folder, &uri))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            folder: std::env::var_os("APPDATA")
                .map(|p| PathBuf::from(p).join("Vencord").join("themes")),
            settings: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            install_theme,
            uninstall_theme,
            load_settings,
            save_settings,
            reset_settings,
            update_theme,
            open_theme_folder,
            import_wallpaper,
            wallpaper_preview
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Hotori");
}
