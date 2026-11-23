# Hotori project instructions

Read this entire file before making changes. It is the shared project policy for all coding agents working in this checkout. `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` point here; maintain the policies here instead of duplicating them. Explicit user instructions take precedence. Do not weaken these policies or work around a failed check to claim completion.

## Inspect before editing

- Inspect `git status`, recent commits, and the relevant source before changing anything. Preserve unrelated working-tree changes and other agents' work. Do not reset, clean, or overwrite files to make the checkout look clean.
- Work in the requested checkout. Do not silently switch folders, branches, or worktrees. Avoid simultaneous edits to the same files by multiple agents.
- Read existing documentation and reuse supported mechanisms. Do not rerun historical theme generators or experiments against visually approved CSS.
- Do not infer source changes from a changed EXE alone: a local binary can have been built from temporary or subsequently reverted source. Compare source, build inputs, version, and executable metadata.

## Local testing and builds

Whenever implementing a new feature or changing app behavior or appearance, build the local executable before handing the result back to the user. Source changes alone are not ready for user testing.

- Use the normal release build: `cargo build --release --locked --offline`. If required dependencies are unavailable, report the actual blocker; do not silently disable default features or substitute a development build. `custom-protocol` must remain enabled for the standalone executable.
- Keep the testable build at `target/release/hotori.exe`. Verify the file exists and its Windows version matches the current app batch. Provide its clickable absolute path when handing back a build.
- Run checks appropriate to the change. Use existing native tests and isolated browser tests for affected behavior; UI-only tests do not prove that the native EXE starts. Do not report checks as passing unless they ran successfully.
- Verify the embedded runtime when building the EXE: `node scripts/verify-true-glass.mjs --exe target/release/hotori.exe`.
- If Hotori is running and prevents replacing the EXE, ask the user to save unsaved changes and close it. Do not terminate their app without permission. Do not change another portable copy unless requested.
- A local build does not imply permission to publish. Clearly report build or startup blockers and incomplete verification.

### Windows integrity-label startup regression

A local build in this checkout has previously inherited **Low Mandatory Level** on `hotori.exe`. WebView2 then failed to open normal app storage, although tests using a writable isolated profile passed. Restoring **Medium Mandatory Level on the local EXE only** fixed startup with the existing profile.

After building, inspect the actual file:

```powershell
icacls "target/release/hotori.exe"
```

If it has `Mandatory Label\Low Mandatory Level`, restore the normal desktop-app integrity level on that verified local build, then inspect it again:

```powershell
icacls "target/release/hotori.exe" /setintegritylevel M
icacls "target/release/hotori.exe"
```

- This changes file security metadata, not application code or the release signing key. Do not change integrity labels recursively on the repository or AppData.
- Capture the actual native startup error when diagnosing a failure. The observed error was `failed to create webview`, `HRESULT(0x800700AA)`, `The requested resource is in use.` That error can have other causes; do not assume it always means a running instance, corrupt profile, or a Low label.
- Check for other Hotori instances and compare normal-profile versus isolated-profile startup. An isolated startup test alone is insufficient to claim the user's normal-profile problem is fixed.
- With user authorization, verify that the normal-profile app creates a responsive native window. Do not inspect or control the user's screen without asking.
- Do not reset/delete the browser profile, remove music or preferences, broaden AppData permissions, disable security software, or require administrator mode as a shortcut. Back up user data before any necessary profile repair, and preserve the original backup until recovery is confirmed.
- A subsequent rebuild may inherit Low again. Recheck the EXE after rebuilding, not only once per chat.

## Versioning

Use one app version per unpublished batch of changes. Bump the version when starting the first app change after the previous batch was published, then keep that version for all further app changes until the user says to push. Only after that batch is published should the next set of changes advance to another version.

- Determine the current published and local versions from the repository and release history. Do not rely on a version number copied from an old chat.
- Keep `Cargo.toml`, the Hotori package entry in `Cargo.lock`, `tauri.conf.json`, the visible app version, and `assets/app-changelog.json` aligned in every local test build.
- Installer and theme versions are separate. Do not bump theme CSS for an installer-only control, documentation change, local rebuild, or Windows file-label repair.
- Use normal patch progression unless the user requests a different version. Do not roll a theme version into a new minor version just because the patch number reaches two digits.

## Publishing updates

Do not push or publish without explicit user authorization. For this project, when the user says **"push"**, **"push the update"**, or **"push it out"** for an app update, they mean both pushing the source changes to GitHub and publishing a new stable GitHub Release. This applies to future chats and agents working in this repository. A specifically scoped request such as "push the README" does not authorize an app release.

- Complete implementation, version alignment, appropriate checks, and the local release build before publishing.
- Review exactly what will be committed. Exclude personal media, settings, profiles, test backups, signing material, and other private/local artifacts. Do not indiscriminately stage ignored files or unrelated changes.
- Use the existing Windows-protected signing key with `scripts/sign-release.py`. Never replace the trusted public key, generate a replacement key to bypass an error, expose signing material, or commit credentials.
- Publish the matching `vX.Y.Z` stable release with `hotori.exe`, `hotori-update.json`, and `hotori-update.json.sig`.
- Verify the public release, manifest signature against the trusted public key, downloaded executable SHA-256 and size, and latest stable release discovery used by the in-app updater. Verify the uploaded binary, not just a local file or upload response.
- A source push alone does not complete an app update. Report any publishing blocker explicitly. Never claim a release is published or updater-visible before verification succeeds.
- Keep app releases separate from theme CSS releases unless the user requests both. An authorized theme release must include the matching `assets/hotori.theme.css` and `assets/theme-changelog.json` notes together, with the appropriate theme version.

### Existing signing environment on this machine

Before declaring the signing key missing, check the local-data folder used by the session that signed previous releases. The normal Windows local-data folder and the Codex package's redirected local-data folder can differ even under the same Windows account.

The existing protected key used for prior Hotori releases is at:

`%USERPROFILE%\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Hotori\signing\update-key.dpapi`

Check existence without printing its contents. Do not move/copy the key into the repository or another account, generate a substitute, or change the trusted public key.

After the authorized release's build and checks, run signing from the repository root using this process-local environment:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'target/signing-deps'
$env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local'
& (Join-Path $env:USERPROFILE 'AppData/Local/Python/pythoncore-3.14-64/python.exe') scripts/sign-release.py sign
```

The explicit interpreter avoids the Microsoft Store Python shim. An existing local `cryptography` installation is in `target/signing-deps`; test importing it with this interpreter/environment before installing anything. These are machine-specific fallback locations, not credentials or a requirement to change global environment variables. Restore any overridden environment values if continuing unrelated work in the same process. If access or DPAPI decryption actually fails, report that exact error; do not infer a missing key solely from the default `LOCALAPPDATA` location.

AGENTS.md and the agent entry-point/design-language documents are intentional project documentation, not private signing artifacts. They may be included in a normal authorized source update; never confuse them with the key, profiles, media, or ignored test backups.

## Preserve user data and working theme behavior

- Do not overwrite the user's installed `hotori.theme.css` or personal DEV settings during development. Test in disposable profiles. Applying a configuration to the real installation requires the user's action or explicit request.
- Preserve existing setting names, saved values, alpha channels, local image assets, and update/reset compatibility. Missing settings use the appropriate published defaults in normal update/reset flows.
- Publishable theme defaults remain `@name Hotori`, `--main-bg: none`, `--settings-bg: none`, `--home-logo: none`, and `--main-color: #5865f2`. Never copy personal DEV values into bundled defaults.
- Keep exactly one `END OF USER SETTINGS` marker and one user-setting declaration per line. Preserve the working CSS implementation outside the intended change.
- Cropped image exports preserve the selected source pixels without upscaling or lossy conversion; use lossless PNG. Smaller gallery/display thumbnails are separate and must never replace original saved images.
- Preserve message bubbles' single continuous backdrop per grouped message. Do not restore the rejected per-row blur implementation. ThemeAttributes enablement is manual; do not modify Vencord settings to enable it automatically.
- Launcher music, volume, mute, and brightness are separate from theme settings and resets. Never bundle or publish the user's selected song, wallpaper, preset library, browser profile, or other personal files. Music remains original local user data; the launcher supports one selected song.
- Presets capture theme settings, not historical implementation CSS. Preserve name-based compatibility, image references, alpha values, explicit Apply, and delete confirmation. See `docs/theme-presets.md`.

## True Liquid Glass runtime

- Follow `docs/true-liquid-glass-companion.md`, existing runtime-delivery documentation, and the pinned source/build verification scripts before changing this integration.
- Receiving/downloading a runtime payload is not installation. Do not replace live Vencord files while Discord is running. Preserve settings, themes, plugins, user preferences, verified backups, and rollback.
- Do not automatically enable Vencord plugins or edit Vencord `settings.json` for the companion preference. Use the existing atomic companion bridge and fresh revision-matched acknowledgements; only an active status confirms rendering.
- Preserve MIT and dependency notices. Do not distribute development dependencies, private snapshots, local status files, or personal configuration. Do not silently re-enable the upstream updater that would overwrite the custom runtime.

## Design language

Before changing app appearance or interactions, read [the Hotori design-language guide](docs/design-language/README.md). It defines the liquid-glass/acrylic hierarchy, typography, colors, geometry, docks, dialogs, dropdowns, galleries, warnings, motion, accessibility, and rendering budget. Match existing components before introducing a new visual treatment.

For reuse in a different app, copy the guide, portable tokens, and new-app prompt in `docs/design-language/`. They carry design guidance, not authorization to copy private assets, signing keys, installer behavior, or user data. Preserve the renderer and font licenses when reusing their implementation.

## User interaction and handoff

- Do not view, capture, or control the user's screen without asking. Prefer source inspection, logs, and isolated tests. Do not send messages to others without explicit authorization.
- Keep explanations plain and concise. State what changed, what was actually checked, and any remaining blocker. Do not claim a feature is ready when only source changes exist.
- Preserve these rules when handing work to another agent. If that tool does not automatically read `AGENTS.md`, explicitly instruct it to read this file before working.
