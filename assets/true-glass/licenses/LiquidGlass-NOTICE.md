# LiquidGlass 1.0.3

- Author: ybouane
- Source: https://github.com/ybouane/liquidglass/tree/59af227103795f06421a96e2c7d3dceb081decd2
- Deployed package: https://cdn.jsdelivr.net/npm/@ybouane/liquidglass@1.0.3/dist/index.js
- Original deployed bundle SHA-256: `9630e5af0e9c27c3a88a2c4a7096a4f5e0f12e92afc6333f1552835dcc399bed`
- License: MIT. See [LICENSE](LICENSE).

The defaults and shader strings in `liquidglass-shaders.js` come from the bundle pinned by Hotori CSS Installer. The extracted values and shader text are unchanged. The plugin's `../renderer.js` adapts the upstream WebGL upload, blur, and panel drawing code with an explicit resource budget and lifecycle. The bundle's HTML capture and DOM orchestrator are omitted. All renderer code ships with the plugin.
