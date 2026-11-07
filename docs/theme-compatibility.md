# Repairing Discord theme compatibility

Discord can replace generated CSS class names throughout its client in one update. On November 6, 2026, Hotori lost most styling because names such as `appMount__51fd7` became `appMount_gEkNtR`. The suffix format changed from hexadecimal to six mixed-case/base64url characters, including `_` and `-`. Hotori 0.8.17 adds 371 reviewed class mappings across 1,012 selector occurrences. The [mapping record](theme-compatibility/2026-11-06-class-map.json) preserves the old/current names and the remaining legacy fallback.

## Diagnose before changing the design

1. Confirm the intended theme is enabled, its stylesheet loads, and Vencord itself still runs. Inspect a broken element in the live Discord client. A nearly universal loss of styling with renamed classes suggests selector drift; disappearing composited content while selectors still match needs separate graphics/filter diagnosis.
2. Record the Discord desktop build and platform. Public Discord web assets can differ from the installed client. Prefer its loaded styles; use public bundles to supplement lazy-loaded routes only after checking that their core names agree.
3. Preserve the current DEV and publishable sources before editing. Preserve user settings separately. Do not overwrite the installed `hotori.theme.css` or change installer code during theme development.

## Keep a known-good CSS baseline

Keep a local snapshot of public Discord styles after each repair. Capture only stylesheet URLs and CSS, not messages, account data, tokens, storage or network headers. Do not commit bulk third-party CSS or personal backups.

The following read-only page inspection exports Discord's public styles to a local JSON download. Run in Discord's developer console only when it is already available; do not bypass a browser/DevTools security restriction. A save dialog may open behind DevTools. CSSOM access errors should be reported rather than silently treated as complete coverage.

```js
(() => {
  const sheets = [...document.styleSheets]
    .filter(sheet => sheet.href?.startsWith('https://discord.com/assets/'))
    .map(sheet => ({
      href: sheet.href,
      css: [...sheet.cssRules].map(rule => rule.cssText).join('\n')
    }));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(sheets)], {
    type: 'application/json'
  }));
  link.download = 'discord-public-styles.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return sheets.length;
})();
```

This covers loaded screens, not every route. Visit relevant settings, forum, popout and server views to extend coverage. Chromium's cache can also contain public CSS, but cache layouts and compression can change. The November 6 local extractor handled block-cache entries and Brotli/gzip/deflate/zstd; do not assume that format indefinitely.

## Generate and review suggestions

The report tool uses Node's built-in libraries and never edits a theme:

```powershell
node scripts/theme-selector-report.mjs --theme <dev-theme.css> --baseline <known-good-styles.json> --current <new-styles.json> --out <report.json>
```

Inputs accept raw CSS or a JSON array of objects with `css` fields; either snapshot argument may be repeated. Use distinct source snapshots from before and after the Discord update. The tool groups classes by generated suffix and compares their descriptive member names, giving uncommon names more weight. It reports unchanged classes, candidates, and unresolved cases. Scores describe source similarity, not proof of DOM equivalence.

Never auto-apply ambiguous names such as `container`, `wrapper`, `root` or `banner`. Compare native declarations, sibling classes, component context and the live DOM. A missing class might be removed, moved or only absent from the current capture. Identical reaction variants can need more than one reviewed target. Explicit class tokens are preferable to broad substring selectors.

Use current Discord class names directly by default. After the November 6 repair, the user requested removal of the old/new compatibility aliases while investigating scrolling lag. Their performance impact has not been established. Retain historical names in mapping records, not active selectors; add rollout compatibility aliases only when explicitly requested. More than one current component variant can still require a normal grouped selector. Check any generated class names embedded in attribute selectors separately. Keep declarations, custom-property names and layout intact unless a separate layout change is verified.

## Verify and publish

- Compare parsed CSS before/after: a selector migration should retain implementation declarations and valid rules. Verify representative chat, composer, channels, server list, profiles/popouts, settings and forum views in Discord. Check Acrylic, Liquid and No Glass where affected. Source-only coverage must not be described as full visual coverage.
- Keep DEV as the active development file. Preserve the user's currently used customization values; the installed release file remains untouched. Sync only ready implementation and supported settings into the publishable file, preserving its neutral accent, `none` wallpaper defaults, name and exactly one settings marker.
- Update the local maintenance notes with build, mappings, backups, validation, limitations and pending changes. Keep new baseline snapshots for the next update.
- Push only with explicit user authorization. Every theme push increments the patch version and includes matching `assets/theme-changelog.json` notes in the same commit/push. Patch numbering continues past 0.8.9 to 0.8.10; do not roll to 0.9.0 without a major change or instruction.
- Run `python scripts/check-theme-changelog.py`, `cargo test --release --locked theme_changelog::tests`, `git diff --check`, release-default/settings checks and staged-file review. No EXE release is required for a CSS update.

The November 6 repair was visually checked in Windows Discord desktop 1.0.9267 for chat and main settings. It does not resolve the separate, unverified Apple Silicon backdrop-filter rendering report. `shopScroll__08415` remains a legacy fallback; its cleanup rule also has mapped shop/scroll alternatives.
