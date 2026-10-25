// Real crop/import/preview/color-save flow, using only a disposable theme folder.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(root, 'target/qa/native-crop-'));
  const folder = path.join(profile, 'Vencord/themes'); await fs.mkdir(folder, { recursive: true });
  const destination = path.join(folder, 'hotori.theme.css');
  await fs.copyFile(path.join(root, 'assets/hotori.theme.css'), destination);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(path.join(root, 'target/release/hotori.exe'), [], { windowsHide: true,
    env: { ...process.env, APPDATA: profile, WEBVIEW2_USER_DATA_FOLDER: path.join(profile, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { await fetch(`http://127.0.0.1:${port}/json/version`); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !document.getElementById('customize')?.disabled);
    await page.locator('#customize').click();
    await page.getByRole('tab', { name: 'Wallpapers', exact: true }).click();
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 800, 600);
      g.addColorStop(0, '#e24f45'); g.addColorStop(.5, '#dfab2a'); g.addColorStop(1, '#396ee4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 800, 600); return c.toDataURL();
    });
    await page.locator('[data-name="--main-bg"] input[type="file"]').setInputFiles({ name: 'crop-source.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') });
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#wallpaper-crop-dialog').classList.contains('shader-glass'));
    await page.getByLabel('Crop zoom', { exact: true }).fill('1.3');
    await page.getByLabel('Crop zoom', { exact: true }).dispatchEvent('input');
    await page.screenshot({ path: path.join(root, 'target/qa/native-crop-dialog.png') });
    await page.getByRole('button', { name: 'Use crop', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('save-category').disabled);
    await page.getByRole('button', { name: 'Save Wallpapers', exact: true }).click();
    await page.waitForFunction(() => !busy && document.getElementById('settings-status').textContent.includes('Wallpapers saved'));
    let theme = await fs.readFile(destination, 'utf8');
    const match = theme.match(/--main-bg:\s*url\(['"](vencord:\/\/\/themes\/hotori-assets\/[a-f0-9]+\.png)['"]\)/);
    assert(match, 'The actual theme saves the scoped cropped image');
    const uri = match[1], imagePath = path.join(folder, uri.split('vencord:///themes/')[1]);
    assert((await fs.stat(imagePath)).size > 0);
    const dimensions = await page.locator('[data-name="--main-bg"] .wallpaper-preview').evaluate(image => [image.naturalWidth, image.naturalHeight]);
    assert.equal(dimensions[0] * 9, dimensions[1] * 16);
    await page.waitForFunction(() => document.querySelectorAll('.palette-quick .recommended-swatch').length === 2);
    await page.getByRole('tab', { name: 'Messages', exact: true }).click();
    const spacing = page.getByLabel('Message Spacing', { exact: true });
    if (await spacing.count()) await spacing.fill('9');
    await page.getByRole('tab', { name: 'Colors', exact: true }).click();
    const swatch = page.locator('[data-name="--main-color"] .recommended-swatch').first();
    await swatch.waitFor({ state: 'visible' });
    const hex = (await swatch.getAttribute('aria-label')).match(/#[0-9A-F]{6}/)[0];
    await swatch.click(); await page.waitForFunction(() => !busy);
    theme = await fs.readFile(destination, 'utf8');
    assert(theme.toLowerCase().includes(`--main-color: ${hex.toLowerCase()}`));
    assert(theme.includes(uri), 'Saving a recommended color keeps the cropped wallpaper');
    assert.equal(await page.locator('[data-name="--main-color"] input[type="color"]').inputValue(), hex.toLowerCase());
    await page.screenshot({ path: path.join(root, 'target/qa/native-recommended-colors.png') });
    await page.getByRole('tab', { name: 'Wallpapers', exact: true }).click();
    await page.locator('[data-name="--main-bg"]').getByRole('button', { name: 'Crop & zoom', exact: true }).click();
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Crop zoom', { exact: true }).inputValue(), '1.3');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS: native WebView2 glass crop editor, exact 16:9 PNG import/save, main preview, palette recommendations, actual isolated color save and original-source recropping.');
  } finally { if (browser) await browser.close(); child.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
