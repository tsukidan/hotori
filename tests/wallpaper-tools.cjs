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
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' })[path.extname(name)] || 'application/octet-stream');
      response.end(await fs.readFile(path.join(root, 'web', name)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const make = (name, label, section, kind, value, extra = {}) => ({ name, label, section, kind, value, hint: 'Preview setting.', choices: [], choiceHints: [], ...extra });
      let saved = [
        make('--blur-profile', 'Glass Profile', 'Glass appearance', 'choice', 'Acrylic', { choices: ['Acrylic', 'Liquid Glass'], choiceHints: ['', ''] }),
        make('--main-bg', 'Main Background', 'Wallpapers', 'image', ''),
        make('--settings-bg', 'Settings Background', 'Wallpapers', 'image', ''),
        ...['--bg-overlay-top', '--bg-overlay-bottom', '--settings-bg-overlay-top', '--settings-bg-overlay-bottom'].map((name, i) => make(name, ['Main Top Dimming', 'Main Bottom Dimming', 'Settings Top Dimming', 'Settings Bottom Dimming'][i], 'Background dimming', 'color', 'rgba(0, 0, 0, 0.4)', { color: '#000000', alphaEnabled: true, opacity: .4 })),
        make('--main-color', 'Accent Color', 'Accent color', 'color', '#5865f2', { color: '#5865f2', alphaEnabled: false, opacity: 1 }),
        make('--mention-glass-tint', 'Mention Highlight', 'Mention highlights', 'color', 'rgba(88, 101, 242, 0.2)', { color: '#5865f2', alphaEnabled: true, opacity: .2 }),
        make('--mention-glass-accent', 'Mention Accent Color', 'Mention highlights', 'color', '#5865f2', { color: '#5865f2', alphaEnabled: false, opacity: 1 }),
        make('--message-padding', 'Message Spacing', 'Message spacing', 'number', '4'),
      ];
      window.importedImages = {}; window.importCount = 0; window.saves = [];
      window.sourceData = (() => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
        const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 1200, 800);
        gradient.addColorStop(0, '#d42d45'); gradient.addColorStop(.35, '#efa52e'); gradient.addColorStop(.65, '#2866d8'); gradient.addColorStop(1, '#31cfb2');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800); return canvas.toDataURL();
      })();
      window.savedFixture = () => structuredClone(saved);
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.8.10', main_background: saved.find(field => field.name === '--main-bg').value };
        if (command === 'check_app_update' || command === 'check_theme_update') return { available: false };
        if (command === 'show_main_window') return;
        if (command === 'load_settings') return structuredClone(saved);
        if (command === 'app_wallpaper' || command === 'wallpaper_preview') return window.importedImages[args.uri] || window.sourceData;
        if (command === 'import_wallpaper') {
          const uri = `vencord:///themes/hotori-assets/${(++window.importCount).toString(16).padStart(16, '0')}.png`;
          window.importedImages[uri] = args.data; return uri;
        }
        if (command === 'save_settings') {
          window.saves.push(structuredClone(args.edits));
          saved = saved.map(field => {
            const value = args.edits.find(edit => edit.name === field.name).value;
            const next = { ...field, value };
            if (field.kind === 'color') {
              if (value.startsWith('#')) next.color = value.slice(0, 7);
              else { const parts = value.match(/[\d.]+/g).map(Number); next.color = '#' + parts.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); next.opacity = parts[3]; }
            }
            return next;
          }); return structuredClone(saved);
        }
        throw Error(command);
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator('#customize').click();
    await page.getByRole('tab', { name: 'Wallpapers', exact: true }).click();
    const main = page.locator('[data-wallpaper="main"]'), settings = page.locator('[data-wallpaper="settings"]');
    assert.equal(await main.locator('[data-name="--bg-overlay-top"]').count(), 1);
    assert.equal(await settings.locator('[data-name="--settings-bg-overlay-bottom"]').count(), 1);
    const data = await page.evaluate(() => window.sourceData);
    const file = { name: 'landscape.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') };
    await main.locator('input[type="file"]').setInputFiles(file);
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Crop aspect ratio').isDisabled(), true);
    assert(Math.abs(Number(await page.getByLabel('Crop aspect ratio').inputValue()) - 16 / 9) < .001);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.importCount), 0, 'Cancel must not import or change the image');
    await main.locator('input[type="file"]').setInputFiles(file);
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    await page.getByLabel('Crop zoom', { exact: true }).fill('1.5');
    await page.getByLabel('Crop zoom', { exact: true }).dispatchEvent('input');
    await page.locator('.crop-stage').focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Use crop', exact: true }).click();
    await page.waitForFunction(() => fields.find(field => field.name === '--main-bg').value.startsWith('vencord:'));
    await page.waitForFunction(() => document.querySelectorAll('.palette-quick .recommended-swatch').length === 2);
    const mainUri = await page.evaluate(() => fields.find(field => field.name === '--main-bg').value);
    const dimensions = await page.evaluate(async uri => { const im = new Image(); im.src = window.importedImages[uri]; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }, mainUri);
    assert(Math.abs(dimensions[0] / dimensions[1] - 16 / 9) < .005);
    assert.equal(await main.locator('.wallpaper-discord-preview').isVisible(), true);
    assert.deepEqual(await main.locator('.preview-chat').evaluate(el => {
      const style = getComputedStyle(el); return [style.backgroundColor, style.backdropFilter, style.borderTopWidth];
    }), ['rgba(0, 0, 0, 0)', 'none', '0px'], 'Main chat is open wallpaper, without a blurred enclosing panel');
    assert.equal(await main.locator('.preview-voice svg').count(), 1, 'Voice channel includes a speaker SVG');
    assert.equal(await main.locator('.preview-user-label strong').textContent(), 'Guest');
    assert.equal(await main.locator('.preview-server-title').textContent(), 'Community');
    const mentionBox = await main.locator('.preview-mention').boundingBox(), chatBox = await main.locator('.preview-chat').boundingBox();
    assert(mentionBox.width > chatBox.width * .75, 'Mention preview highlights a full message row');
    assert.equal(await main.locator('.preview-mention-avatar').textContent(), 'M');
    assert.equal(await main.locator('.preview-mention-author strong').textContent(), 'Member');
    assert.equal(await main.locator('.preview-inline-mention').textContent(), '@you');
    await main.locator('.wallpaper-discord-preview').screenshot({ path: path.join(root, 'target/qa/hotori-layout-preview.png') });
    assert.equal(await settings.locator('.wallpaper-discord-preview').count(), 0);
    assert.equal(await page.locator('#category-colors .recommendation-dot').evaluate(el => getComputedStyle(el).display), 'block');
    assert.equal(await page.locator('#category-messages .recommendation-dot').evaluate(el => getComputedStyle(el).display), 'block');
    await page.getByRole('tab', { name: 'Messages', exact: true }).click();
    await page.getByLabel('Message Spacing', { exact: true }).fill('99');
    const mention = page.locator('[data-name="--mention-glass-tint"] .recommended-swatch').first();
    await mention.click();
    await page.waitForFunction(() => window.saves.length === 1);
    assert.equal(await page.evaluate(() => window.savedFixture().find(field => field.name === '--mention-glass-tint').opacity), .2);
    assert.equal(await page.evaluate(() => window.savedFixture().find(field => field.name === '--message-padding').value), '4');
    assert.equal(await page.getByLabel('Message Spacing', { exact: true }).inputValue(), '99');
    await page.getByRole('tab', { name: 'Colors', exact: true }).click();
    await page.locator('[data-name="--main-color"] .recommended-swatch').first().click();
    await page.waitForFunction(() => window.saves.length === 2);
    assert.notEqual(await page.evaluate(() => window.savedFixture().find(field => field.name === '--main-color').value), '#5865f2');
    assert.equal(await page.evaluate(() => window.savedFixture().find(field => field.name === '--main-bg').value), '', 'Color autosave must not commit a wallpaper draft');
    await page.getByRole('tab', { name: 'Wallpapers', exact: true }).click();
    await page.getByRole('button', { name: 'Save Wallpapers', exact: true }).click();
    await page.waitForFunction(() => window.savedFixture().find(field => field.name === '--main-bg').value.startsWith('vencord:'));
    const before = await main.locator('.recommended-swatch').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')));
    await settings.locator('[data-name="--settings-bg"] .setting-control').evaluate(async row => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#00ff00'; x.fillRect(0, 0, 600, 800);
      const file = new File([await (await fetch(c.toDataURL())).blob()], 'portrait.png', { type: 'image/png' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      row.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Crop aspect ratio').isDisabled(), true);
    assert(Math.abs(Number(await page.getByLabel('Crop aspect ratio').inputValue()) - 1398 / 1293) < .0001);
    const settingsCrop = await page.locator('.crop-stage').boundingBox();
    assert(Math.abs(settingsCrop.width / settingsCrop.height - 1398 / 1293) < .005);
    await page.getByRole('button', { name: 'Use crop', exact: true }).click();
    await page.waitForFunction(() => fields.find(field => field.name === '--settings-bg').value.startsWith('vencord:'));
    const settingsPreview = await settings.locator('.wallpaper-preview').boundingBox();
    assert(Math.abs(settingsPreview.width / settingsPreview.height - 1398 / 1293) < .01);
    assert.deepEqual(await main.locator('.recommended-swatch').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label'))), before, 'Settings Background must never change the sampled palette');
    await main.getByRole('button', { name: 'Crop & zoom', exact: true }).click();
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Crop zoom', { exact: true }).inputValue(), '1.5', 'Crop metadata retains the original image and zoom');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: path.join(root, 'target/qa/wallpaper-tools-main.png') });
    await page.setViewportSize({ width: 560, height: 560 });
    await main.getByRole('button', { name: 'Crop & zoom', exact: true }).click();
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    const box = await page.locator('#wallpaper-crop-dialog').boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 560 && box.y >= 0 && box.y + box.height <= 560);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Exercise real canvas encoding with source dimensions above the old caps,
    // fractional crops, zoom, and crops smaller than the old 16px minimum.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const fixture of [
      { width: 2559, height: 1439, type: 'image/webp', zoom: 1, expected: [2558, 1439] },
      { width: 3840, height: 2160, type: 'image/png', zoom: 1, expected: [3840, 2160] },
      { width: 3840, height: 2160, type: 'image/png', zoom: 2, expected: [1920, 1080] },
      { width: 17, height: 10, type: 'image/png', zoom: 4, expected: [4, 2] },
      { width: 600, height: 800, type: 'image/png', zoom: 1, settings: true, expected: [600, 554] },
    ]) {
      const source = await page.evaluate(({ width, height, type }) => {
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        for (let x = 0; x < width; x++) { ctx.fillStyle = x % 2 ? '#123456' : '#fedcba'; ctx.fillRect(x, 0, 1, height); }
        return c.toDataURL(type);
      }, fixture);
      const row = fixture.settings ? settings : main;
      await row.locator('input[type="file"]').setInputFiles({ name: 'resolution-source', mimeType: fixture.type, buffer: Buffer.from(source.split(',')[1], 'base64') });
      await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
      await page.getByLabel('Crop zoom', { exact: true }).fill(String(fixture.zoom));
      await page.getByRole('button', { name: 'Use crop', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.wallpaper-feedback')].every(el => !el.textContent.includes('Saving')) && !document.querySelector('#wallpaper-crop-dialog'));
      await page.waitForFunction(() => !document.querySelector('[data-wallpaper="main"] input[type="file"]').disabled);
      const actual = await page.evaluate(async name => {
        const uri = fields.find(field => field.name === name).value;
        const image = new Image(); image.src = window.importedImages[uri]; await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, fixture.settings ? '--settings-bg' : '--main-bg');
      assert.deepEqual(actual, fixture.expected, `Original crop resolution: ${JSON.stringify(fixture)}`);
      const mismatch = await page.evaluate(async ({ source, fixture }) => {
        const original = new Image(); original.src = source; await original.decode();
        const cropped = new Image();
        cropped.src = window.importedImages[fields.find(field => field.name === (fixture.settings ? '--settings-bg' : '--main-bg')).value];
        await cropped.decode();
        const aspect = fixture.settings ? 1398 / 1293 : 16 / 9;
        const width = Math.min(original.naturalWidth, original.naturalHeight * aspect) / fixture.zoom;
        const sx = Math.round((original.naturalWidth - width) / 2), sy = Math.round((original.naturalHeight - width / aspect) / 2);
        const canvas = document.createElement('canvas'); canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(original, 0, 0);
        const expected = ctx.getImageData(sx, sy, cropped.naturalWidth, cropped.naturalHeight).data;
        canvas.width = cropped.naturalWidth; canvas.height = cropped.naturalHeight;
        ctx.drawImage(cropped, 0, 0);
        const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        return actual.findIndex((value, index) => value !== expected[index]);
      }, { source, fixture });
      assert.equal(mismatch, -1, 'Every exported pixel must equal the decoded source pixel, without interpolation');
    }
    const boundaryFile = Buffer.alloc(10 * 1024 * 1024);
    file.buffer.copy(boundaryFile);
    await main.locator('input[type="file"]').setInputFiles({ name: 'exact-limit.png', mimeType: 'image/png', buffer: boundaryFile });
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-wallpaper="main"] input[type="file"]').disabled);
    const previous = await page.evaluate(() => ({ uri: fields.find(field => field.name === '--main-bg').value, imports: window.importCount }));
    await main.locator('input[type="file"]').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await page.waitForFunction(() => document.querySelector('[data-wallpaper="main"] .wallpaper-feedback').textContent.includes('no larger than 10 MB'));
    assert.equal(await page.locator('#wallpaper-crop-dialog').count(), 0, 'Oversized source rejected before decoding');
    // A compressed WebP can fit the source limit while its full-resolution PNG
    // exceeds it. Fail clearly without importing either image or resizing it.
    const noisy = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 3200; c.height = 1800;
      const ctx = c.getContext('2d'), pixels = ctx.createImageData(c.width, c.height);
      let state = 12345;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; pixels.data[i + channel] = state >>> 24; }
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0); return c.toDataURL('image/webp', .9);
    });
    const noiseBytes = Buffer.from(noisy.split(',')[1], 'base64');
    assert(noiseBytes.length < 10 * 1024 * 1024);
    await main.locator('input[type="file"]').setInputFiles({ name: 'detailed.webp', mimeType: 'image/webp', buffer: noiseBytes });
    await page.locator('#wallpaper-crop-dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Use crop', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-wallpaper="main"] .wallpaper-feedback').textContent.includes('full-resolution PNG crop exceeds 10 MB'));
    assert.deepEqual(await page.evaluate(() => ({ uri: fields.find(field => field.name === '--main-bg').value, imports: window.importCount })), previous, 'Oversized crop preserves the previous wallpaper and imports no files');
    assert.deepEqual(errors, []);
    console.log('PASS: source-resolution WebP/4K/zoom/tiny/settings crops, 10 MB source boundary and oversized PNG rejection, crop/cancel/clipboard, previews, recommendations, isolated saves, preserved originals, and 560px layout.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
