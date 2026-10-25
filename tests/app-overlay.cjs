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
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf' })[path.extname(name)] || 'application/octet-stream');
      response.end(await fs.readFile(path.join(root, 'web', name)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.commands = [];
      window.__TAURI__ = { core: { invoke: async command => {
        window.commands.push(command);
        if (command === 'get_status') return { ready: true, installed: false };
        if (command === 'check_app_update') return { available: true, version: '9.0.0', currentVersion: '1.0.0' };
        if (command === 'show_main_window') return;
        throw Error(command);
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => document.documentElement.dataset.glassRenderer === 'reference-liquidglass');
    await page.evaluate(() => {
      window.panelMaterials = [];
      const render = HotoriLiquidGlass.GlassRenderer.prototype.renderGlassPanel;
      HotoriLiquidGlass.GlassRenderer.prototype.renderGlassPanel = function(config, width, height, ...rest) {
        window.panelMaterials.push({ config: { ...config }, width, height });
        return render.call(this, config, width, height, ...rest);
      };
      document.dispatchEvent(new Event('hotori:backdrop-change'));
    });
    await page.waitForFunction(() => window.panelMaterials.length > 0);
    const materials = await page.evaluate(() => {
      const find = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        const call = window.panelMaterials.find(call => Math.abs(call.width - box.width) < .5 && Math.abs(call.height - box.height) < .5);
        return Object.fromEntries(['blurAmount', 'brightness', 'tintStrength', 'saturation', 'refraction', 'chromAberration'].map(key => [key, call?.config[key]]));
      };
      return [find('.home-intro'), find('#home-status')];
    });
    assert.equal(materials[0].brightness, 0);
    assert.equal(materials[0].tintStrength, 0);
    assert.deepEqual(materials[0], materials[1], 'Description and installed-status glass must use the same optical material');
    const control = page.locator('.app-overlay-control'), slider = page.locator('#app-overlay-range');
    await page.waitForTimeout(500);
    assert.equal(Math.round((await control.boundingBox()).width), 76);
    assert.equal((await control.textContent()).trim(), '', 'No visible labels, numbers, or extra copy');
    await control.hover(); await page.waitForTimeout(500);
    assert.equal(Math.round((await control.boundingBox()).width), 244);
    assert.equal(Math.round((await page.locator('#command-dock').boundingBox()).width), 76, 'The main dock stays collapsed');
    const icon = await page.locator('.overlay-toggle .icon').boundingBox(), range = await slider.boundingBox();
    assert(icon.x + icon.width < range.x);
    assert.equal(await control.locator('.dock-surface').evaluate(el => el.classList.contains('shader-glass')), true);
    assert.equal(await control.locator('.range-fill').evaluate(el => getComputedStyle(el).backgroundColor), await page.evaluate(() => {
      const element = document.createElement('span'); element.style.color = 'var(--accent)'; document.body.append(element);
      const color = getComputedStyle(element).color; element.remove(); return color;
    }));
    for (const value of [0, 100, 37]) {
      await slider.fill(String(value)); await slider.dispatchEvent('input');
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-overlay-opacity')), String(value / 100));
      assert.equal(await page.evaluate(() => localStorage.getItem('hotori.appOverlayOpacity')), String(value));
    }
    assert(!(await page.evaluate(() => window.commands)).some(command => /save_settings|install_theme|update_theme/.test(command)));
    await page.screenshot({ path: path.join(root, 'target/qa/app-overlay-expanded.png') });
    await page.reload(); await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--app-overlay-opacity') === '0.37');
    assert.equal(await slider.inputValue(), '37', 'The app preference survives relaunch');
    await slider.evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => {
      const image = document.createElement('canvas'); image.width = image.height = 64;
      const ctx = image.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);
      document.querySelector('.wallpaper').style.setProperty('--app-wallpaper', `url("${image.toDataURL()}")`);
      document.dispatchEvent(new Event('hotori:backdrop-change'));
    });
    await page.waitForFunction(() => document.querySelector('.home-intro.shader-glass > canvas')?.width > 0);
    await page.waitForTimeout(400);
    assert.notEqual(await page.locator('.home-intro h2').evaluate(el => getComputedStyle(el).textShadow), 'none');
    assert.notEqual(await page.locator('.home-intro .description').evaluate(el => getComputedStyle(el).textShadow), 'none');
    await page.screenshot({ path: path.join(root, 'target/qa/home-intro-white-wallpaper.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await control.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    for (const [width, height] of [[800, 600], [560, 560]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      const rail = await page.locator('.dock-rail').boundingBox();
      assert(rail.y >= 52 && rail.y + rail.height <= height, JSON.stringify(rail));
      await page.locator('#app-overlay-toggle').focus();
      assert.equal(await slider.isVisible(), true);
      const rect = await control.boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= width);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: independent glass expansion, icon placement, accent fill, 0–100 app-only opacity, persistence, keyboard access, reduced motion and small-window fit.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
