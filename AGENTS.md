# Hotori project instructions

## Local testing

Whenever implementing a new feature or changing app behavior or appearance, build the local executable before handing the result back to the user. Source changes alone are not ready for user testing. Keep the testable build at target/release/hotori.exe, verify that it exists after building, and provide its clickable absolute path. Clearly report any build blocker. A local build does not imply permission to publish; follow the publishing instructions below when requested.

## Publishing updates

Use one app version per unpublished batch of changes. Bump the version when starting the first change after the previous batch was published, then keep that version for all further changes until the user says to push. Only after that batch is published should the next set of changes advance to another version. Keep the version synchronized in every local test build.

For this project, when the user says **"push the update"**, they mean both pushing the source changes to GitHub and publishing a new stable GitHub Release. This preference applies to future chats working in this repository.

- Bump the app version appropriately and keep Cargo.toml, Cargo.lock, tauri.conf.json, the visible app version, and assets/app-changelog.json aligned.
- Build and run the checks appropriate to the changes.
- Use the existing Windows-protected signing key with scripts/sign-release.py. Never replace the trusted public key or expose signing material.
- Publish the matching vX.Y.Z release with hotori.exe, hotori-update.json, and hotori-update.json.sig. Verify the public release, manifest signature, executable hash and size, and latest-release discovery used by the in-app updater.
- A source push alone does not complete an app update. Report any publishing blocker explicitly.
- Keep app releases separate from theme CSS changes unless the user requests both.
