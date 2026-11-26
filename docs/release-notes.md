# Release-note writing standard

Applies to **the Hotori installer/app, theme CSS, and True Liquid Glass plugin/runtime**. Follow each component's existing versioning and catalog format. This guide changes how notes are written, not when a release is authorized.

## Write for the person using the app

Explain what changed for the user, why they would care, and any action they need to take. Use the same names they see in the interface. Prefer one short sentence per bullet; use a second sentence only for a necessary step or limitation.

- Group related changes under short familiar headings, such as Presets, Wallpapers, Background Music, or Improvements.
- Aim for 2–5 useful bullets for a normal release. Small releases can have one sentence. Do not pad a short update with technical trivia.
- Lead with the biggest user-visible change. Describe what people can now do or what problem they will no longer encounter.
- State **Apply**, restart requirements, manual plugin enablement, changed defaults, compatibility limits, and effects on saved data when users need to know them.
- Keep wording factual. Do not promise smoother performance, preserved data, or a resolved issue unless the implementation and checks support that claim.
- Do not dump commit messages, source paths, CSS selectors, internal parameter names, shader math, cache details, test counts, or dependency revisions into user-facing notes. Keep those in developer documentation, commits, or validation records.

## Routine maintenance

If an update mainly contains small internal fixes with no action or notable behavior change for users, condense them to:

> Minor bug fixes and improvements.

Do not enumerate every refactor or micro-fix. Do not add this line as filler to a feature-only release.

A bug fix deserves a plain-language explanation when it has a meaningful effect on users. For example, explain that a saved wallpaper loads again or that a specific action now saves correctly. **Do not hide security/privacy issues, possible data loss, broken installation/update recovery, removed functionality, required restarts, or compatibility changes behind the generic maintenance line.**

## Examples of the desired voice

These are examples, not claims about a release that has not been tested.

| Developer-oriented wording | User-facing wording |
| --- | --- |
| Add validated overwrite IPC with canonical alpha-preserving serialization | Update an existing preset with your current settings. Choose Overwrite from its menu, then confirm. |
| Replace card actions with a staggered spring animation and clipped grid-row expansion | Rename, update, or delete a preset from the menu beneath its card. |
| Remove per-row backdrop compositing to eliminate horizontal band artifacts | Message bubbles now have an even background without horizontal lines. |
| Fix revision acknowledgement and heartbeat validation | The glass status now more accurately shows whether the effect is running. |
| Restructure selectors and remove redundant declarations without visual changes | Minor bug fixes and improvements. |

## Component-specific notes

### Installer/app

Use `assets/app-changelog.json` and the matching GitHub app release. Keep the in-app summary and published release notes consistent. Use short Markdown headings and bullets supported by the existing renderer. Separate app changes from theme/plugin changes; explain companion setup only when it actually changes the user's workflow.

### Theme CSS

Use `assets/theme-changelog.json` alongside the authorized matching CSS release. Preserve its schema of titles and descriptions. Keep titles short and describe the visible difference in ordinary Discord terms. A maintenance-only entry can use title `Improvements` and description `Minor bug fixes and improvements.` Do not expose selector names or rewrite implementation history as user guidance.

### Plugin/runtime

Use the plugin's existing release-note format and distinguish receiving a new runtime from actually installing/enabling it. Explain whether Discord must fully quit/restart, whether plugin enablement is manual, any new performance limitation, and what supported surfaces changed when relevant. Summarize internal rendering/refactoring work unless it fixes an identifiable user problem. Do not claim that downloading a payload means the effect is active.

## Visual hierarchy and icons

- The release viewer uses a **liquid-glass outer dialog**.
- Major title/version groups use **white acrylic** containment, bold white text with restrained text shadow, and white SVG icons, with the main accent reserved for borders, icon-chip backgrounds, or small highlights.
- Section titles are a quieter white-acrylic level. Descriptions sit in slightly darker regions with 12px backdrop blur (half the headings’ 24px), generous line spacing and short lists. Header and body meet without an internal divider or gap. Keep the existing liquid-glass outer container when applying grouped headings to theme notes.
- Keep dates, version selection and metadata subordinate. Reserve bright color for structure and meaning; do not color entire paragraphs with the accent.
- **No emoji or Unicode icon substitutes.** In the app, use trusted local outline SVG icons. Keep published Markdown text-only where inline SVG is unsupported; the UI supplies icons separately. Never accept executable HTML/SVG from release-note content.
- Preserve keyboard/focus behavior, small-window scrolling, reduced motion, and safe text rendering when improving presentation.

## Before handing off or publishing

Check that each bullet answers a real user question, that routine fixes are condensed, and that required actions and important limitations remain explicit. Match the notes to the actual component/version and verified changes. Preserve historical release facts; do not silently rewrite old published release notes during a new release. Do not bump theme or plugin versions merely to update installer presentation or shared documentation.
