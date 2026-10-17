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

## App versioning

Small fixes increment the patch version by 0.0.1 (for example, 1.0.0 → 1.0.1). Larger features use a minor bump; major changes may warrant a major bump. Keep Cargo.toml, the Hotori entry in Cargo.lock, tauri.conf.json, and the visible version label in web/index.html aligned. Theme versions are independent of app versions.

Build and verify the local EXE first. Wait for the user's verification and explicit publishing instruction before pushing or changing GitHub releases.

Current local app version: **1.3.2**. This patch checks GitHub's theme version on startup when a theme is installed and at most every five minutes while the app is visible. The installed-theme bubble shows a separated update action only when GitHub has a newer semantic version; the check never changes local theme files. Patch 1.3.1 refined persistent saving, slider ranges, colors, and wallpaper previews after the 1.3.0 settings redesign. Subsequent small fixes increment the patch version from this baseline.

## Signed portable app updates

Hotori 1.1.0 adds **Update Hotori**, separate from **Update theme**. It checks the latest stable GitHub release, offers Download & restart, verifies an Ed25519-signed manifest and the EXE's SHA-256/size, then stages the app beside the running EXE. A copy of the current app acts as the temporary helper. It waits for the original process to exit, keeps a backup while replacing the EXE, and restores the old version if the new app fails its startup acknowledgement. Paths containing spaces are supported. Theme files and wallpapers are not involved in app replacement. The EXE's folder must be writable.

Prepare an app release locally on the signing Windows account:

```powershell
cargo build --release --locked
python scripts/sign-release.py sign
```

The Python signing tool requires `cryptography`. Its default EXE is `target/release/hotori.exe`; it verifies the Windows product version against `tauri.conf.json` before signing. After user approval, attach these three files to the matching stable `vX.Y.Z` GitHub release:

- `hotori.exe`
- `hotori-update.json`
- `hotori-update.json.sig`

The app embeds only `assets/update-public-key.hex`. The private key is Windows-DPAPI protected at `%LOCALAPPDATA%/Hotori/signing/update-key.dpapi`, outside this repository. Keep this key and its Windows account available for future releases. Do not regenerate the public key for an existing app: old copies trust the original key. A lost signing key requires users to download a new trusted app manually. These update signatures verify app downloads; they are separate from Windows Authenticode signing.

The 1.0.0 release predates app updates. Users on that version must manually download their first updater-capable EXE; signed releases from 1.1.0 onward can be installed from inside the app. No update is downloaded automatically on startup. No push or GitHub release is performed by the signing script.

`node tests/app-update-smoke.cjs` performs a real replacement/restart using disposable EXE copies and the locally signed release artifacts. It builds an older-version helper harness under `target/qa`, checks paths with spaces, verifies the real new app starts, and confirms user theme/wallpaper files survive. `HOTORI_TEST_APP_UPDATE=1` additionally enables a live GitHub app-update check in the native smoke test.
