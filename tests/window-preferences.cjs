const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const folder = await fs.mkdtemp(path.join(root, 'target/qa/window-preferences-'));
  let child, browser, page;
  async function launch() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    child = spawn(path.join(root, 'target/release/hotori.exe'), [], { windowsHide: true, env: {
      ...process.env, APPDATA: folder, LOCALAPPDATA: folder,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(folder, 'webview'),
    } });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw Error('Test app exited before launch: '+child.exitCode);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts()[0].pages()[0];
    await page.waitForFunction(() => window.__TAURI__?.window && document.querySelector('#home-status')?.textContent);
  }
  async function dimensions() {
    return page.evaluate(async () => {
      const win = window.__TAURI__.window.getCurrentWindow();
      const size = await win.innerSize(), scale = await win.scaleFactor();
      return { width: size.width / scale, height: size.height / scale, maximized: await win.isMaximized() };
    });
  }
  async function close() {
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Test window did not close')), 10000);
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await exited; await browser.close(); browser = null;
  }
  try {
    await launch();
    // Resize only this disposable test process, without granting the production
    // webview permission to resize arbitrary windows.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      Add-Type 'using System; using System.Runtime.InteropServices; public class HotoriWindowTest { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags); }';
      $testWindow = (Get-Process -Id ${child.pid}).MainWindowHandle;
      if ($testWindow -eq 0) { throw 'Test window unavailable' };
      if (-not [HotoriWindowTest]::SetWindowPos($testWindow, [IntPtr]::Zero, 0, 0, 1180, 740, 6)) { throw 'Test resize failed' }
    `], { windowsHide: true, stdio: 'pipe' });
    await page.waitForFunction(async () => (await window.__TAURI__.window.getCurrentWindow().innerSize()).width < 1500);
    const original = await dimensions();
    assert(!original.maximized);
    assert.equal(await page.locator('#zoom-pill').isVisible(), false, 'Zoom indicator starts hidden');
    const zoomIs = value => page.waitForFunction(value => document.documentElement.dataset.uiZoom === String(value), value);
    await page.keyboard.press('Control+='); await zoomIs(110);
    assert.equal(await page.locator('#zoom-pill').isVisible(), true, 'Zoom reveals the indicator');
    const zoomedWidth = await page.evaluate(() => innerWidth);
    await page.keyboard.press('Control+-'); await zoomIs(100);
    assert(await page.evaluate(() => innerWidth) > zoomedWidth, 'Zoom changes the real WebView scale and available layout width');
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await zoomIs(110);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control'); await zoomIs(100);
    await page.keyboard.press('Control+Shift+='); await zoomIs(110);
    await page.keyboard.press('Control+0'); await zoomIs(100);
    for (let i = 0; i < 15; i++) await page.keyboard.press('Control+=');
    await zoomIs(200);
    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+-');
    await zoomIs(50);
    await page.evaluate(() => document.querySelector('#zoom-pill').click()); await zoomIs(100);
    const pill = await page.locator('#zoom-pill').boundingBox();
    assert(Math.abs(pill.x + pill.width / 2 - await page.evaluate(() => innerWidth) / 2) < 1, 'Zoom pill remains centered at the top');
    assert.equal(await page.locator('#zoom-value').textContent(), '100%');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#zoom-pill')).visibility === 'hidden');
    assert.equal(await page.locator('#zoom-pill').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await page.keyboard.press('Control+0');
    await page.locator('#zoom-pill').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#zoom-value').textContent(), '100%', 'Reset at 100% still reveals the indicator');
    await page.keyboard.press('Control+='); await zoomIs(110);
    await close();
    await launch();
    await zoomIs(110);
    assert.equal(await page.locator('#zoom-pill').isVisible(), false, 'Restoring saved zoom does not reveal the indicator');
    assert.deepEqual(await dimensions(), original, 'Resized dimensions survive a full app restart');
    await page.keyboard.press('Control+0'); await zoomIs(100);
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().toggleMaximize());
    await page.waitForFunction(() => window.__TAURI__.window.getCurrentWindow().isMaximized());
    await close();
    await launch();
    assert((await dimensions()).maximized, 'Maximized windows reopen maximized');
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().toggleMaximize());
    await page.waitForFunction(async () => !(await window.__TAURI__.window.getCurrentWindow().isMaximized()));
    assert.deepEqual(await dimensions(), original, 'Restoring retains the previous normal window dimensions');
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().minimize());
    await page.waitForFunction(() => window.__TAURI__.window.getCurrentWindow().isMinimized());
    await close();
    await launch();
    assert.deepEqual(await dimensions(), original, 'Closing minimized never saves the minimized rectangle');
    await close();
    console.log('PASS: native zoom shortcuts/wheel/reset/limits/restart, centered percentage pill, resize/restart, maximize/restart, restored dimensions, and minimized close/restart.');
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
