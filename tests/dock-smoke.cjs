// Frontend interaction checks with disposable native responses; no user files change.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const qa = path.resolve(__dirname, '../target/qa');
  await fs.mkdir(qa, { recursive: true });
  try {
    await page.addInitScript(() => {
      let installed = false;
      window.testCommands = [];
      window.__TAURI__ = { core: { invoke: async command => {
        window.testCommands.push(command);
        switch (command) {
          case 'get_status': return { ready: true, installed, theme_version: installed ? '0.8.0' : null };
          case 'install_theme': installed = true; return;
          case 'uninstall_theme': installed = false; return;
          case 'update_theme': return { changed: true, version: '1.2.0' };
          case 'load_settings': return [];
          case 'open_theme_folder': return true;
          case 'check_app_update': return { available: true, currentVersion: document.querySelector('.version').textContent.slice(1), version: '9.0.0' };
          case 'check_theme_update': return { available: false, installedVersion: '0.8.0', version: '0.8.0' };
          default: throw new Error(`Unexpected command: ${command}`);
        }
      } } };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
    await page.waitForTimeout(850);
    assert.equal(await page.evaluate(() => window.testCommands.filter(command => command === 'check_app_update').length), 1, 'Checks for an app update on startup');
    assert(await page.locator('#app-update-bubble').isVisible());
    const dock = page.locator('#command-dock');
    assert.equal(await dock.locator('button').count(), 5);
    assert.equal(await page.locator('#update-theme').count(), 0);
    assert.equal(await dock.locator('.dock-group').count(), 3);
    const resting = await dock.boundingBox();
    assert.equal(Math.round(resting.width), 76);
    const bg = await page.locator('.wallpaper').evaluate(el => getComputedStyle(el).backgroundImage);
    await page.screenshot({ path: path.join(qa, 'dock-home.png') });
    await page.locator('#install').hover();
    await page.waitForTimeout(650);
    const expanded = await dock.boundingBox();
    assert.equal(Math.round(expanded.width), 244);
    assert.equal(Math.round((await page.locator('.dock-main').boundingBox()).width), 244);
    assert.equal(Math.round((await page.locator('#app-update-bubble').boundingBox()).width), 244);
    assert(Math.abs(expanded.x + expanded.width - resting.x - resting.width) < 1, 'Right edge must stay anchored');
    const scale = id => page.locator(`#${id}`).evaluate(el => Number(getComputedStyle(el.closest('.dock-item')).getPropertyValue('--dock-scale')));
    assert(await scale('install') > 1.35);
    assert(await scale('install') > await scale('folder'));
    await page.screenshot({ path: path.join(qa, 'dock-expanded.png') });
    await page.locator('#folder').hover();
    await page.waitForTimeout(450);
    assert(await scale('folder') > 1.35);
    assert(await scale('folder') > await scale('install'));
    await page.mouse.move(20, 100);
    await page.waitForTimeout(650);
    assert.equal(Math.round((await dock.boundingBox()).width), 76);
    await page.locator('#update-app').hover();
    await page.waitForTimeout(650);
    assert.equal(Math.round((await page.locator('.dock-main').boundingBox()).width), 244, 'Update bubble hover opens the main dock too');
    const gap = await page.locator('.dock-main').boundingBox();
    await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height + 6);
    await page.waitForTimeout(550);
    assert.equal(Math.round((await dock.boundingBox()).width), 244, 'Crossing between bubbles keeps both open');
    await page.locator('#install').focus();
    await page.waitForTimeout(650);
    assert.equal(Math.round((await dock.boundingBox()).width), 244, 'Keyboard focus expands labels');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#customize').disabled);
    assert.equal(await page.locator('#theme-version-value').textContent(), 'v0.8.0');
    await page.locator('#folder').click();
    await page.locator('#update-app').click();
    await page.locator('#app-update-dialog').waitFor({ state: 'visible' });
    await page.locator('#app-update-cancel').click();
    await page.locator('#customize').click();
    await page.waitForFunction(() => document.querySelector('#app').dataset.page === 'settings');
    await page.locator('#back').click();
    await page.waitForTimeout(400);
    await page.locator('#uninstall').click();
    await page.waitForFunction(() => !document.querySelector('#install').disabled);
    for (const [width, height] of [[1600, 900], [1120, 780], [800, 600], [560, 560]]) {
      await page.locator('#install').evaluate(el => el.blur());
      await page.mouse.move(5, 55);
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(650);
      const bounds = await page.evaluate(() => {
        const selectors = ['.home-brand', '.installer-card', '#command-dock'];
        return selectors.map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        });
      });
      for (const rect of bounds) assert(rect.x >= 0 && rect.y >= 52 && rect.right <= width && rect.bottom <= height, JSON.stringify({ width, height, rect }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.wallpaper').evaluate(el => getComputedStyle(el).backgroundImage), bg);
      await page.screenshot({ path: path.join(qa, `dock-home-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#install').hover();
    assert.equal(await page.locator('#install .dock-symbol').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await page.locator('.home-brand').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.deepEqual(errors, []);
    const commands = await page.evaluate(() => window.testCommands);
    for (const command of ['install_theme', 'uninstall_theme', 'load_settings', 'open_theme_folder', 'check_app_update']) assert(commands.includes(command), command);
    for (const outcome of ['current', 'offline']) {
      const startup = await browser.newPage();
      await startup.addInitScript(outcome => {
        window.startupChecks = 0;
        window.__TAURI__ = { core: { invoke: async command => {
          if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.8.0' };
          if (command === 'check_app_update') {
            window.startupChecks++;
            await new Promise(resolve => setTimeout(resolve, 150));
            if (outcome === 'offline') throw new Error('Offline');
            return { available: false, currentVersion: document.querySelector('.version').textContent.slice(1) };
          }
          if (command === 'check_theme_update') return { available: false, installedVersion: '0.8.0', version: '0.8.0' };
          throw new Error(command);
        } } };
      }, outcome);
      await startup.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
      assert.equal(await startup.locator('#app-update-bubble').isVisible(), false, 'No update bubble while checking');
      await startup.waitForFunction(() => window.startupChecks === 1 && !checkingApp);
      assert.equal(await startup.locator('#app-update-bubble').isVisible(), false, outcome);
      assert((await startup.locator('#home-status').textContent()).includes('Hotori is installed'));
      assert.equal(await startup.locator('#home-status .status-heading').textContent(), 'Hotori is installed.');
      assert.equal(await startup.locator('#home-status .status-detail').textContent(), 'Make it yours in Customize.');
      if (outcome === 'current') {
        await startup.waitForTimeout(850);
        await startup.screenshot({ path: path.join(qa, 'installed-status.png') });
      }
      assert((await startup.locator('#home-status').evaluate(el => getComputedStyle(el).backdropFilter)).includes('blur(2px)'));
      await startup.close();
    }
    console.log('PASS: startup update availability/current/offline, synchronized bubbles, status glass, magnification, keyboard, reduced motion, five dock actions, and 560–1600px layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
