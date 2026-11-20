# True Liquid Glass installer integration

The installer implements the plugin project's **companion bridge v1** contract.
The signed installer now also embeds the custom Vencord runtime, source and
licenses. See [runtime delivery](true-liquid-glass-delivery.md). Applying it is
a separate closed-Discord transaction; it never enables the Vencord plugin or
edits Vencord's `settings.json`.

## Request ownership

`%APPDATA%\Hotori\TrueLiquidGlass\config.json` is authoritative for On/Off and
quality. The plugin owns `status\<instanceId>.json` in the same directory.
The installer preserves an existing request on opening Customize. Defaults are
Off/Balanced. The earlier localStorage On preference is offered as an unsaved
draft only when no request exists; pressing **Save Glass Appearance** migrates it.

Saves use the strict four-field schema, a serialized writer, unique same-directory
temporary files, flush/close, and atomic replacement with bounded retries.
`installer.lock` serializes Windows installer processes. The installer-owned
`installer-revision.json` retains the revision high-water mark across failed saves
and missing/malformed request recovery. Neither file is consumed by the plugin.
Revisions advance beyond the prior request, durable counter, observed instance
revisions (including expired reports), and the current timestamp. Bridge paths
reject links/reparse points. A failed replacement preserves the prior request.

The UI currently preserves the request's quality; it defaults new requests and
Reset to Balanced. Switching glass profiles never sends Off. Explicit Off and
Reset send Off; the plugin handles suspension/resumption from the effective
Discord theme profile.

## Runtime status

Status is polled about once a second while the control is visible. Only schema-v1,
UUID-named, bounded regular JSON files with valid required fields and timestamps
are considered. Expired reports, implausible future timestamps, and ended
instances cannot confirm rendering. Both revision fields, enabled preference,
and quality must match the saved request. `active` alone confirms rendered output;
an acknowledgement in `suspended`, `fallback`, or `error` is not active rendering.
Multiple live instances are summarized as mixed when their states differ.

“Request saved” means the file was persisted. Runtime acknowledgement is reported
separately beneath the switch. No acknowledgement means pending or unavailable,
never presumed active. An external request change asks the user to reopen settings.

## Validation and remaining deployment

- `cargo test --locked --offline`: request/schema bounds, failed atomic replacement,
  concurrent writer locking, durable revision recovery, heartbeat validation,
  unsafe-path rejection, and existing installer regressions.
- `npm run test:true-glass`: mock companion requests, save/reload/reset, explicit
  migration, On/Off, quality preservation, profile changes, stale/mismatched and
  mixed statuses, failed-save retry, keyboard access, reduced motion and layout.
- Tests use disposable files and an isolated browser; they do not alter the real
  user's companion request or interact with Discord.

Use **True Liquid Glass setup & updates** to apply the embedded runtime while
Discord is fully closed. After restarting, manually enable the plugin in Vencord,
save Liquid Glass plus True Liquid Glass, and confirm a fresh `active` report.
Runtime installation and effect acknowledgement are distinct. The imported build
has live testing history, but this installer deployment workflow has only been
tested with disposable installations, not applied to the user's live client.
