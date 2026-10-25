const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    try {
      const name = new URL(request.url, 'http://localhost').pathname;
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpeg': 'image/jpeg' })[path.extname(name)] || 'application/octet-stream');
      response.end(await fs.readFile(path.join(root, 'web', name)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.accentFixture = '#2576ce';
      window.accentStatus = { ready: true, installed: true, theme_version: '0.8.9', main_background: 'https://example.com/blue.png' };
      const fields = [
        { name: '--blur-profile', label: 'Glass Profile', section: 'Glass appearance', kind: 'choice', value: 'Acrylic', choices: ['Acrylic','Liquid Glass','No Glass'], choiceHints: ['','',''], hint: 'Choose a style.' },
        { name: '--blur-val', label: 'Acrylic Blur', section: 'Blur & saturation', kind: 'number', value: '24', unit: 'pixels', slider: { min: 21.6, max: 26.4 }, hint: 'Fine-tune blur.' },
      ];
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === 'get_status') return structuredClone(window.accentStatus);
        if (command === 'check_app_update' || command === 'check_theme_update') return { available: false };
        if (command === 'load_settings') return structuredClone(fields);
        if (command === 'app_wallpaper') {
          const image = document.createElement('canvas'); image.width = image.height = 64;
          const context = image.getContext('2d'); context.fillStyle = window.accentFixture; context.fillRect(0, 0, 64, 64);
          return image.toDataURL();
        }
        throw Error(command);
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => {
      const rgb = document.documentElement.style.getPropertyValue('--accent').match(/\d+/g)?.map(Number);
      return rgb && rgb[2] > rgb[0] * 1.5;
    });
    await page.evaluate(() => {
      window.materialCalls = [];
      window.acrylicFilters = [];
      const filter = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'filter');
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'filter', {
        ...filter, set(value) {
          if (value.startsWith('blur(')) window.acrylicFilters.push(value);
          filter.set.call(this, value);
        },
      });
      const render = HotoriLiquidGlass.GlassRenderer.prototype.renderGlassPanel;
      HotoriLiquidGlass.GlassRenderer.prototype.renderGlassPanel = function(config, width, height, ...rest) {
        window.materialCalls.push({ config: {...config}, width, height });
        return render.call(this, config, width, height, ...rest);
      };
    });
    await page.locator('#customize').click();
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.effect?.target?.matches('.page') && animation.playState === 'running'));
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.materialCalls = []; window.acrylicFilters = []; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
    await page.waitForTimeout(150);
    await page.getByLabel('Glass Profile', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('select:open')?.style.getPropertyValue('--shader-picker-image'));
    const calls = await page.evaluate(() => window.materialCalls.filter(call => call.height > 500));
    assert(calls.some(call => call.width < 300) && calls.some(call => call.width > 500), 'Both outer panes must use the glass renderer');
    assert(calls.every(({ config }) => config.refraction > 0 && config.fresnel > 0), 'The Hotori sidebar and Glass Appearance pane retain liquid glass');
    const actionWidths = await page.locator('.settings-glass-action').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    assert.equal(await page.evaluate(widths => window.materialCalls.filter(call => call.width > 150 && call.height < 400 && !widths.some(width => Math.abs(width - call.width) < 1)).length, actionWidths), 0, 'Only the three settings actions use glass among inner controls');
    await page.keyboard.press('Escape');
    for (const action of ['#back', '#reset-defaults', '#save-category']) {
      assert(await page.locator(action).evaluate(el => el.style.getPropertyValue('--glass-refraction').startsWith('url(')), 'Settings actions retain compositor refraction');
    }
    await page.locator('#reset-defaults').click();
    await page.waitForFunction(() => document.querySelector('#reset-dialog').classList.contains('shader-glass'));
    await page.screenshot({ path: path.join(root, 'target/qa/reset-confirm-glass.png') });
    await page.locator('#reset-cancel').click();
    assert(await page.evaluate(() => window.acrylicFilters.length > 5 && window.acrylicFilters.every(value => value === 'blur(24px)')), 'Acrylic uses a real fixed 24px blur');
    assert.equal(await page.locator('select').evaluate(el => el.style.getPropertyValue('--glass-refraction')), '', 'Fallback must not generate an SVG lens for acrylic');
    assert(await page.locator('.settings-card').evaluate(el => el.style.getPropertyValue('--glass-refraction').startsWith('url(')), 'Outer panes retain compositor lens fallback');
    assert.equal(await page.locator('.category-tab').evaluate(el => getComputedStyle(el).getPropertyValue('--glass-surface-blur').trim()), '24px');
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).color), 'rgb(245, 246, 247)');
    await page.evaluate(async () => {
      window.accentFixture = '#2eb85c'; window.accentStatus.main_background = 'https://example.com/green.png'; await refresh();
    });
    await page.waitForFunction(() => {
      const rgb = document.documentElement.style.getPropertyValue('--accent').match(/\d+/g)?.map(Number);
      return rgb && rgb[1] > rgb[0] * 1.5 && rgb[1] > rgb[2] * 1.5;
    });
    const accent = await page.locator('html').evaluate(el => el.style.getPropertyValue('--accent').match(/\d+/g).map(Number));
    assert.equal(await page.locator('.settings-page .range-fill').evaluate(el => getComputedStyle(el).backgroundColor), `rgb(${accent.join(', ')})`);
    await fs.mkdir(path.join(root, 'target/qa'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'target/qa/acrylic-options-green.png') });
    await page.evaluate(async () => {
      window.accentFixture = '#888888'; window.accentStatus.main_background = 'https://example.com/gray.png'; await refresh();
    });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === 'rgb(184 196 210)');
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForFunction(() => devicePixelRatio === 2 && window.acrylicFilters.includes('blur(48px)'));
    assert.deepEqual(errors, []);
    console.log('PASS: both outer panes retain liquid glass; inner controls, navigation options and dropdowns use real 24 CSS-pixel acrylic at DPR 1 and 2; wallpaper accents, neutral text and grayscale fallback remain correct.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
