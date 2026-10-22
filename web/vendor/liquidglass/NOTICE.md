# LiquidGlass 1.0.3

Source: https://github.com/ybouane/liquidglass/tree/59af227103795f06421a96e2c7d3dceb081decd2
Deployed package: https://cdn.jsdelivr.net/npm/@ybouane/liquidglass@1.0.3/dist/index.js
Author: ybouane. The upstream package and README declare the MIT license.

The complete deployed bundle is vendored locally. It includes html-to-image and the upstream fractional-font-size fix. No runtime CDN dependency is used.

Integration changes (the optical shaders, defaults and blur passes are unchanged):
1. Replace ES-module exports with a scoped classic-script namespace, exposing the original renderer, capture helper and orchestrator to Hotori and its reference tests.
2. Add an optional onCloneNode callback after computed styles are copied. The adapter can hide cloned children while preserving their dimensions; it never mutates the live UI for capture.
3. Bound the renderer framebuffer cache to 32 sizes to avoid unbounded allocation during dock expansion. Eviction frees GPU resources and does not change output.

The adapter uses the original HtmlCapture font handling, html-to-image capture, GlassRenderer upload/blur/composite, and shader-generated shadows. The original LiquidGlass orchestrator is retained for independent reference comparisons. Hotori's hierarchy and clipping adapter lives in web/glass-shader.js.

Remote wallpaper previews without CORS remain visible in the native UI but are excluded from the sampled scene. A one-pixel origin-clean probe isolates them before composition so one external preview cannot disable the renderer. Local and same-origin content is sampled normally. This respects the browser's canvas access rules; it does not proxy remote requests or relax external network permissions.

Original deployed bundle SHA-256: 9630e5af0e9c27c3a88a2c4a7096a4f5e0f12e92afc6333f1552835dcc399bed
