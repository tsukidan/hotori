const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const png = 'data:image/png;base64,' + (await fs.readFile(path.join(root, 'icons/icon.png'))).toString('base64');
  const large = 'data:image/png;base64,' + require('./fixtures/large-wallpaper.cjs')(Buffer.from(png.split(',')[1], 'base64')).toString('base64');
  const jpeg = 'data:image/jpeg;base64,' + (await fs.readFile(path.join(root, 'web/assets/background.jpeg'))).toString('base64');
  const server = http.createServer(async (request, response) => {
    try {
      const name = new URL(request.url, 'http://localhost').pathname;
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.jpeg': 'image/jpeg', '.png': 'image/png' };
      response.setHeader('Content-Type', types[path.extname(name)] || 'application/octet-stream');
      response.end(await fs.readFile(path.join(root, 'web', name)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  async function open(initial = '') {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png.split(',')[1], 'base64') }));
    await page.addInitScript(({ initial, png, jpeg, large }) => {
      window.backgroundStatus = { ready: true, installed: true, main_background: initial, theme_version: '0.8.9' };
      window.backgroundLoads = [];
      let saved = ['--main-bg', '--settings-bg'].map((name, i) => ({ name, label: i ? 'Settings Background' : 'Main Background', section: 'Wallpapers', kind: 'image', value: i ? '' : initial, hint: 'Choose a wallpaper.' }));
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command === 'get_status') return structuredClone(window.backgroundStatus);
        if (command === 'check_app_update' || command === 'check_theme_update') return { available: false };
        if (command === 'load_settings') return structuredClone(saved);
        if (command === 'save_settings') {
          saved = saved.map(field => ({ ...field, value: args.edits.find(edit => edit.name === field.name).value }));
          window.backgroundStatus.main_background = saved[0].value;
          return structuredClone(saved);
        }
        if (command === 'reset_settings') {
          saved = saved.map(field => ({ ...field, value: '' })); window.backgroundStatus.main_background = '';
          return structuredClone(saved);
        }
        if (command === 'app_wallpaper') {
          window.backgroundLoads.push(args.uri);
          if (args.uri.includes('broken')) throw Error('Offline');
          if (args.uri.includes('slow')) await new Promise(resolve => setTimeout(resolve, 350));
          return args.uri.includes('large') ? large : args.uri.startsWith('vencord:') ? png : jpeg;
        }
        if (command === 'uninstall_theme') { window.backgroundStatus.installed = false; return; }
        throw Error(command);
      } } };
    }, { initial, png, jpeg, large });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => !document.getElementById('customize').disabled);
    return page;
  }
  const paint = page => page.locator('.wallpaper').evaluate(el => el.style.getPropertyValue('--app-wallpaper'));
  const waitCustom = page => page.waitForFunction(() => document.querySelector('.wallpaper').style.getPropertyValue('--app-wallpaper').startsWith('url("blob:'));
  const imageHash = (page, source) => page.evaluate(async source => {
    const url = source || document.querySelector('.wallpaper').style.getPropertyValue('--app-wallpaper').slice(5, -2);
    const bytes = await (await fetch(url)).arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }, source);
  try {
    const page = await open();
    assert.equal(await paint(page), '');
    assert((await page.locator('.wallpaper').evaluate(el => getComputedStyle(el).backgroundImage)).includes('assets/background.jpeg'));
    await page.locator('#customize').click();
    await page.getByRole('tab', { name: 'Wallpapers', exact: true }).click();
    const main = page.getByLabel('Main Background', { exact: true });
    await main.fill('https://example.com/main.jpg');
    assert.equal(await paint(page), '', 'Drafts do not replace the saved app background');
    await page.getByRole('button', { name: 'Save Wallpapers', exact: true }).click();
    await waitCustom(page);
    assert.equal(await imageHash(page), await imageHash(page, jpeg));
    for (const [uri, expected] of [['https://example.com/large.png', large], ['https://example.com/again.jpg', jpeg], ['https://example.com/large-again.png', large]]) {
      const previous = await paint(page);
      await main.fill(uri);
      await page.getByRole('button', { name: 'Save Wallpapers', exact: true }).click();
      await page.waitForFunction(previous => {
        const value = document.querySelector('.wallpaper').style.getPropertyValue('--app-wallpaper');
        return value.startsWith('url("blob:') && value !== previous;
      }, previous);
      assert((await paint(page)).length < 200, 'Large image pixels must not be placed directly in CSS variables');
      assert.equal(await imageHash(page), await imageHash(page, expected));
    }
    await page.getByLabel('Settings Background', { exact: true }).fill('https://example.com/settings.jpg');
    await page.getByRole('button', { name: 'Save Wallpapers', exact: true }).click();
    await page.evaluate(() => refresh());
    assert.equal(await page.evaluate(() => window.backgroundLoads.length), 4, 'Unchanged wallpaper is not downloaded on every refresh');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.wallpaper').style.getPropertyValue('--app-wallpaper'));
    await page.evaluate(async () => { window.backgroundStatus.main_background = 'https://example.com/broken.jpg'; await refresh(); });
    assert.equal(await paint(page), '');
    await page.evaluate(async () => {
      window.backgroundStatus.main_background = 'https://example.com/slow.jpg'; await refresh();
      window.backgroundStatus.main_background = ''; await refresh();
    });
    await page.waitForTimeout(500);
    assert.equal(await paint(page), '', 'An old request cannot restore a cleared background');
    const reopened = await open('vencord:///themes/hotori-assets/1234567890abcdef.png');
    await waitCustom(reopened);
    assert.equal(await imageHash(reopened), await imageHash(reopened, png), 'Saved local background is restored on startup');
    await reopened.waitForFunction(() => document.documentElement.dataset.glassRenderer === 'reference-liquidglass');
    await reopened.locator('#uninstall').click();
    await reopened.locator('#uninstall-confirm').click();
    await reopened.waitForFunction(() => !document.querySelector('.wallpaper').style.getPropertyValue('--app-wallpaper'));
    assert.deepEqual(errors, []);
    console.log('PASS: bundled default, saved main background, unchanged settings background, cached loads, local startup restore, reset, unavailable links, stale requests, uninstall fallback, and active glass refraction.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
