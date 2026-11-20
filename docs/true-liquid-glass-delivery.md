# True Liquid Glass delivery and maintenance

## What users receive

Hotori 1.8.8 embeds a pinned standalone Vencord desktop build with the vendored
Hotori plugin. No second unverified runtime download is made. The existing signed
`hotori-update.json` and signature bind the complete EXE hash and size, including
the runtime, manifest, source and licenses. The trusted key is unchanged. Release
signing now also verifies the current payload is actually embedded in the EXE.

App startup stages and verifies the payload under
`%APPDATA%\Hotori\TrueLiquidGlass\runtime\payloads\<bundle-id>`. This is delivery,
**not installation**. Startup and the app-update completion helper never replace
Vencord or Discord files. The app remains usable if staging fails.

Open **True Liquid Glass setup & updates** from Home or the Glass Appearance
control. Fully quit Discord (including the tray icon) and Vesktop, then choose
**Apply runtime**. Do not launch Discord during the transaction. After applying,
restart Discord and manually enable **HotoriTrueLiquidGlass** in Vencord → Plugins.
The effect preference stays unchanged; first-time requests default to Off/Balanced.
No plugin-enable settings are written by deployment.

## Compatibility and preservation

- Windows per-user Discord Stable, PTB, Canary and Development installations are
  discovered under Local AppData. Only the newest installed version per channel
  is targeted. System-wide clients, Vesktop deployment and other layouts are not
  silently patched; the UI reports a blocked setup.
- A stock Discord bootstrap with `main: bundle.js`, or a recognized Vencord
  bootstrap pointing to the user's roaming Vencord dist, is required.
- First-time setup can create the Vencord runtime and standard Discord ASAR
  bootstrap without requiring Node, Git or pnpm on recipients' computers.
- Existing dist is accepted only when its entire file set matches a verified
  baseline, the exact locally tested pre-integration build, the current bundle,
  or a previous installer-owned receipt. Known stock baselines are exact, not a
  claim that every official Vencord version is interchangeable.
- Any unknown extra/modified files or custom compiled plugins block replacement.
  Users of those builds must merge the included plugin source into their existing
  checkout and rebuild. Never offer a force-overwrite option as a substitute for
  preserving their plugins.
- Settings, themes, user plugins outside dist, and the companion request/status
  files are not copied, rewritten, backed up into distribution, or reset. The
  full standard Vencord plugin catalog is retained in the custom runtime.

## Transaction and rollback

The runtime is prepared in a separate directory and every file is hash-verified.
A process lock and running-client checks guard application. A durable transaction
record precedes mutations. Existing dist is renamed into a transaction backup;
the prepared dist replaces it. First-time bootstrap application retains Discord's
original archive as `_app.asar`. Existing recognized bootstraps are left intact.
Installed hashes, bootstrap targets and original archive hashes are verified.

Backups and receipts stay in the user's roaming Hotori runtime transaction folder.
**Roll back runtime** restores only the runtime and bootstrap, never old settings
or themes. Rollback verifies backups and refuses to overwrite subsequent unknown
changes. Failure attempts rollback; an interrupted or incomplete recovery is shown
as **recovery required**, with the backup retained. Failed operations are recorded
for the next app session. No live folder is recursively deleted.

Verified files initially show **pending restart**. A fresh post-install companion
connection confirms the runtime restarted. That is separate from **Active** effect
status, which still requires exact request/revision acknowledgement and actual
rendering. A downloaded payload alone is never reported as installed.

## Source, licenses and building

Authoritative plugin source is now `vendor/true-liquid-glass/`, independent of the
old non-Git development folder. `UPSTREAM.json` pins Vencord revision
`e75ac9ace41f6212cfaa2d5f3670830be392da4e` and the required build flags.

Build a fresh runtime with Node >=22, Git, and pnpm 12.15.0:

```powershell
node scripts/build-true-glass.mjs
node scripts/verify-true-glass.mjs
cargo test --locked
cargo build --release --locked
node scripts/verify-true-glass.mjs --exe target/release/hotori.exe
```

The builder checks out the pinned upstream into `target/vencord-build`, stages
only the owned plugin, installs frozen dependencies, builds with
`--dev --standalone --disable-updater`, and typechecks. Source maps are checked
against the pinned upstream and exact vendored plugin, then excluded from delivery.
The initial imported artifact was validated the same way with `--reuse-build`.
`--stock-baseline <dist>` is a maintainer-only baseline import, requiring matching
upstream source maps and no userplugin mappings. Do not import arbitrary binaries
as trusted baselines. Baseline entries retain hashes only, never user data.

Commit the generated `assets/true-glass/` payload and `src/runtime_payload.rs`
together with the plugin source. `scripts/verify-true-glass.mjs` rejects mismatched
or incomplete sources. Corresponding upstream source ZIP, plugin source, GPL,
MIT, Apache and dependency notices are embedded and available through **Sources &
licenses** in the runtime dialog. Development dependencies, personal data, old
deployment reports and rollback snapshots are excluded.

The manual GitHub workflow `true-glass-runtime.yml` rebuilds and validates from
source without publishing or accessing the protected signing key. Release signing
and the stable three-asset app release remain the maintainer's local workflow.

## Ongoing runtime updates

The custom Vencord updater is intentionally disabled. **Hotori app releases own
runtime updates**, not theme CSS releases. Maintain the upstream revision: review
Vencord changes, update `UPSTREAM.json`, rebuild, typecheck, test and ship a new
signed Hotori installer batch. Existing clients receive the new payload through
the normal app updater and apply it after quitting Discord. Do not imply the
runtime will fetch newer upstream code on its own.

Run backend deployment tests, `npm run test:runtime-delivery`,
`npm run test:true-glass`, and the vendored plugin tests. Tests use disposable
client layouts and isolated browsers. First-time/upgrade bootstrap deployment
still needs authorized live testing. The imported four-surface build's member
rounding and edge sampling were user-confirmed; the latest narrow-bevel seam
change and server-rail/message-entry backgrounds still await final live visuals.
