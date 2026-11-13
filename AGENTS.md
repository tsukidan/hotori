# Hotori project instructions

## Publishing updates

For this project, when the user says **"push the update"**, they mean both pushing the source changes to GitHub and publishing a new stable GitHub Release. This preference applies to future chats working in this repository.

- Bump the app version appropriately and keep Cargo.toml, Cargo.lock, tauri.conf.json, the visible app version, and assets/app-changelog.json aligned.
- Build and run the checks appropriate to the changes.
- Use the existing Windows-protected signing key with scripts/sign-release.py. Never replace the trusted public key or expose signing material.
- Publish the matching vX.Y.Z release with hotori.exe, hotori-update.json, and hotori-update.json.sig. Verify the public release, manifest signature, executable hash and size, and latest-release discovery used by the in-app updater.
- A source push alone does not complete an app update. Report any publishing blocker explicitly.
- Keep app releases separate from theme CSS changes unless the user requests both.
