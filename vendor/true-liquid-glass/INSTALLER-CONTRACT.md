# True Liquid Glass companion bridge v1

## Files and ownership

On Windows, use the current user's roaming application-data directory:

- Installer-owned request: `%APPDATA%\Hotori\TrueLiquidGlass\config.json`
- Plugin-owned acknowledgements: `%APPDATA%\Hotori\TrueLiquidGlass\status\<instanceId>.json`

Resolve `%APPDATA%` for the same Windows account running Discord. Do not use the installer executable directory, theme directory, or Vencord `settings.json`. Each renderer connection gets a UUID instance ID. The single request applies to all enabled desktop instances for this user; read all fresh status files rather than picking an arbitrary one. Non-Windows prototypes use `~/.config/Hotori/TrueLiquidGlass/`.

## Request

```json
{"schemaVersion":1,"revision":1,"requestedEnabled":false,"quality":"balanced"}
```

All four fields are mandatory; additional fields are rejected. UTF-8 JSON must fit in 4096 bytes. `revision` is a nonnegative JavaScript-safe integer (maximum 9007199254740991); `quality` is `low`, `balanced`, or `high`. See `schemas/companion-config.schema.json`.

Missing file means Off and Balanced, with no applied revision (`null`). Malformed, oversized, unsupported-version, inaccessible, symlinked, or non-regular configuration fails closed: stop rendering and report `error` when the status directory can be written. A valid file is never silently rewritten by the plugin. The installer must migrate its existing local preference by explicitly writing this request; the plugin cannot read installer localStorage.

For every changed request, use a strictly greater revision. A connected instance rejects lower revisions and conflicting contents under the same revision, including after temporary missing/invalid input. Rewriting the exact same accepted revision/content is harmless. Keep the writer's revision counter durable; on recovery choose a revision greater than the file and observed status revisions. Use one installer writer per account (serialize saves). A timestamp-based counter `max(Date.now(), previousRevision + 1, observedRevision + 1)` is suitable within the safe-integer range.

### Atomic writing

Create the parent directory if needed. Write complete JSON to a uniquely named, exclusively created temporary file **in the same directory**, flush and close it, then atomically replace `config.json`. On Windows use `ReplaceFileW` for an existing target or `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH` as appropriate. Never truncate the live file, and never delete it before renaming. On sharing violations, retry with a short bounded backoff; if replacement fails, preserve the previous file and report the failed save. Ignore/remove only the writer's own abandoned temporary files. Do not follow symlinks/reparse points for bridge-owned files/directories.

Do not write an initial default over an existing request when opening the installer. Only announce that the effect is active after reading an acknowledgement for the exact saved revision.

## Precedence and lifecycle

- Vencord's plugin enabled state is independent and must be enabled separately. A request file never enables, installs, or injects the plugin.
- While the plugin is enabled, the shared request is the sole authority for effect On/Off and quality. The previous plugin-local `effectEnabled` and `quality` settings are no longer exposed or consulted; old stored values are left untouched.
- Defaults are Off/Balanced. Off destroys the rendering runtime and its GPU resources. The lightweight companion reader stays available while the plugin is enabled so a later On can be observed.
- On requests rendering only while the effective Discord `--blur-profile` resolves to Liquid Glass (`1`), with a usable wallpaper and supported panels. Other profiles suspend rendering and release rendering resources without changing `requestedEnabled`.
- Version 0.2.2 uses neutral shader brightness and no fixed black interior overlay. The existing wallpaper dimming and selected glass tint remain the controls for darkness, applied once each. The optical equations and blur passes are unchanged.
- **Do not write Off when merely switching profiles.** Preserve the saved On request. Returning to Liquid Glass resumes it. An explicit toggle Off writes `requestedEnabled:false` with a new revision.
- Foreground requests are checked approximately every 500 ms. Status changes are published after application, plus a heartbeat about every 2 seconds. Background timer throttling can delay this; expiry must be honored.
- Plugin stop/window destruction closes the session and writes a disabled acknowledgement when possible. No further polling continues. A crash or failed shutdown write is detected by heartbeat expiry.

## Status

Example while Liquid Glass is not the effective profile:

```json
{
  "schemaVersion": 1,
  "instanceId": "71fb3a2d-4bc0-45ba-81cd-7b2dc574a2c0",
  "pid": 12345,
  "pluginEnabled": true,
  "requestedRevision": 12,
  "appliedRevision": 12,
  "requestedEnabled": true,
  "quality": "balanced",
  "status": "suspended",
  "reason": "Waiting for the theme glass profile and wallpaper.",
  "updatedAt": "2026-11-18T12:00:00.000Z",
  "heartbeatExpiresAt": "2026-11-18T12:00:10.000Z"
}
```

`appliedRevision` acknowledges that the request was consumed, **not that pixels were rendered**. Require `status:"active"` for the latter. Native code re-reads the request before accepting a report, rejecting acknowledgements that race a newer request. Missing/invalid input has null requested/applied revision and effective Off/Balanced defaults.

| Status | Meaning |
| --- | --- |
| `active` | Runtime has successfully rendered supported panels. |
| `disabled` | Request is Off, request is missing, or the plugin/session has stopped. Check `pluginEnabled`. |
| `suspended` | On is preserved, but profile, wallpaper preparation, accessibility mode, or supported panels currently prevent rendering. |
| `fallback` | Rendering is unavailable; existing theme CSS remains, including WebGL/context or wallpaper sampling failures. |
| `error` | Invalid request, runtime startup failure, or bridge failure. Rendering is stopped where the failure can be handled. |

The installer should poll the status directory (e.g. once a second while its control is visible), accept only schema-v1 UUID-named regular JSON files, and validate types. A live acknowledgement requires `pluginEnabled:true`, `updatedAt` no older than 10 seconds, an unexpired `heartbeatExpiresAt`, and both revision fields matching the saved request. Ignore implausible future timestamps. Fresh `pluginEnabled:false` means that instance ended; stale/missing status means **not connected/unavailable**, not proof that the plugin is disabled or missing. Show pending when a live instance has not acknowledged the latest revision. With multiple instances, show mixed states rather than claiming every client is active.

Status files are replaced atomically by the plugin, never edited by the installer. Ignore `.tmp` files. Old instance files may remain after restarts; expiry makes them non-authoritative. No GPU-memory or performance claim is implied by `active`.

## Build and restart boundary

Copy `index.ts`, `native.ts`, and the entire `src/` directory into a Vencord source checkout under `src/userplugins/hotoriTrueLiquidGlass.desktop/`, preserving `src/vendor/LICENSE` and `NOTICE.md`. This is a custom source-build plugin, not a theme-folder script. Compile the desktop build; install/deploy it only through a separately authorized workflow. The first bridge addition and later native-code changes require rebuilding and a **full Discord quit/restart**. Ordinary request-file changes need no rebuild or restart. This task does not modify the installer UI or Vencord settings and does not deploy the build.
