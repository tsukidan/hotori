# Development

Hotori uses Rust and Tauri 2 with a local HTML/CSS/JavaScript interface. Build on Windows with Rust/MSVC and Microsoft C++ Build Tools. Running the app requires Microsoft Edge WebView2 Runtime.

## Build and test

```powershell
cargo build --release --locked
cargo test --release --locked
```

Keep updating the main executable at `target/release/hotori.exe`; do not generate separate versioned preview EXEs unless the user asks for them. Use `cargo run` for development. No frontend bundler is required.

The optional native UI tests use Playwright and a disposable AppData folder:

```powershell
npm install
npm run test:native
```

These tests exercise the release EXE without changing your installed Vencord themes. Screenshots and temporary profiles are stored in `target/qa`.

## Publishing theme updates

Update `assets/hotori.theme.css` in this repository. Keep the name `Hotori`, bump `@version`, retain exactly one `END OF USER SETTINGS` marker, and keep each user-setting declaration on its own line.

The app's theme update notice fetches this file from the repository's default branch when clicked. Existing values in the user-settings section are preserved when their variables still exist in the new theme. New variables use published defaults; removed variables disappear with the old implementation. Metadata and implementation come from the published file. Downloads are limited to 2 MB with a 30-second timeout; invalid downloads and detected concurrent edits abort the update.

The installed theme is `%APPDATA%/Vencord/themes/hotori.theme.css`. The published source is cached in `themes/hotori-assets/theme-defaults.css` for Reset to defaults and slider bounds. Bundled defaults are the offline fallback. Local wallpapers are copied into `themes/hotori-assets` and referenced through Vencord's local theme protocol.

Theme updates and EXE releases are independent. Attach `hotori.exe` to app releases; keep build outputs out of Git. Push only when explicitly requested.

## App versioning

Small fixes increment the patch version by 0.0.1 (for example, 1.0.0 → 1.0.1). Larger features use a minor bump; major changes may warrant a major bump. Keep Cargo.toml, the Hotori entry in Cargo.lock, tauri.conf.json, and the visible version label in web/index.html aligned. Theme versions are independent of app versions.

Version components are independent integers, not decimal digits. Patch versions continue from **1.6.9 → 1.6.10 → 1.6.11**; reaching 9 does not trigger a minor-version bump. Minor and major bumps depend on the scope of the change.

Build and verify the local EXE first. Wait for the user's verification and explicit publishing instruction before pushing or changing GitHub releases.

Current local app version: **1.6.21**. The Windows application icon has a rounded-square silhouette with transparent corners, with PNG and multi-size ICO kept in sync. The dock includes Installation Guide and Download Vencord below customization. Each numbered guide step has a rounded 36px acrylic bubble using the same literal 24 CSS-pixel blur and neutral tint as settings controls, with refraction disabled for the bubbles in both GPU and CSS fallback paths. The guide opens in an animated liquid glass modal with a scrollable, scrollbar-free step list and persistent actions, covering Windows Discord/Vencord setup, installing and enabling Hotori, per-category customization saves, and updates. Both download actions open the fixed official https://vencord.dev/download/ URL through a dedicated native command, regardless of whether Vencord is already installed. Settings category buttons gently magnify under the pointer (including during scrolling) and keyboard focus, without changing layout; reduced motion disables magnification. Selected/focused categories have a steady, softly transitioned wallpaper-accent halo. Their acrylic material and the outer liquid glass panes are preserved. The installer uses the actual pinned LiquidGlass 1.0.3 renderer, optical shaders, defaults, six-pair blur pipeline, and DOM capture dependency from the reference site. The bundle is local under `web/vendor/liquidglass`; source and integration patches are recorded in its NOTICE.md. `web/glass-shader.js` adapts the renderer to the existing nested UI with one GPU context, cached foreground captures, CSS paint ordering, scroller clipping, device-pixel scaling, and native-control material images. Each lens receives its own composed backdrop, including preceding text, icons, canvas-readable images and glass. Remote previews that do not grant canvas access stay visible but are isolated from shader sampling so they cannot disable the renderer. Home/dialog glass uses the site's hero preset; status surfaces use its frosted preset; the dock uses its floating frosted preset. The two outer settings panes (Glass Appearance on the right and Hotori navigation on the left) retain liquid glass and its compositor refraction fallback. Only their inner controls, submenus, navigation options and select popups use rounded acrylic (36px rows, 40px groups, 30px select popups). Acrylic is painted from the composed scene with a literal Canvas 2D blur of 24 CSS pixels (24 times devicePixelRatio physical pixels), a rounded mask and neutral tint; it does not run through the lens shader. A three-sigma scene margin avoids cropped blur edges. The CSS fallback also uses blur(24px) and skips lens maps only for these inner surfaces. Tests verify the outer glass scope and fixed blur at DPR 1 and 2. Hover brightness stays muted at one quarter of the site's button boost, without a custom moving light. Customizable native select popups use the same renderer for their material. App glass remains enabled regardless of the Windows transparency setting (prefers-reduced-transparency). Both the WebGL renderer and compositor fallback ignore that OS preference; reduced-motion behavior is unchanged. Unavailable WebGL falls back to compositor refraction. UI geometry and theme settings are preserved. CSP permits self-origin fetches for local capture assets; no runtime CDN dependency is introduced. Sliders use a continuous rounded track and pale warm fill, with an invisible native thumb and a visible keyboard focus ring; bounds and saved values are unchanged. App typography uses bundled Inter 4.1 variable fonts (regular and true italic, SIL OFL 1.1) with automatic optical sizing, medium-weight controls, semibold headings, and size-specific tracking. This approximates Apple UI typography on Windows; it does not bundle or claim to reproduce SF Pro exactly. Customization scrollbars are hidden while wheel, touch, and keyboard scrolling remain available. The uninstall prompt hides its scrollbars and opens with a 260 ms fade, slight rise and scale, plus a 220 ms backdrop fade; reduced motion disables both animations. Theme uninstall requires confirmation in a liquid glass modal, with Cancel focused by default and Escape to dismiss. The app background follows the saved main theme background on startup, save, reset, theme update, and status refresh; an empty, unreadable or uninstalled theme uses the bundled Hotori background. Local assets use the scoped wallpaper preview; HTTP/HTTPS images are fetched with a 10 MB cap, 15-second timeout and limited redirects, then decoded into origin-clean blobs so glass refraction remains active without host CORS. The CSS variable holds a short object URL rather than the entire image; this avoids Chromium rejecting large wallpaper values after a save. Replaced, cleared, failed and superseded blob URLs are revoked. Failed images fall back and retry at most every five minutes. Draft backgrounds apply only after saving. The home logo is accessible Hotori text with a custom glyph-shaped glass shader in web/glass-wordmark.js. It shares the existing WebGL context, composed backdrop and original blur pipeline, with cached 16-bit glyph distance fields, smoothed surface normals and glyph-shaped shadows. Its biconvex refraction, chromatic separation, Fresnel, multi-light Blinn-Phong, depth brightness and inner-rim lighting are adapted from the pinned reference shader to letter geometry; rays are bounded to the padded crop. It is a visual approximation of the supplied Apple clock reference, not Apple renderer code. The diffuse white coat has been removed. The wordmark uses the reference frosted blur amount of 0.25, edge-weighted sharp/blur sampling, and narrow specular highlights so scene detail remains visible. Tests separately verify fine-detail softening, retention of larger backdrop features, and geometric refraction with only the refraction uniform disabled. Nunito is bundled under SIL OFL 1.1 and used at Black weight (900) only for the glass wordmark and its plain-text fallback; all other UI text retains Inter. The visible title-bar Hotori label is removed while its drag region and window controls remain available. The pinned panel renderer is unchanged. The wordmark keeps the existing heading footprint and quote alignment; readable text is shown when WebGL is unavailable. Fixed pink UI styling has been replaced by neutral text/surfaces and wallpaper-derived accents. web/wallpaper-accent.js samples a small origin-clean image using a weighted hue histogram, normalizes the accent for dark controls, and falls back to a neutral color for grayscale or unreadable images. Initial/default, saved custom and cleared wallpapers all update the accent; stale image loads cannot overwrite a newer palette. Accents affect focus, selection, primary borders, icons and slider fills. The bundled Discord theme is unchanged.

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
