# Development

Hotori uses Rust and Tauri 2 with a local HTML/CSS/JavaScript interface. Build on Windows with Rust/MSVC and Microsoft C++ Build Tools. Running the app requires Microsoft Edge WebView2 Runtime.

## Build and test

```powershell
cargo build --release --locked
cargo test --release --locked
```

The executable is `target/release/hotori.exe`. Use `cargo run` for development. No frontend bundler is required.

The optional native UI tests use Playwright and a disposable AppData folder:

```powershell
npm install
npm run test:native
```

These tests exercise the release EXE without changing your installed Vencord themes. Screenshots and temporary profiles are stored in `target/qa`.

## Publishing theme updates

Update `assets/hotori.theme.css` in this repository. Keep the name `Hotori`, bump `@version`, retain exactly one `END OF USER SETTINGS` marker, and keep each user-setting declaration on its own line.

The app's Update theme button fetches this file from the repository's default branch. Existing values in the user-settings section are preserved when their variables still exist in the new theme. New variables use published defaults; removed variables disappear with the old implementation. Metadata and implementation come from the published file. Downloads are limited to 2 MB with a 30-second timeout; invalid downloads and detected concurrent edits abort the update.

The installed theme is `%APPDATA%/Vencord/themes/hotori.theme.css`. The published source is cached in `themes/hotori-assets/theme-defaults.css` for Reset to defaults and slider bounds. Bundled defaults are the offline fallback. Local wallpapers are copied into `themes/hotori-assets` and referenced through Vencord's local theme protocol.

Theme updates and EXE releases are independent. Attach `hotori.exe` to app releases; keep build outputs out of Git. Push only when explicitly requested.
