const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const qa = path.resolve(__dirname, '../target/qa');
  const errors = [];
  // file:// images taint WebGL textures; use the same-origin asset delivery
  // that Tauri uses in production.
  const server = http.createServer(async (request, response) => {
    try {
      const file = path.join(__dirname, '../web', decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpeg': 'image/jpeg' };
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir(qa, { recursive: true });
  try {
    await page.addInitScript(() => {
      window.gpuDraws = 0;
      const draw = WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays = function (...args) { window.gpuDraws++; window.glassContext = this; return draw.apply(this, args); };
      const field = (name, section, kind, value, label, extra = {}) => ({ name, section, kind, value, label, hint: 'Fine-tune your theme.', ...extra });
      const fields = [
        field('--blur-profile', 'Glass appearance', 'choice', 'Acrylic', 'Glass Profile', { choices: ['Acrylic', 'Liquid Glass', 'No Glass'], choiceHints: ['Soft frosted glass.', 'Clear refractive glass.', 'No glass.'] }),
        field('--blur-val', 'Blur & saturation', 'number', '24', 'Acrylic Blur', { unit: 'pixels', slider: { min: 21.6, max: 26.4 } }),
        field('--liquid-blur-val', 'Blur & saturation', 'number', '2.5', 'Liquid Glass Blur', { unit: 'pixels', slider: { min: 2.25, max: 2.75 } }),
        field('--liquid-saturation', 'Blur & saturation', 'number', '220', 'Liquid Glass Color Intensity', { unit: '%', slider: { min: 198, max: 242 } }),
        field('--glass-dark', 'Glass tints', 'color', 'rgba(12, 16, 24, 0.24)', 'Dark Glass Tint', { color: '#0c1018', opacity: .24, alphaEnabled: true }),
        field('--main-bg', 'Wallpapers', 'image', '', 'Main Background'),
        field('--main-color', 'Accent color', 'color', '#5865f2', 'Accent Color', { color: '#5865f2' }),
        field('--secondary-ui-color', 'Text & icon colors', 'color', '#ffffff', 'Message & Input Text', { color: '#ffffff' }),
        field('--message-avatar-size', 'Avatars', 'number', '60', 'Message Avatar Size', { unit: 'pixels', slider: { min: 54, max: 66, avatarPercent: true } }),
        field('--mention-glass-tint', 'Mention highlights', 'color', 'rgba(255, 205, 64, 0.14)', 'Mention Highlight', { color: '#ffcd40', opacity: .14, alphaEnabled: true }),
        field('--server-list-layout', 'Server list', 'choice', 'Vertical', 'Server List Layout', { choices: ['Vertical', 'Horizontal'], choiceHints: ['', ''] }),
      ];
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.8.8' };
        if (command === 'check_app_update') return { available: false };
        if (command === 'check_theme_update') return { available: false };
        if (command === 'load_settings') return structuredClone(fields);
        throw new Error(command);
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForTimeout(950);
    assert.equal(await page.locator('html').getAttribute('data-glass-renderer'), 'reference-liquidglass');
    await page.screenshot({ path: path.join(qa, 'liquid-glass-home.png') });
    await page.locator('#customize').click();
    await page.waitForTimeout(450);
    const geometry = () => page.evaluate(() => [...document.querySelectorAll('.settings-workspace, .settings-sidebar, .settings-card, .settings-header, #settings-form, .category-tab, .setting-row, .submenu, select, .settings-footer, .settings-actions .button')].filter(el => el.checkVisibility()).map(el => {
      const r = el.getBoundingClientRect(); return [el.id || el.className.replace(' optical-glass', ''), r.x, r.y, r.width, r.height];
    }));
    const optical = await geometry();
    const hideMaterial = await page.addStyleTag({ content: '.glass-render-layer { display:none !important }' });
    await page.evaluate(() => { document.querySelector('link[href="liquid-glass.css"]').disabled = true; });
    await page.waitForTimeout(150);
    const original = await geometry();
    assert.equal(optical.length, original.length);
    optical.forEach((row, index) => row.slice(1).forEach((number, coordinate) => assert(Math.abs(number - original[index][coordinate + 1]) < .15, JSON.stringify({ optical: row, original: original[index] }))));
    await page.evaluate(() => { document.querySelector('link[href="liquid-glass.css"]').disabled = false; });
    await hideMaterial.evaluate(el => el.remove());
    await page.waitForTimeout(200);
    assert(await page.locator('.settings-card > .glass-render-layer').evaluate(el => el.width > 500 && el.height > 500));
    await page.screenshot({ path: path.join(qa, 'liquid-glass-settings.png') });
    const slider = page.locator('input[type="range"]:visible').first();
    await slider.focus(); await page.keyboard.press('Home');
    assert.equal(await slider.inputValue(), await slider.getAttribute('min'));
    assert.equal(await slider.evaluate(el => el.parentElement.style.getPropertyValue('--range-progress')), '0%');
    await page.keyboard.press('End');
    assert.equal(await slider.inputValue(), await slider.getAttribute('max'));
    assert.equal(await slider.evaluate(el => el.parentElement.style.getPropertyValue('--range-progress')), '100%');
    const sliderBox = await slider.boundingBox();
    await page.mouse.click(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
    assert.equal(Number(await slider.inputValue()), (Number(await slider.getAttribute('min')) + Number(await slider.getAttribute('max'))) / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBox.x + sliderBox.width * .75, sliderBox.y + sliderBox.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(Number(await slider.inputValue()), Number(await slider.getAttribute('min')) + (Number(await slider.getAttribute('max')) - Number(await slider.getAttribute('min'))) * .75);
    await page.setViewportSize({ width: 600, height: 640 });
    await page.locator('#settings-form').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(qa, 'liquid-glass-scrolled.png') });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator('#settings-form').evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(300);
    const submenu = page.locator('.submenu').first();
    const header = submenu.locator('summary');
    await header.click(); assert.equal(await submenu.getAttribute('open'), null);
    await header.click(); assert.notEqual(await submenu.getAttribute('open'), null);
    await page.getByLabel('Glass Profile', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('select:open')?.style.getPropertyValue('--shader-picker-image').includes('data:image/png'));
    await page.screenshot({ path: path.join(qa, 'liquid-glass-picker.png') });
    await page.keyboard.press('Escape');
    await page.getByLabel('Glass Profile', { exact: true }).selectOption('Liquid Glass');
    assert.equal(await page.getByLabel('Glass Profile', { exact: true }).inputValue(), 'Liquid Glass');
    await page.locator('#back').click(); await page.waitForTimeout(400);
    let idleDraws = -1, stableSamples = 0;
    for (let attempt = 0; attempt < 16 && stableSamples < 3; attempt++) {
      await page.waitForTimeout(250);
      const draws = await page.evaluate(() => window.gpuDraws);
      stableSamples = draws === idleDraws ? stableSamples + 1 : 0;
      idleDraws = draws;
    }
    assert.equal(stableSamples, 3, 'The shader must stop drawing while idle after transitions and texture loads settle');
    // Prove actual pixel refraction independently of tint, rims and shadows.
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      const ctx = canvas.getContext('2d');
      for (let x = 0; x < 1600; x += 8) { ctx.fillStyle = x % 16 ? '#13558c' : '#ffffff'; ctx.fillRect(x, 0, 8, 900); }
      document.querySelector('.wallpaper').style.cssText = `inset:0;background-image:url("${canvas.toDataURL()}");background-size:cover`;
    });
    await page.addStyleTag({ content: `.optics-probe{position:fixed!important;left:200px;top:180px;width:240px;height:140px;padding:0!important;min-height:0!important;background:transparent!important;box-shadow:none!important;border-color:transparent!important;border-radius:70px!important} .optics-probe::after{display:none!important}` });
    await page.locator('#installer-page').evaluate(el => { const probe = document.createElement('div'); probe.className = 'button optics-probe'; el.append(probe); });
    const probe = page.locator('.optics-probe');
    await page.waitForFunction(() => document.querySelector('.optics-probe').classList.contains('shader-glass'));
    await page.waitForTimeout(100);
    const on = await probe.screenshot();
    await probe.evaluate(el => { el.querySelector('.glass-render-layer').style.visibility = 'hidden'; });
    const off = await probe.screenshot();
    const material = await page.evaluate(async images => {
      const pixels = await Promise.all(images.map(async src => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; }));
      let count = 0;
      for (let i = 0; i < pixels[0].length; i += 4) if (Math.abs(pixels[0][i] - pixels[1][i]) > 20) count++;
      const contrast = data => {
        const values = [];
        // The probe's central region excludes its refractive rim and shadows.
        for (let y = 45; y < 95; y++) for (let x = 85; x < 155; x++) values.push(data[(y * 240 + x) * 4]);
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      };
      return { changed: count, contrastRatio: contrast(pixels[1]) / contrast(pixels[0]) };
    }, [off, on].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
    assert(material.changed > 500, `Expected visible refraction of checkerboard; changed pixels: ${material.changed}`);
    assert(material.contrastRatio < .7, `Frost must soften fine background detail in the lens interior: ${material.contrastRatio}`);
    await probe.evaluate(el => el.remove());
    await page.evaluate(() => { window.lossExtension = window.glassContext.getExtension('WEBGL_lose_context'); window.lossExtension.loseContext(); });
    await page.waitForFunction(() => !document.querySelector('.shader-glass'));
    assert(await page.locator('.glass-render-layer').first().evaluate(el => getComputedStyle(el).display === 'none'), 'Fallback must hide the renderer canvases without changing layout');
    await page.evaluate(() => window.lossExtension.restoreContext());
    await page.waitForFunction(() => document.documentElement.dataset.glassRenderer === 'reference-liquidglass');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${material.changed} pixels changed by the frosted GPU lens, interior contrast ratio ${material.contrastRatio.toFixed(2)}, unchanged element geometry, glass picker, submenu interaction, and clear foreground controls.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
