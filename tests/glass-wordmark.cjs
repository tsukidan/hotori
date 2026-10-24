const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..'), qa = path.join(root, 'target/qa');
  const server = http.createServer(async (request, response) => {
    try {
      const name = new URL(request.url, 'http://localhost').pathname;
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.jpeg': 'image/jpeg' };
      response.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
      response.end(await fs.readFile(path.join(root, 'web', name)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    await fs.mkdir(qa, { recursive: true });
    for (const dpr of [1, 2]) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/fallback:|shader compile error/.test(message.text())) errors.push(message.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.titlebar-drag').textContent(), '');
      assert.equal(await page.locator('#installer-title').evaluate(el => getComputedStyle(el).fontFamily.includes('Hotori Rounded') && getComputedStyle(el).fontWeight === '900' && document.fonts.check('900 100px "Hotori Rounded"')), true);
      assert(await page.locator('.description').evaluate(el => getComputedStyle(el).fontFamily.includes('Hotori Inter') && !getComputedStyle(el).fontFamily.includes('Hotori Rounded')));
      await page.waitForFunction(() => document.querySelector('.glass-wordmark.shader-glass > canvas')?.width > 0);
      await page.waitForTimeout(750);
      await page.screenshot({ path: path.join(qa, `glass-wordmark-home-${dpr}.png`) });
      const samples = [];
      for (const [name, colors] of [['blue', ['#0843b4', '#46bde8']], ['gold', ['#71421c', '#eeb455']]]) {
        const before = await page.locator('.glass-wordmark canvas').evaluate(canvas => canvas.toDataURL());
        await page.evaluate(colors => {
          const image = document.createElement('canvas'); image.width = 1600; image.height = 900;
          const context = image.getContext('2d');
          const gradient = context.createLinearGradient(0, 0, 1200, 900);
          gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
          context.fillStyle = gradient; context.fillRect(0, 0, 1600, 900);
          for (let x = 0; x < 1600; x += 30) {
            context.fillStyle = x % 60 ? '#ffffff24' : '#00000018'; context.fillRect(x, 0, 15, 900);
          }
          document.querySelector('.wallpaper').style.backgroundImage = `url("${image.toDataURL()}")`;
        }, colors);
        await page.waitForFunction(before => document.querySelector('.glass-wordmark canvas').toDataURL() !== before, before);
        await page.waitForTimeout(150);
        const sample = await page.locator('.glass-wordmark canvas').evaluate(canvas => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0, red = 0, blue = 0, transparent = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 240) { count++; red += data[i]; blue += data[i + 2]; }
            if (data[i + 3] < 5) transparent++;
          }
          return { count, red: red / count, blue: blue / count, transparent: transparent / (data.length / 4) };
        });
        assert(sample.count > 5000 * dpr * dpr, JSON.stringify(sample));
        assert(sample.transparent > .45, 'Letter counters and surrounding space must remain transparent');
        samples.push(sample);
        await page.screenshot({ path: path.join(qa, `glass-wordmark-${name}-${dpr}.png`) });
      }
      assert(samples[0].blue > samples[0].red + 20, JSON.stringify(samples));
      assert(samples[1].red > samples[1].blue + 20, JSON.stringify(samples));
      // Compare the same glyph material with/without the actual blur passes.
      // Coating, normals, refraction and highlights stay identical in both.
      await page.evaluate(() => {
        const upload = HotoriLiquidGlass.GlassRenderer.prototype.uploadAndBlur;
        HotoriLiquidGlass.GlassRenderer.prototype.uploadAndBlur = function(...args) {
          const glyph = document.querySelector('.glass-wordmark canvas');
          if (window.wordmarkTestSharp && args[3] === glyph?.width && args[4] === glyph?.height) args[5] = 0;
          return upload.apply(this, args);
        };
        const render = HotoriGlassWordmark.prototype.render;
        HotoriGlassWordmark.prototype.render = function(...args) {
          this.refraction = window.wordmarkTestNoRefraction ? 0 : .69;
          return render.apply(this, args);
        };
        const image = document.createElement('canvas'); image.width = 1600; image.height = 900;
        const context = image.getContext('2d');
        for (let x = 0; x < image.width; x += 2) {
          context.fillStyle = x % 4 ? '#ddd' : '#222'; context.fillRect(x, 0, 2, image.height);
        }
        document.querySelector('.wallpaper').style.cssText = `inset:0;background-image:url("${image.toDataURL()}")`;
      });
      await page.waitForTimeout(250);
      const frost = await page.locator('.glass-wordmark canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data));
      await page.evaluate(() => { window.wordmarkTestSharp = true; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
      await page.waitForTimeout(200);
      const contrastFor = frost => page.locator('.glass-wordmark canvas').evaluate((canvas, { frost, dpr }) => {
        const sharp = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const a = [], b = [], radius = Math.ceil(5 * dpr);
        for (let y = radius; y < canvas.height - radius; y++) for (let x = radius; x < canvas.width - radius; x++) {
          if ([[0,0],[-radius,0],[radius,0],[0,-radius],[0,radius]].every(([dx,dy]) => frost[((y+dy)*canvas.width+x+dx)*4+3] > 250)) {
            const i = (y * canvas.width + x) * 4; a.push(frost[i]); b.push(sharp[i]);
          }
        }
        const deviation = values => { const mean = values.reduce((sum,v)=>sum+v,0)/values.length; return Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length); };
        return { count: a.length, ratio: deviation(a) / deviation(b) };
      }, { frost, dpr });
      const contrast = await contrastFor(frost);
      assert(contrast.count > 100, JSON.stringify(contrast));
      assert(contrast.ratio < .5, `The glyph interior must blur the wallpaper, independently of tint: ${JSON.stringify(contrast)}`);
      await page.evaluate(() => { window.wordmarkTestSharp = false; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
      console.log(`Wordmark frost contrast ratio at DPR ${dpr}: ${contrast.ratio.toFixed(2)}`);
      // Coarser scene detail must remain visible rather than being flattened
      // into the uniform matte appearance of the earlier heavy frost.
      await page.evaluate(() => {
        window.wordmarkTestSharp = false;
        const image = document.createElement('canvas'); image.width = 1600; image.height = 900;
        const context = image.getContext('2d');
        for (let x = 0; x < image.width; x += 8) {
          context.fillStyle = x % 16 ? '#ddd' : '#222'; context.fillRect(x, 0, 8, image.height);
        }
        document.querySelector('.wallpaper').style.backgroundImage = `url("${image.toDataURL()}")`;
      });
      await page.waitForTimeout(250);
      const refracted = await page.locator('.glass-wordmark canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data));
      await page.screenshot({ path: path.join(qa, `glass-wordmark-refraction-${dpr}.png`) });
      await page.evaluate(() => { window.wordmarkTestSharp = true; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
      await page.waitForTimeout(180);
      const sceneDetail = await contrastFor(refracted);
      assert(sceneDetail.ratio > .35, `Keep scene detail visible through the liquid glass: ${JSON.stringify(sceneDetail)}`);
      await page.evaluate(() => { window.wordmarkTestSharp = false; window.wordmarkTestNoRefraction = true; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
      await page.waitForTimeout(180);
      const bentPixels = await page.locator('.glass-wordmark canvas').evaluate((canvas, refracted) => {
        const straight = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let i = 0; i < straight.length; i += 4) if (straight[i+3] > 250 && Math.abs(straight[i]-refracted[i]) > 20) changed++;
        return changed;
      }, refracted);
      assert(bentPixels > 300 * dpr * dpr, `The shaped lens must bend backdrop detail: ${bentPixels}`);
      await page.evaluate(() => { window.wordmarkTestNoRefraction = false; document.dispatchEvent(new Event('hotori:glass-invalidate')); });
      console.log(`Liquid glass detail ratio ${sceneDetail.ratio.toFixed(2)}, ${bentPixels} pixels affected by refraction at DPR ${dpr}.`);
      await page.setViewportSize({ width: 560, height: 560 });
      await page.waitForTimeout(250);
      const bounds = await page.locator('#installer-title').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 560);
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      await page.waitForFunction(() => !document.querySelector('.glass-wordmark').classList.contains('shader-glass'));
      assert.equal(await page.locator('.wordmark-fallback').evaluate(el => getComputedStyle(el).visibility), 'visible');
      assert.equal(await page.getByRole('heading', { name: 'Hotori', exact: true }).count(), 1);
      await page.close();
      console.log(`PASS: glyph transparency, live background tint, highlights, responsive placement and readable fallback at DPR ${dpr}.`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
