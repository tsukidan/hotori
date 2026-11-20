const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const dependencyRoot = process.env.HOTORI_TEST_DEPENDENCIES;
const { chromium } = dependencyRoot
  ? createRequire(path.join(dependencyRoot, 'package.json'))('playwright')
  : require('playwright');

const wallpaper = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="400" height="600" fill="rgb(172,172,172)"/>
  <rect x="400" width="400" height="600" fill="rgb(222,202,180)"/>
</svg>`;
const fixture = `<!doctype html><style>
  body { margin:0; --blur-profile:1; --main-bg:url('/wallpaper.svg'); --liquid-saturation:100%; }
  .panel { position:absolute; box-sizing:border-box; top:170px; width:260px; height:260px; border-radius:20px; }
  .sidebarList_fixture { left:70px; } .membersWrap_fixture { left:470px; }
</style>
<div class="panel sidebarList_fixture"><div class="row">Channel</div></div>
<div class="panel membersWrap_fixture"><div class="row">Member</div></div>`;
const lateTheme = `
  .sidebarList_fixture, .membersWrap_fixture {
    background: linear-gradient(90deg, #303030, #505050) #404040 !important;
    -webkit-backdrop-filter: blur(3px) !important;
    backdrop-filter: blur(3px) !important;
    box-shadow: 0 3px 6px black !important;
    border: 1px solid #808080 !important;
  }
  .panel > .row { background: #223344 !important; box-shadow: 0 1px 2px #111 !important; }
`;

function assertChannels(actual, expected, label) {
  for (const [index, channel] of expected.entries()) {
    assert(Math.abs(actual[index] - channel) <= 3, `${label}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const assets = new Map([
    ['/', ['text/html', fixture]],
    ['/wallpaper.svg', ['image/svg+xml', wallpaper]],
  ]);
  for (const name of ['src/runtime.js', 'src/renderer.js', 'src/vendor/liquidglass-shaders.js']) {
    assets.set('/' + name, ['text/javascript', await fs.readFile(path.join(root, name))]);
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await page.route('http://material.test/**', route => {
      const asset = assets.get(new URL(route.request().url()).pathname);
      return route.fulfill(asset ? { contentType: asset[0], body: asset[1] } : { status: 404 });
    });
    await page.goto('http://material.test/');
    await page.evaluate(async () => {
      const { GlassRuntime } = await import('/src/runtime.js');
      window.runtime = new GlassRuntime();
      runtime.start();
    });
    await page.addStyleTag({ content: lateTheme });

    const styles = selector => page.locator(selector).evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.backgroundImage, style.backdropFilter, style.boxShadow, style.border];
    }));
    const panelFallback = await styles('.panel');
    const rows = await styles('.row');
    assert(panelFallback.every(([color, image, filter]) => color === 'rgb(64, 64, 64)' && image.includes('linear-gradient') && filter === 'blur(3px)'));
    await page.evaluate(() => runtime.update({ enabled: true }));
    const waitForActive = () => page.waitForFunction(() => runtime.getStats().state === 'active');
    await waitForActive();

    const active = await styles('.panel');
    assert(active.every(([color, image, filter, shadow], index) =>
      color === 'rgba(0, 0, 0, 0)' && image === 'none' && filter === 'none' &&
      shadow === 'none' && active[index][4] === panelFallback[index][4]));
    assert.deepEqual(await styles('.row'), rows);

    const pixels = () => page.locator('.hotori-true-glass-output').evaluateAll(canvases => canvases.map(canvas =>
      Array.from(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data)));
    const neutral = await pixels();
    assert.equal(neutral.length, 2);
    const sourceColors = [[172, 172, 172], [222, 202, 180]];
    neutral.forEach((pixel, index) => assertChannels(pixel, [...sourceColors[index].map(channel => channel * 1.06), 255], 'neutral glass'));

    const previous = await page.evaluate(async () => {
      const { GlassRenderer, DEFAULTS, SHADOW_PAD } = await import('/src/renderer.js');
      const renderer = new GlassRenderer();
      try {
        return Array.from(document.querySelectorAll('.panel')).map(panel => {
          const box = panel.getBoundingClientRect();
          const width = box.width + 2 * SHADOW_PAD;
          const height = box.height + 2 * SHADOW_PAD;
          renderer.uploadAndBlur(runtime.scene, box.left - SHADOW_PAD, box.top - SHADOW_PAD, width, height, .3);
          renderer.clear();
          renderer.renderGlassPanel({
            ...DEFAULTS, refraction: 1.2, chromAberration: .2, zRadius: 60, cornerRadius: 20, brightness: -.2,
          }, box.width, box.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(renderer.canvas, 0, 0, width, height, 0, 0, width, height);
          ctx.fillStyle = 'rgba(0,0,0,.1)';
          ctx.fillRect(0, 0, width, height);
          return Array.from(ctx.getImageData(width / 2, height / 2, 1, 1).data);
        });
      } finally {
        renderer.destroy();
      }
    });
    neutral.forEach((pixel, index) => assert(pixel[0] - previous[index][0] > 45, 'clear glass removes both automatic darkening layers'));

    const tint = [12, 16, 24];
    const oldPaints = await page.evaluate(() => {
      document.body.style.setProperty('--bg-overlay-top', 'rgba(0,0,0,.1)');
      document.body.style.setProperty('--bg-overlay-bottom', 'rgba(0,0,0,.4)');
      document.body.style.setProperty('--glass-background', 'rgba(12,16,24,.24)');
      runtime.schedule();
      return runtime.getStats().paints;
    });
    await page.waitForFunction(old => runtime.getStats().paints >= old + 2, oldPaints);
    const tinted = await pixels();
    tinted.forEach((pixel, index) => assertChannels(pixel, [
      ...neutral[index].slice(0, 3).map((channel, rgb) => channel * .75 * .76 + tint[rgb] * .24), 255,
    ], 'wallpaper gradient and tint each applied once'));

    await page.evaluate(() => {
      document.body.style.setProperty('--main-bg', "url('/missing-wallpaper.svg')");
      runtime.schedule();
    });
    await page.waitForFunction(() => runtime.getStats().state === 'fallback');
    assert.equal(await page.locator('.hotori-true-glass-host,.hotori-true-glass-output').count(), 0);
    assert.deepEqual(await styles('.panel'), panelFallback);
    assert.deepEqual(await styles('.row'), rows);
    console.log('PASS: clear wallpaper pixels, explicit gradient and tint, late theme cascade, and fallback restoration.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
