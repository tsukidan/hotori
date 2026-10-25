// Real WebView2 startup against disposable theme data; Discord is untouched.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(root, 'target/qa/wallpaper-startup-'));
  const folder = path.join(profile, 'Vencord/themes');
  await fs.mkdir(folder, { recursive: true });
  const image = await fs.readFile(path.join(root, 'icons/icon.png'));
  let releaseImage, requests = 0;
  const server = http.createServer(async (_, response) => {
    requests++;
    await new Promise(resolve => { releaseImage = resolve; });
    response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(image);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const uri = `http://127.0.0.1:${server.address().port}/saved.png`;
  const theme = (await fs.readFile(path.join(root, 'assets/hotori.theme.css'), 'utf8'))
    .replace(/--main-bg:[^;]+;/, `--main-bg: url('${uri}');`);
  await fs.writeFile(path.join(folder, 'hotori.theme.css'), theme);
  async function launch(first) {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const child = spawn(path.join(root, 'target/release/hotori.exe'), [], {
      windowsHide: true, env: { ...process.env, APPDATA: profile,
        WEBVIEW2_USER_DATA_FOLDER: path.join(profile, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
    });
    let browser;
    try {
      for (let i = 0; i < 100; i++) {
        try { await fetch(`http://127.0.0.1:${port}/json/version`); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts()[0].pages()[0];
      await page.waitForFunction(() => window.__TAURI__?.window);
      if (first) {
        for (let i = 0; i < 100 && !releaseImage; i++) await page.waitForTimeout(50);
        assert(releaseImage, 'The first launch requests the saved image');
        assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isVisible()), false,
          'The window must stay hidden while the saved wallpaper is loading');
        assert(!await page.locator('.wallpaper').evaluate(el => getComputedStyle(el).backgroundImage.includes('assets/background.jpeg')),
          'Startup CSS must not expose the bundled wallpaper while the saved image is pending');
        releaseImage();
      }
      await page.waitForFunction(async () => await window.__TAURI__.window.getCurrentWindow().isVisible());
      assert(await page.locator('.wallpaper').evaluate(el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return el.style.getPropertyValue('--app-wallpaper').startsWith('url("blob:') &&
          style.backgroundPosition.startsWith('50% 50%') && style.transform === 'none' &&
          rect.width === innerWidth && rect.height === innerHeight;
      }), 'The first visible window must already use the saved, centered background');
      await page.waitForFunction(() => document.documentElement.dataset.glassRenderer === 'reference-liquidglass');
      const installedVersion = theme.match(/@version\s+([^\s]+)/)[1];
      const changelog = JSON.parse(await fs.readFile(path.join(root, 'assets/theme-changelog.json'), 'utf8'));
      await page.waitForFunction(() => document.querySelector('#theme-changelog-items strong'));
      assert((await page.locator('#theme-changelog-items').textContent()).includes(changelog.versions[installedVersion][0].title), 'Native app finds notes for its actual installed theme');
    } finally {
      if (browser) await browser.close();
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
  }
  try {
    await launch(true);
    assert.equal(requests, 1);
    await new Promise(resolve => server.close(resolve));
    await launch(false);
    assert.equal(requests, 1, 'Relaunch reuses the persisted image with the server offline');
    console.log('PASS: native window stays hidden until saved wallpaper is ready; centered viewport cover and GPU glass; offline relaunch uses disk cache.');
  } finally {
    releaseImage?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
