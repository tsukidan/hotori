#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app_updates;
mod customization;
mod installer;
mod settings;
mod presets;
mod updates;
mod wallpapers;
mod theme_changelog;
mod window_preferences;
mod true_liquid_glass;
mod runtime_delivery;

#[tauri::command]
async fn get_true_glass_runtime() -> Result<runtime_delivery::Delivery, String> {
    let loc = runtime_delivery::Locations::current()?;
    tauri::async_runtime::spawn_blocking(move || runtime_delivery::status(&loc)).await.map_err(|e|e.to_string())
}

#[tauri::command]
async fn apply_true_glass_runtime() -> Result<runtime_delivery::Delivery, String> {
    let loc = runtime_delivery::Locations::current()?;
    tauri::async_runtime::spawn_blocking(move || runtime_delivery::apply(&loc)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn rollback_true_glass_runtime() -> Result<runtime_delivery::Delivery, String> {
    let loc = runtime_delivery::Locations::current()?;
    tauri::async_runtime::spawn_blocking(move || runtime_delivery::rollback(&loc)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn open_true_glass_sources() -> Result<(), String> {
    let folder = runtime_delivery::sources(&runtime_delivery::Locations::current()?)?;
    #[cfg(windows)]
    std::process::Command::new("explorer.exe").arg(folder).spawn().map_err(|e|e.to_string())?;
    Ok(())
}

use serde::Serialize;
use tauri::Manager;
use std::{path::PathBuf, sync::Mutex};

#[tauri::command]
async fn get_true_liquid_glass() -> Result<true_liquid_glass::Snapshot, String> {
    let root = true_liquid_glass::root()?;
    tauri::async_runtime::spawn_blocking(move || true_liquid_glass::read(&root)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_true_liquid_glass(requested_enabled: bool, quality: true_liquid_glass::Quality) -> Result<true_liquid_glass::Snapshot, String> {
    let root = true_liquid_glass::root()?;
    tauri::async_runtime::spawn_blocking(move || true_liquid_glass::save(&root, requested_enabled, quality)).await.map_err(|e| e.to_string())?
}

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
    theme_version: Option<String>,
    main_background: Option<String>,
}

#[tauri::command]
fn get_status(state: tauri::State<AppState>) -> InstallStatus {
    let folder = state.folder.as_ref();
    InstallStatus {
        ready: folder.is_some_and(|p| p.is_dir()),
        installed: folder.is_some_and(|p| p.join(installer::DESTINATION).is_file()),
        theme_version: folder.and_then(|p| updates::installed_version(p)),
        main_background: folder.and_then(|p| wallpapers::installed_background(p)),
    }
}

#[tauri::command]
async fn install_theme(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        installer::ensure_discord_closed()?;
        installer::install_and_enable(&folder)
    })
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
fn list_presets() -> Result<Vec<presets::Preset>, String> { presets::list(&presets::path()?) }

#[tauri::command]
fn save_preset(state: tauri::State<AppState>, name: String, edits: Vec<settings::Edit>, companion: Option<presets::Companion>) -> Result<Vec<presets::Preset>, String> {
    let session=state.settings.lock().map_err(|e|e.to_string())?;
    presets::capture(&presets::path()?,session.as_ref().ok_or("Open Customize before saving a preset.")?,&edits,&name,companion)
}

#[tauri::command]
fn rename_preset(id: String, name: String) -> Result<Vec<presets::Preset>, String> { presets::rename(&presets::path()?,&id,&name) }

#[tauri::command]
fn delete_preset(id: String) -> Result<Vec<presets::Preset>, String> { presets::delete(&presets::path()?,&id) }

#[tauri::command]
fn apply_preset(state: tauri::State<AppState>, id: String) -> Result<Vec<settings::Field>, String> {
    let preset=presets::find(&presets::path()?,&id)?;
    let folder=state.folder()?;
    let mut session=state.settings.lock().map_err(|e|e.to_string())?;
    let current=session.as_ref().ok_or("Open Customize before applying a preset.")?;
    let next=presets::apply(&folder.join(installer::DESTINATION),folder,current,&preset)?;
    let fields=settings::fields(&next,Some(&updates::defaults(folder)));
    *session=Some(next); Ok(fields)
}

#[tauri::command]
fn reset_settings(state: tauri::State<AppState>) -> Result<Vec<settings::Field>, String> {
    let path = state.folder()?.join(installer::DESTINATION);
    let mut session = state.settings.lock().map_err(|e| e.to_string())?;
    let parsed = session
        .as_ref()
        .ok_or("Open Customize before resetting settings.")?;
    let defaults = updates::defaults(state.folder()?);
    let values = settings::reset_values(parsed, &defaults)?;
    let next = customization::save(&path, parsed, &values).map_err(|e| e.to_string())?;
    let fields = settings::fields(&next, Some(&defaults));
    *session = Some(next);
    Ok(fields)
}

#[tauri::command]
async fn check_theme_update(
    state: tauri::State<'_, AppState>,
) -> Result<updates::ThemeCheck, String> {
    let folder = state.folder()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || updates::check(&folder))
        .await
        .map_err(|e| e.to_string())?
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
async fn check_app_update(
    state: tauri::State<'_, app_updates::State>,
) -> Result<app_updates::Check, String> {
    let session = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut pending = session.lock().map_err(|e| e.to_string())?;
        *pending = None;
        let (result, candidate) = app_updates::check()?;
        *pending = candidate;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, app_updates::State>,
) -> Result<(), String> {
    use tauri::Emitter;
    let session = state.0.clone();
    let events = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut pending = session.lock().map_err(|e| e.to_string())?;
        let candidate = pending.as_ref().ok_or("Check for an app update first.")?;
        let stage = app_updates::prepare(candidate, |progress| {
            let _ = events.emit("app-update-progress", progress);
        })?;
        app_updates::launch_helper(&stage)?;
        *pending = None;
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    window_preferences::save(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_vencord_download() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("https://vencord.dev/download/")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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

#[tauri::command]
async fn app_wallpaper(app: tauri::AppHandle, state: tauri::State<'_, AppState>, uri: String) -> Result<String, String> {
    let folder = state.folder()?.to_owned();
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("wallpapers");
    tauri::async_runtime::spawn_blocking(move || wallpapers::cached_app_preview(&folder, &uri, &cache))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Main window unavailable.")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_app_zoom(window: tauri::WebviewWindow, percent: u16) -> Result<(), String> {
    if window.label() != "main" || !(50..=200).contains(&percent) || percent % 10 != 0 {
        return Err("Choose a zoom level from 50% to 200% in 10% steps.".into());
    }
    window.set_zoom(f64::from(percent) / 100.0).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_changelog() -> Result<serde_json::Value, String> {
    let mut catalog: serde_json::Value = serde_json::from_str(include_str!("../assets/app-changelog.json"))
        .map_err(|error| error.to_string())?;
    catalog["currentVersion"] = serde_json::json!(env!("CARGO_PKG_VERSION"));
    Ok(catalog)
}

#[tauri::command]
async fn get_theme_changelog(app: tauri::AppHandle, refresh: bool) -> Result<theme_changelog::Catalog, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || theme_changelog::load(&cache, refresh)).await.map_err(|e| e.to_string())
}

fn main() {
    if app_updates::helper_entry() {
        return;
    }
    tauri::Builder::default()
        .manage(app_updates::State::default())
        .setup(|app| {
            window_preferences::restore(app.handle());
            app_updates::complete_startup().map_err(std::io::Error::other)?;
            // App updates deliver this embedded payload automatically. Never apply
            // it to Vencord here: a running Discord must remain untouched.
            std::thread::spawn(|| {
                if let Ok(loc) = runtime_delivery::Locations::current() {
                    let _ = runtime_delivery::status(&loc);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window_preferences::save(window.app_handle());
            }
        })
        .manage(AppState {
            folder: std::env::var_os("APPDATA")
                .map(|p| PathBuf::from(p).join("Vencord").join("themes")),
            settings: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_true_glass_runtime,
            apply_true_glass_runtime,
            rollback_true_glass_runtime,
            open_true_glass_sources,
            get_true_liquid_glass,
            save_true_liquid_glass,
            get_status,
            install_theme,
            uninstall_theme,
            load_settings,
            list_presets,
            save_preset,
            rename_preset,
            delete_preset,
            apply_preset,
            save_settings,
            reset_settings,
            update_theme,
            check_theme_update,
            check_app_update,
            install_app_update,
            open_theme_folder,
            open_vencord_download,
            import_wallpaper,
            wallpaper_preview,
            app_wallpaper,
            show_main_window,
            set_app_zoom,
            get_theme_changelog,
            get_app_changelog
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Hotori");
}

#[cfg(test)]
mod app_changelog_tests {
    #[test]
    fn app_catalog_covers_running_version_and_has_unique_history() {
        let catalog = super::get_app_changelog().unwrap();
        assert_eq!(catalog["schemaVersion"], 1);
        let current = catalog["currentVersion"].as_str().unwrap();
        let releases = catalog["releases"].as_array().unwrap();
        let mut versions = std::collections::HashSet::new();
        for release in releases {
            let version = release["version"].as_str().unwrap();
            assert!(semver::Version::parse(version).is_ok());
            assert!(versions.insert(version));
            assert!(!release["body"].as_str().unwrap().trim().is_empty());
        }
        assert!(versions.contains(current));
        assert!(versions.contains("1.0.0"));
    }
}
