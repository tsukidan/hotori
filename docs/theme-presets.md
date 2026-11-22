# Theme presets

Presets are user data in `%APPDATA%\Hotori\presets.json`, not bundled app assets. The initial gallery is empty. The schema stores an ID, name, a map of user-setting names to canonical CSS values, and an optional True Liquid Glass request (enabled state and quality).

Saving captures all currently displayed theme values, including unsaved drafts, without saving the theme itself. Music, volume, launcher brightness, plugin installation and Discord settings are excluded. Preset names are rendered as text, not markup.

Applying maps settings by name into the currently installed theme. Removed settings are ignored and newer settings absent from an older preset keep their current values. The theme implementation, version and comments are never replaced by a historical CSS snapshot. Normal validation and external-file-change protection apply. A missing local wallpaper or logo blocks application before the CSS changes.

Image values reference the original supported wallpaper assets in `hotori-assets`. Neither capture nor apply resizes, recompresses or removes those images. Gallery thumbnails are separate 480×270 PNGs held in memory; they load on intersection, share cached results, and decode serially. Remote previews reuse the existing native wallpaper reader/cache.

After theme application, the optional True Liquid Glass request goes through the existing atomic companion bridge. It does not enable or install a Vencord plugin. A failure at this stage explicitly reports that theme settings were applied but the companion request failed. Runtime acknowledgement is still reported under Glass Appearance.

Library writes are serialized and use a flushed temporary file with atomic replacement. Malformed libraries are preserved and reported rather than silently overwritten. Deleting requires confirmation and only removes the preset record; the installed theme and referenced images remain unchanged.

Validation: `cargo test --locked --offline` covers capture/apply/delete, alpha round trips, missing images, invalid values, corrupt storage, and old-preset compatibility. `npm run test:presets` exercises the UI, previews, selection/apply, deletion, storage/application failures, persistence, reduced motion and responsive layouts with isolated fixtures.
