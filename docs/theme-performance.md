# Hotori 0.9.0 performance work

Prepared locally on November 7, 2026. No installer code, installed theme, or remote branch changes are part of this work.

## Constraints

Retain live backdrop blur, existing layouts, typography, colors, supported settings, all three material profiles, and light/dark glass. Apple Silicon rendering failures are deferred. Do not claim a CSS highlight replaces a refraction renderer. Do not restore the previously reverted liquid-material or server-tooltip experiments.

Representative low-end target: Intel N150 / integrated Intel Graphics or Ryzen 3 7320U / Radeon 610M, 8 GB RAM, 1080p. These are representative manufacturer configurations, not a market-share claim or hardware actually benchmarked here:

- https://psref.lenovo.com/Product/IdeaPad_Slim_3_15ITN9
- https://www.hp.com/gb-en/shop/product.aspx?id=D37J1EA&opt=ABU&sel=NTB

## Full stylesheet audit

Reviewed the full theme: settings and calculated tokens; accent palette and native color aliases; wallpaper and structural panels; forum cards; text/icons; small glass surfaces; member rows; separators; message/mention/code/link styling; loading placeholders; autocomplete and composer; menus, tooltips and popouts; avatars and image shadows; typing and voice status; account controls; all three material profiles; vertical/horizontal server rails and state rings; settings backgrounds, groups and controls; modal/GIF/media handling; reply notification states; event/boost/account cards; embed typography; and unread animation.

Kept existing ancestor-backdrop reuse. Removing additional filters from nested surfaces can change their sampled backdrop and contrast, so it is not an automatic visual-equivalence optimization. Kept necessary relational selectors for native server state, media exclusion, typing, and portal attachment tooltips. No global containment, forced GPU promotion, content-visibility, opacity/transform overrides, blur reductions, static wallpaper capture, or disabled Discord transitions were added to the theme.

Changes:

1. Material style-query declarations now live on `body` and nested `.theme-dark` roots instead of every element. Specificity must override the base token declarations at a theme root. Compact Liquid Glass owners explicitly resolve their filter before inheritance; the existing title pseudo-element keeps its inherited filter behavior. This reduces repeated material calculation when rows and settings are mounted.
2. Replaced substring class selectors for embed titles, link icons, autocomplete, and composer icons with verified current classes. Checked both the loaded and lazy-loaded November 6 CSS snapshots. Multiple current component variants remain supported; historical aliases are not restored.
3. The unread marker retains its 5px white core and 1.8-second easing/opacity pulse. Two fixed shadow halos crossfade through opacity instead of animating box-shadow. This trades small intermediate halo differences and small compositor surfaces for avoiding continuous shadow repaint. No `will-change` is forced. Both system reduced motion and Discord's `.reduce-motion` remain supported.

## Validation

Standalone headless Edge 157.0.4341.42; synthetic DOM using the captured native Discord CSS, without connecting to Discord, controlling the desktop, or capturing the user's screen. The fixture initially contained 2,854 elements. It covers chat rows, links, mentions, code, embeds, sidebar and member rows, settings cards and switches, nested theme roots, profiles, attachment actions, native and reaction tooltips, GIFs, forum cards, pins, date/unread separators, account controls, reply controls, and channel headers. Additional probes cover the narrowed selectors.

At 1280px: all three profiles × both glass tints × chat/popout-settings views. Every compared non-marker computed property matched. A prior material-only run was pixel-identical in all 12 combinations. The final run's only pixel differences were tiny unread-halo rasterization differences (140–152 pixels in a 1280×800 image). A further 12 checks at760px with customized blur, saturation, accent, avatar size and avatar radius also had no unexpected computed-style differences. Minor halo/blur rasterization differences remained. All24 comparisons passed. The changelog validator and all3 Rust changelog unit tests also passed.

CPU measurements use 4× CPU throttling, five alternating before/after runs per profile. Medians below are synthetic work durations, not real Discord FPS, real settings-opening latency, or emulated N150 GPU performance. Each run mounts/removes ten copies of the settings fixture five times and inserts/removes thirty chat rows with forced layout reads. Values include deliberately forced style flushes; they are useful for relative comparisons only.

| Profile | Settings mount before → after (ms) | Style work before → after (ms/run) | Style reduction |
| --- | --- | --- | --- |
| Acrylic | 83.88 → 71.20 | 3043.18 → 2549.21 | 16.2% |
| Liquid Glass | 82.42 → 72.94 | 3188.28 → 2625.23 | 17.7% |
| No Glass | 86.00 → 66.22 | 3108.22 → 2479.47 | 20.2% |

Unread-only trace, twenty visible dots over 2.2 seconds after warm-up: original 10,143 Paint events / 87.042 ms total recorded paint duration; optimized 0 Paint events in that sample. This excludes GPU compositing cost and is not a zero-rendering-cost claim. Reduced-motion tests reported zero running animations in both versions. Five frozen pulse phases were compared; the largest mean channel difference over the full 360×700 fixture was 0.091 on a 0–255 scale. Intermediate halo interpolation is intentionally approximate, not pixel-identical.

Live blur still has GPU cost during scrolling. Synthetic CPU results do not establish smooth frame pacing on a weak GPU. Actual Discord scrolling/settings transitions remain a user check because screen capture/control was explicitly disabled.

## Maintenance and rollback

No settings added, removed, or renamed. All 34 published settings retain their prior defaults, including no wallpaper and neutral `#5865f2` accent. Theme 0.9.0 and matching `assets/theme-changelog.json` notes must ship together only after explicit push authorization; no EXE update is needed.

Local artifacts are under `C:/Users/danie/AppData/Roaming/Vencord/themes/hotori-optimization-0.9/`: pre-change DEV/publishable snapshots, verification scripts, computed-style/pixel results, benchmark results, and unread pulse captures. Do not upload personal DEV settings or wallpaper. To roll back implementation while preserving subsequent user setting edits, restore only the implementation after `END OF USER SETTINGS` from the matching snapshot. Revert publishable metadata/changelog together if discarding this unpublished release. Never copy the DEV settings prefix into the tracked publishable theme or overwrite the installed theme.

Measure selector costs instead of treating every `:has()` as equally expensive: https://developer.chrome.com/docs/devtools/performance/selector-stats
