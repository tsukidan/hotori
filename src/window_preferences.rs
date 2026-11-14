use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Preferences {
    width: f64,
    height: f64,
    maximized: bool,
}

impl Preferences {
    fn valid(&self) -> bool {
        self.width.is_finite() && self.height.is_finite()
            && (560.0..=32768.0).contains(&self.width)
            && (560.0..=32768.0).contains(&self.height)
    }

    fn fit(&self, width: f64, height: f64) -> tauri::LogicalSize<f64> {
        tauri::LogicalSize::new(self.width.min(width.max(560.0)), self.height.min(height.max(560.0)))
    }
}

fn load(path: &Path) -> Option<Preferences> {
    let saved: Preferences = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    saved.valid().then_some(saved)
}

fn store(path: &Path, saved: &Preferences) -> std::io::Result<()> {
    if !saved.valid() { return Ok(()); }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec(saved)?)?;
    fs::rename(temporary, path)
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Match the installer's redirected APPDATA, including disposable native
    // test profiles, instead of writing preferences into another user profile.
    #[cfg(windows)]
    if let Some(folder) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(folder).join(app.config().identifier.as_str()).join("window.json"));
    }
    app.path().app_config_dir().ok().map(|folder| folder.join("window.json"))
}

pub fn restore(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return; };
    let Some(path) = config_path(app) else { return; };
    let Some(saved) = load(&path) else { return; };
    let size = window.current_monitor().ok().flatten().map(|monitor| {
        let size = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
        saved.fit(size.width, size.height)
    }).unwrap_or_else(|| saved.fit(1600.0, 900.0));
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER};
        // GetWindowPlacement stores outer bounds, whereas Tauri set_size uses
        // client bounds. Restore outer bounds to avoid adding the frame again.
        if let (Ok(hwnd), Ok(scale)) = (window.hwnd(), window.scale_factor()) {
            let physical = size.to_physical::<u32>(scale);
            unsafe { SetWindowPos(hwnd.0 as _, std::ptr::null_mut(), 0, 0, physical.width as i32, physical.height as i32, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE); }
        }
    }
    #[cfg(not(windows))]
    let _ = window.set_size(size);
    let _ = window.center();
    if saved.maximized { let _ = window.maximize(); }
}

pub fn save(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return; };
    let Some(path) = config_path(app) else { return; };
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED};
        let Ok(hwnd) = window.hwnd() else { return; };
        let mut placement: WINDOWPLACEMENT = unsafe { std::mem::zeroed() };
        placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
        if unsafe { GetWindowPlacement(hwnd.0 as _, &mut placement) } == 0 { return; }
        let Ok(scale) = window.scale_factor() else { return; };
        // Windows retains the normal rectangle even when maximized/minimized.
        // Store logical dimensions so display scaling does not enlarge the app.
        let rect = placement.rcNormalPosition;
        let saved = Preferences {
            width: (f64::from(rect.right) - f64::from(rect.left)) / scale,
            height: (f64::from(rect.bottom) - f64::from(rect.top)) / scale,
            maximized: placement.showCmd == SW_SHOWMAXIMIZED as u32
                || (placement.showCmd == SW_SHOWMINIMIZED as u32 && placement.flags & WPF_RESTORETOMAXIMIZED != 0),
        };
        let _ = store(&path, &saved);
    }
    #[cfg(not(windows))]
    {
        if window.is_minimized().unwrap_or(true) { return; }
        if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
            let size = size.to_logical::<f64>(scale);
            let _ = store(&path, &Preferences { width: size.width, height: size.height, maximized: window.is_maximized().unwrap_or(false) });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_dimensions_and_maximized_state_and_ignores_bad_files() {
        let folder = std::env::temp_dir().join(format!("hotori-window-{}", std::process::id()));
        let path = folder.join("window.json");
        assert!(load(&path).is_none());
        store(&path, &Preferences { width: 1234.0, height: 789.0, maximized: true }).unwrap();
        let saved = load(&path).unwrap();
        assert_eq!((saved.width, saved.height, saved.maximized), (1234.0, 789.0, true));
        let fitted = saved.fit(1000.0, 700.0);
        assert_eq!((fitted.width, fitted.height), (1000.0, 700.0));
        store(&path, &Preferences { width: 880.0, height: 660.0, maximized: false }).unwrap();
        assert_eq!(load(&path).unwrap().width, 880.0);
        fs::write(&path, b"not JSON").unwrap();
        assert!(load(&path).is_none());
        fs::write(&path, br#"{"width":0,"height":-50,"maximized":false}"#).unwrap();
        assert!(load(&path).is_none());
        fs::remove_dir_all(folder).unwrap();
    }
}
