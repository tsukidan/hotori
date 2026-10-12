// Run with Node and Playwright available (NODE_PATH may point to the bundled runtime).
// This launches the real release app against a disposable APPDATA folder.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const qa = path.join(root, 'target', 'qa');
const theme = `/**
 * @name Hotori DEV
 * @author tsuki
 */
:root {
--blur-profile: var(--blur-acrylic);
--glass-background: var(--glass-dark);
--main-bg: url('https://example.com/wallpaper.jpg');
--settings-bg: url('https://example.com/settings.jpg');
--bg-overlay-top: rgba(12, 16, 24, 0.24);
--bg-overlay-bottom: rgba(0, 0, 0, 0.5);
--settings-bg-overlay-top: rgba(0, 0, 0, 0.5);
--settings-bg-overlay-bottom: rgba(0, 0, 0, 0.8);
--glass-dark: rgba(12, 16, 24, 0.24);
--glass-light: rgba(255, 255, 255, 0.1);
--main-color: #ec5757;
--text-normal: #ffffff !important;
--text-muted: #ffffff !important;
--interactive-normal: #ffffff !important;
--interactive-hover: #ffffff !important;
--interactive-active: #ffffff !important;
--channels-default: #ffffff !important;
--header-primary: #ffffff !important;
--header-secondary: #ffffff !important;
--icon-primary: #ffffff !important;
--secondary-ui-color: #ffffff;
--blur-val: 24px;
--liquid-blur-val: 2.5px;
--liquid-saturation: 220%;
--chat-input-gap: 12px;
--message-avatar-size: 40px;
--avatar-radius: 30%;
--mention-glass-tint: rgba(255, 205, 64, 0.14);
--mention-glass-hover: rgba(255, 205, 64, 0.22);
--mention-glass-accent: #ffd45c;
--server-list-layout: var(--vertical);
--server-list-top-padding: 12px;
--server-list-horizontal-height: 80px;
}
/* END OF USER SETTINGS */
.implementation { color: red; }
`;

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitForDebug(port, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Installer exited: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('WebView2 debugging endpoint did not start');
}

function sampleFrames(page, duration = 800) {
  return page.evaluate(duration => new Promise(resolve => {
    const intervals = [];
    let previous;
    const start = performance.now();
    function frame(now) {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - start < duration) requestAnimationFrame(frame);
      else {
        intervals.sort((a, b) => a - b);
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        resolve({ frames: intervals.length, meanMs: mean, p95Ms: intervals[Math.floor(intervals.length * .95)], maxMs: Math.max(...intervals) });
      }
    }
    requestAnimationFrame(frame);
  }), duration);
}

(async () => {
  await fs.mkdir(qa, { recursive: true });
  // Isolated frontend check: stub only native responses so no real browser/folder opens.
  const previewBrowser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const preview = await previewBrowser.newPage();
    await preview.addInitScript(() => {
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === 'get_status') return { ready: !!window.previewReady || !!window.previewInstalled, installed: !!window.previewInstalled };
        if (command === 'update_theme') {
          await new Promise(resolve => setTimeout(resolve, 150));
          if (window.previewUpdateState === 'error') throw new Error('The published theme is unavailable.');
          return { changed: window.previewUpdateState !== 'unchanged', version: '0.8.0' };
        }
        if (command === 'check_app_update') {
          if (window.previewAppUpdate === 'error') throw new Error('Could not reach GitHub.');
          const currentVersion = document.querySelector('.version').textContent.slice(1);
          return { available: window.previewAppUpdate === 'available', currentVersion, version: '2.0.0' };
        }
        if (command === 'install_app_update') {
          await new Promise(resolve => setTimeout(resolve, 150));
          throw new Error('The downloaded app failed verification. Hotori has not been changed.');
        }
        if (command === 'open_theme_folder') return false;
        throw new Error(`Unexpected preview command: ${command}`);
      } } };
    });
    await preview.goto(require('node:url').pathToFileURL(path.join(root, 'web', 'index.html')).href);
    await preview.locator('.vencord-notice').waitFor({ state: 'visible' });
    await preview.locator('#folder').click();
    await preview.locator('#vencord-dialog').waitFor({ state: 'visible' });
    assert.equal(await preview.locator('#vencord-dialog-message').textContent(), 'You need Vencord to use this theme. Please install it and try again.');
    await preview.screenshot({ path: path.join(qa, 'vencord-required.png') });
    await preview.locator('#vencord-dialog button').click();
    assert.equal(await preview.locator('#vencord-dialog').isVisible(), false);
    assert(await preview.locator('#update-theme').isDisabled());
    await preview.evaluate(() => { window.previewReady = true; window.dispatchEvent(new Event('focus')); });
    await preview.waitForFunction(() => !document.querySelector('#install').disabled);
    assert.equal(await preview.locator('.vencord-notice').isVisible(), false, 'Vencord without Hotori must hide the requirement message');
    await preview.evaluate(() => { window.previewReady = false; window.dispatchEvent(new Event('focus')); });
    await preview.locator('.vencord-notice').waitFor({ state: 'visible' });
    await preview.evaluate(() => { window.previewInstalled = true; window.dispatchEvent(new Event('focus')); });
    await preview.waitForFunction(() => !document.querySelector('#update-theme').disabled);
    await preview.locator('#update-theme').click();
    assert(await preview.locator('#customize').isDisabled());
    await preview.waitForFunction(() => document.querySelector('#home-status').textContent.includes('updated to v0.8.0'));
    await preview.evaluate(() => window.previewUpdateState = 'unchanged');
    await preview.locator('#update-theme').click();
    await preview.waitForFunction(() => document.querySelector('#home-status').textContent.includes('already up to date'));
    await preview.evaluate(() => window.previewUpdateState = 'error');
    await preview.locator('#update-theme').click();
    await preview.waitForFunction(() => document.querySelector('#home-status').dataset.error === 'true');
    assert((await preview.locator('#home-status').textContent()).includes('published theme is unavailable'));
    assert.equal(await preview.locator('#app').getAttribute('data-page'), 'installer');
    await preview.locator('#update-app').click();
    await preview.waitForFunction(() => document.querySelector('#home-status').textContent.includes('up to date'));
    await preview.evaluate(() => window.previewAppUpdate = 'error');
    await preview.locator('#update-app').click();
    await preview.waitForFunction(() => document.querySelector('#home-status').dataset.error === 'true');
    await preview.evaluate(() => window.previewAppUpdate = 'available');
    await preview.locator('#update-app').click();
    await preview.locator('#app-update-dialog').waitFor({ state: 'visible' });
    assert((await preview.locator('#app-update-description').textContent()).includes('2.0.0'));
    await preview.locator('#app-update-cancel').click();
    assert.equal(await preview.locator('#app-update-dialog').isVisible(), false);
    await preview.locator('#update-app').click();
    await preview.locator('#app-update-install').click();
    assert(await preview.locator('#app-update-cancel').isDisabled());
    await preview.waitForFunction(() => document.querySelector('#app-update-status').dataset.error === 'true');
    assert((await preview.locator('#app-update-status').textContent()).includes('failed verification'));
    assert.equal(await preview.locator('#app-update-cancel').isDisabled(), false);
    await preview.locator('#app-update-cancel').click();

  } finally { await previewBrowser.close(); }
  const appdata = await fs.mkdtemp(path.join(qa, 'appdata-'));
  const folder = path.join(appdata, 'Vencord', 'themes');
  await fs.mkdir(folder, { recursive: true });
  const source = path.join(folder, 'devhotori.theme.css');
  const destination = path.join(folder, 'hotori.theme.css');
  const bundledTheme = await fs.readFile(path.join(root, 'assets', 'hotori.theme.css'), 'utf8');
  const port = await freePort();
  const child = spawn(process.env.HOTORI_TEST_EXE || path.join(root, 'target', 'release', 'hotori.exe'), [], {
    cwd: root, windowsHide: true,
    env: { ...process.env, APPDATA: appdata,
      WEBVIEW2_USER_DATA_FOLDER: path.join(appdata, 'webview-profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` }
  });
  let browser;
  try {
    await waitForDebug(port, child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    let page;
    for (let attempt = 0; attempt < 80; attempt++) {
      page = context.pages().find(p => p.url().includes('tauri.localhost'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(page, 'Native Tauri page should be open');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const saveCategory = async category => {
      const button = page.getByRole('button', { name: `Save ${category}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      await button.evaluate(el => el.addEventListener('pointerdown', () => { window.saveScrollBefore = document.querySelector('#settings-form').scrollTop; }, { once: true }));
      await button.click();
      const scrollBefore = await page.evaluate(() => window.saveScrollBefore);
      await page.waitForFunction(category => document.querySelector(`[data-category="${category}"]`).dataset.state === 'saved', category);
      assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings', 'Category save must keep the editor open');
      assert.equal(await page.locator('#settings-form').evaluate(el => el.scrollTop), scrollBefore, 'Category save must preserve scrolling');
      assert(await button.isDisabled());
    };
    const saveAndBack = async () => {
      while (await page.locator('.category-save:not(:disabled)').count()) {
        const category = await page.locator('.category-save:not(:disabled)').first().getAttribute('data-category');
        await saveCategory(category);
      }
      assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings');
      await page.locator('#back').click();
      await page.waitForFunction(() => document.querySelector('#app').dataset.page === 'installer');
    };
    await page.waitForFunction(() => !document.getElementById('install').disabled);
    const geometry = () => page.evaluate(() => {
      const glass = document.querySelector(document.querySelector('#app').dataset.page === 'settings' ? '.settings-card' : '.home-content').getBoundingClientRect();
      const bg = document.querySelector('.wallpaper');
      return { centered: Math.abs(glass.x + glass.width / 2 - innerWidth / 2) < 2,
        backgroundCount: document.querySelectorAll('.wallpaper').length,
        cover: getComputedStyle(bg).backgroundSize.split(',').every(size => size.trim() === 'cover'),
        bgTransform: getComputedStyle(bg).transform,
        overflow: document.documentElement.scrollWidth > innerWidth,
        blur: getComputedStyle(document.querySelector('.glass')).backdropFilter };
    });
    await page.waitForTimeout(950); // One-time launch animation must finish before geometry checks.
    if (process.env.HOTORI_TEST_APP_UPDATE === '1') {
      await page.locator('#update-app').click();
      await page.waitForFunction(() => !document.querySelector('#update-app').disabled, null, { timeout: 40000 });
      assert((await page.locator('#home-status').textContent()).includes('up to date'));
      console.log('PASS: native app checks the public GitHub release and rejects downgrades.');
    }

    assert.equal(await page.title(), 'Hotori');
    const appVersion = JSON.parse(await fs.readFile(path.join(root, 'tauri.conf.json'), 'utf8')).version;
    assert.equal(await page.locator('.version').textContent(), `v${appVersion}`);
    assert.equal(await page.locator('.version').getAttribute('aria-label'), `Version ${appVersion}`);
    assert.equal(await page.locator('.version').evaluate(el => getComputedStyle(el).opacity), '0.6');
    assert.equal(await page.locator('.tagline').evaluate(el => getComputedStyle(el).fontStyle), 'italic');
    assert.equal(await page.locator('.installer-card .vencord-notice').count(), 0);
    assert.equal(await page.locator('.vencord-notice').isVisible(), false);
    assert.equal(await page.locator('.action-group').count(), 2);
    assert(await page.locator('#installation-heading').isVisible());
    assert(await page.locator('#customization-heading').isVisible());
    assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isDecorated()), false);
    assert.equal(await page.locator('.titlebar-drag[data-tauri-drag-region]').count(), 1);
    assert.equal(await page.locator('.window-button').count(), 3);
    assert.equal(await page.locator('.titlebar img').count(), 0);
    assert.equal(await page.locator('.window-controls').evaluate(el => getComputedStyle(el).borderRadius), '16px');
    assert.equal(await page.locator('.vencord-notice').evaluate(el => getComputedStyle(el).color), 'rgb(207, 133, 137)');
    assert.equal(await page.locator('.vencord-notice').evaluate(el => getComputedStyle(el).webkitTextStrokeColor), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('.installer-card').evaluate(el => getComputedStyle(el).animationIterationCount), '1');
    const hoverSession = await context.newCDPSession(page);
    await hoverSession.send('DOM.enable');
    await hoverSession.send('CSS.enable');
    const { root: hoverRoot } = await hoverSession.send('DOM.getDocument');
    const { nodeId: hoverNode } = await hoverSession.send('DOM.querySelector', { nodeId: hoverRoot.nodeId, selector: '#install' });
    await hoverSession.send('CSS.forcePseudoState', { nodeId: hoverNode, forcedPseudoClasses: ['hover'] });
    await page.waitForTimeout(400);
    const hoverTransform = await page.locator('#install').evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#install').evaluate(el => getComputedStyle(el).transform), hoverTransform, 'Hover scale stays enlarged until the pointer leaves');
    assert.notEqual(hoverTransform, 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.installer-card').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.locator('#install').evaluate(el => getComputedStyle(el).transform), 'none');
    await hoverSession.send('CSS.forcePseudoState', { nodeId: hoverNode, forcedPseudoClasses: [] });
    await hoverSession.detach();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(950);
    assert(await page.locator('.window-controls').evaluate(el => getComputedStyle(el).backdropFilter.includes('blur(24px)')));
    assert.equal(await page.locator('.titlebar').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await page.locator('.titlebar').evaluate(el => el.getAnimations().length), 0, 'Finished arrival must release its backdrop root');
    // Pixel verification: stripes behind the controls must visibly soften with blur enabled.
    const backdropProbe = await page.addStyleTag({ content: '.wallpaper { background-image: repeating-linear-gradient(90deg, #fff 0px, #fff 3px, #000 3px, #000 6px) !important; }' });
    const blurredControls = await page.locator('.window-controls').screenshot();
    const noBlur = await page.addStyleTag({ content: '.window-controls { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
    const sharpControls = await page.locator('.window-controls').screenshot();
    assert(!blurredControls.equals(sharpControls), 'Glass must sample and blur actual pixels behind the titlebar');
    await noBlur.evaluate(el => el.remove());
    await backdropProbe.evaluate(el => el.remove());
    const titlebarBounds = await page.locator('.titlebar').boundingBox();
    const appBounds = await page.locator('#app').boundingBox();
    assert(appBounds.y >= titlebarBounds.y + titlebarBounds.height, 'Content must clear the title bar');
    await page.locator('#window-maximize').click();
    await page.waitForFunction(() => document.getElementById('window-maximize').getAttribute('aria-label') === 'Restore');
    assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isMaximized()), true);
    await page.locator('#window-maximize').click();
    await page.waitForFunction(() => document.getElementById('window-maximize').getAttribute('aria-label') === 'Maximize');
    assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isMaximized()), false);
    await page.locator('.titlebar-drag').dblclick();
    await page.waitForFunction(() => document.getElementById('window-maximize').getAttribute('aria-label') === 'Restore');
    await page.locator('.titlebar-drag').dblclick();
    await page.waitForFunction(() => document.getElementById('window-maximize').getAttribute('aria-label') === 'Maximize');
    await page.locator('#window-maximize').hover();
    await page.screenshot({ path: path.join(qa, 'hotori-titlebar.png') });
    await page.locator('.titlebar-drag').hover();
    await page.screenshot({ path: path.join(qa, 'tauri-home.png') });
    await page.locator('#install').click();
    await page.waitForFunction(() => !document.getElementById('customize').disabled);
    assert.equal(await fs.readFile(destination, 'utf8'), bundledTheme);
    await assert.rejects(fs.access(source));
    if (process.env.HOTORI_TEST_REMOTE_UPDATE === '1') {
      await page.locator('#update-theme').click();
      await page.waitForFunction(() => !document.querySelector('#update-theme').disabled, null, { timeout: 40000 });
      assert.equal(await page.locator('#home-status').getAttribute('data-error'), 'true', 'Unpublished repository should report an update error');
      assert.equal(await fs.readFile(destination, 'utf8'), bundledTheme, 'A failed download must leave the installed theme untouched');
      console.log('PASS: live GitHub updater reports unavailable source without changing the installed theme.');
    }

    // A downloaded source cached by the updater becomes Customize/Reset's defaults.
    const publishedDefaults = bundledTheme.replace(/@version [^\r\n]+/, '@version 999.0.0').replace('--blur-val: 24px;', '--blur-val: 30px;');
    const cacheFolder = path.join(folder, 'hotori-assets');
    await fs.mkdir(cacheFolder, { recursive: true });
    await fs.writeFile(path.join(cacheFolder, 'theme-defaults.css'), publishedDefaults);
    await fs.writeFile(destination, publishedDefaults.replace('--blur-val: 30px;', '--blur-val: 33px;').replace('--main-color: #5865f2;', '--main-color: #112233;'));
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).getAttribute('aria-valuetext'), '110%');
    await page.locator('#reset-defaults').click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('reset and saved'));
    assert((await fs.readFile(destination, 'utf8')).includes('--blur-val: 30px;'));
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).getAttribute('aria-valuetext'), '100%');
    assert.equal(await page.getByLabel('Accent Color', { exact: true }).inputValue(), '#5865f2');
    await page.locator('#back').click();
    await page.waitForTimeout(380);
    await fs.writeFile(destination, bundledTheme);
    await fs.unlink(path.join(cacheFolder, 'theme-defaults.css'));
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    assert.equal(await page.getByLabel('Main Background', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Settings Background', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.category-save').count(), 6);
    assert.equal(await page.locator('.category-save:not(:disabled)').count(), 0);
    assert.equal(await page.locator('.settings-header #back').count(), 0);
    assert.equal(await page.locator('.settings-footer #back').count(), 1);
    await page.getByLabel('Main Background', { exact: true }).fill('https://example.com/test.jpg');
    await page.getByLabel('Main Background', { exact: true }).fill('');
    await saveAndBack();
    assert.equal(await fs.readFile(destination, 'utf8'), bundledTheme);
    // Local files are copied, work after the original is deleted, and reopen with previews.
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    const imageBytes = await fs.readFile(path.join(root, 'icons', 'icon.png'));
    const originalImage = path.join(appdata, 'picked-image.png');
    await fs.writeFile(originalImage, imageBytes);
    for (const name of ['--main-bg', '--settings-bg']) {
      const row = page.locator(`[data-name="${name}"]`);
      await row.locator('input[type="file"]').setInputFiles(originalImage);
      await page.waitForFunction(name => {
        const row = document.querySelector(`[data-name="${name}"]`);
        return row.querySelector('input[type="text"]').readOnly && !document.getElementById('back').disabled;
      }, name);
      await row.locator('.wallpaper-preview').waitFor({ state: 'visible' });
      assert((await row.locator('.wallpaper-notice').textContent()).includes('won’t be uploaded'));
    }
    await fs.unlink(originalImage);
    await saveAndBack();
    const localTheme = await fs.readFile(destination, 'utf8');
    assert(/--main-bg: url\('vencord:\/\/\/themes\/hotori-assets\/[a-f0-9]{16}\.png'\);/.test(localTheme));
    assert(/--settings-bg: url\('vencord:\/\/\/themes\/hotori-assets\/[a-f0-9]{16}\.png'\);/.test(localTheme));
    const managedAssets = await fs.readdir(path.join(folder, 'hotori-assets'));
    assert.equal(managedAssets.length, 1, 'Identical images should share one managed copy');
    assert.deepEqual(await fs.readFile(path.join(folder, 'hotori-assets', managedAssets[0])), imageBytes);
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    for (const name of ['--main-bg', '--settings-bg']) await page.locator(`[data-name="${name}"] .wallpaper-preview`).waitFor({ state: 'visible' });
    const mainWallpaper = page.locator('[data-name="--main-bg"]');
    await page.route('https://example.com/hotori-preview.png', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
    await mainWallpaper.getByRole('button', { name: 'Use image link', exact: true }).click();
    assert((await mainWallpaper.locator('.wallpaper-notice').textContent()).includes('contacts that website'));
    await page.getByLabel('Main Background', { exact: true }).fill('https://example.com/hotori-preview.png');
    await page.getByLabel('Main Background', { exact: true }).press('Tab');
    await mainWallpaper.locator('.wallpaper-preview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').evaluate(el => el.scrollTop), 0, 'Hidden file picker must not scroll the whole app');
    await mainWallpaper.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(qa, 'hotori-wallpapers.png') });
    await saveAndBack();
    assert((await fs.readFile(destination, 'utf8')).includes("--main-bg: url('https://example.com/hotori-preview.png');"));
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    for (const name of ['--main-bg', '--settings-bg']) await page.locator(`[data-name="${name}"]`).getByRole('button', { name: 'Clear background', exact: true }).click();
    await saveAndBack();
    assert.equal(await fs.readFile(destination, 'utf8'), bundledTheme);
    // A separate fixture exercises customizations and preservation of user-authored CSS.
    await fs.writeFile(source, theme);
    await fs.writeFile(destination, theme);
    await page.waitForTimeout(380);
    const navigationFrames = sampleFrames(page).catch(error => ({ error: error.message }));
    await page.locator('#customize').click();
    await page.waitForFunction(() => document.querySelector('#app').dataset.page === 'settings');
    await page.waitForTimeout(380);
    assert.equal(context.pages().length, 1, 'Customize must not open another WebView');
    assert.equal(await page.locator('.setting-row').count(), 30);
    assert.equal(await page.getByText('server-list-top-padding', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(qa, 'tauri-settings.png') });
    assert.equal(await page.locator('#settings-list details:not([open])').count(), 0);
    assert.equal(await page.locator('.section-heading').first().textContent(), 'Server List');
    assert.equal(await page.locator('[data-name="--chat-input-gap"]').count(), 0);
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).getAttribute('aria-valuetext'), '100%');
    assert.equal(await page.getByLabel('Liquid Glass Blur', { exact: true }).getAttribute('aria-valuetext'), '100%');
    const expandMenus = () => page.locator('#settings-list details').evaluateAll(nodes => nodes.forEach(node => node.open = true));
    await expandMenus();
    const g = await geometry();
    assert(g.centered && !g.overflow && g.backgroundCount === 1 && g.cover && g.bgTransform === 'none');
    assert(g.blur.includes('blur(16px)'));
    assert.equal(await page.locator('.color-grid [data-name="--text-muted"]').count(), 1);
    assert.equal(await page.locator('.color-grid [data-name="--interactive-hover"]').count(), 1);
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).getAttribute('min'), '90');
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).getAttribute('max'), '110');
    await page.locator('[data-name="--text-normal"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(qa, 'hotori-color-grid.png') });
    await page.locator('[data-name="--message-avatar-size"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(qa, 'hotori-avatars.png') });
    await page.locator('[data-name="--blur-val"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(qa, 'hotori-blur-sliders.png') });
    assert(await page.locator('input[type="range"]').evaluateAll(inputs => inputs.every(input => input.step === '1' && Number.isInteger(Number(input.min)) && Number.isInteger(Number(input.max)))));
    assert(await page.locator('.range-output, .range-endpoints, .opacity-input output').evaluateAll(nodes => nodes.every(node => !/\d\.\d/.test(node.textContent))));
    const performance = { navigation: await navigationFrames };
    const scrollFrames = sampleFrames(page);
    await page.locator('#settings-form').hover();
    await page.mouse.wheel(0, 350);
    await page.waitForTimeout(250);
    await page.mouse.wheel(0, 350);
    performance.scrolling = await scrollFrames;
    await fs.writeFile(path.join(qa, 'frame-samples.json'), JSON.stringify(performance, null, 2));
    console.log('WebView2 requestAnimationFrame samples (not a GPU presentation benchmark):', performance);
    await page.locator('#settings-form').evaluate(el => el.scrollTop = 0);

    await expandMenus();
    // Back discards drafts; reopening loads the original values from Rust.
    await page.getByLabel('Acrylic Blur', { exact: true }).fill('110');
    await page.locator('#back').click();
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    await expandMenus();
    assert.equal(await page.getByLabel('Acrylic Blur', { exact: true }).inputValue(), '100');
    await page.getByLabel('Acrylic Blur', { exact: true }).fill('110');
    await page.getByLabel('Glass Profile', { exact: true }).selectOption('Liquid Glass');
    await page.getByLabel('Accent Color', { exact: true }).fill('#123456');
    await page.getByLabel('Main Background', { exact: true }).fill('');
    // Exercise a native range control without opening the OS color chooser.
    await page.getByLabel('Main Background · Top Dimming opacity', { exact: true }).fill('50');
    const avatar = page.getByLabel('Message Avatar Size', { exact: true });
    assert.equal(await avatar.getAttribute('max'), '120');
    assert.equal(await avatar.getAttribute('aria-valuetext'), '100%');
    await avatar.fill('120');
    assert.equal(await avatar.getAttribute('aria-valuetext'), '120%');
    const radius = page.getByLabel('Avatar Roundness', { exact: true });
    assert.equal(await radius.getAttribute('aria-valuetext'), '60%');
    assert.equal(await radius.getAttribute('title'), '0% is square; 100% is a full circle.');
    assert.equal(await radius.getAttribute('min'), '0');
    assert.equal(await radius.getAttribute('max'), '100');
    await radius.fill('100');
    assert.equal(await radius.getAttribute('aria-valuetext'), '100%');
    await saveCategory('Glass Appearance');
    const partial = await fs.readFile(destination, 'utf8');
    assert(partial.includes('--blur-val: 26.4px;'));
    assert(partial.includes('--main-color: #ec5757;'), 'Saving glass must not save the color draft');
    assert(partial.includes('--message-avatar-size: 40px;'), 'Saving glass must not save the avatar draft');
    assert.equal(await page.getByLabel('Accent Color', { exact: true }).inputValue(), '#123456');
    assert.equal(await avatar.inputValue(), '120');
    // Repeated category saves keep the session current.
    await page.getByLabel('Acrylic Blur', { exact: true }).fill('109');
    await saveCategory('Glass Appearance');
    await page.getByLabel('Acrylic Blur', { exact: true }).fill('110');
    await saveCategory('Glass Appearance');
    await page.screenshot({ path: path.join(qa, 'hotori-category-saves.png') });
    await saveAndBack();
    const saved = await fs.readFile(destination, 'utf8');
    assert(saved.includes('--blur-val: 26.4px;'));
    assert(saved.includes('--blur-profile: var(--blur-liquid);'));
    assert(saved.includes('--main-color: #123456;'));
    assert(saved.includes('--main-bg: none;'));
    assert(saved.includes('--message-avatar-size: 70px;'));
    assert(saved.includes('--avatar-radius: 50%;'));
    assert(saved.includes('--chat-input-gap: 12px;'));
    assert(saved.includes('--bg-overlay-top: rgba(12, 16, 24, 0.5);'));
    assert(saved.includes('--text-normal: #ffffff !important;'));
    assert(saved.endsWith('.implementation { color: red; }\n'));
    assert(saved.includes('--server-list-top-padding: 12px;'));

    // Reset saves bundled defaults across categories and discards unsaved drafts in place.
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    await page.getByLabel('Accent Color', { exact: true }).fill('#abcdef');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent === 'All customization options reset and saved to defaults.');
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings');
    assert.equal(await page.locator('.category-save:not(:disabled)').count(), 0);
    const reset = await fs.readFile(destination, 'utf8');
    assert(reset.includes('--main-color: #5865f2;'));
    assert(reset.includes('--blur-val: 24px;'));
    assert(reset.includes('--liquid-blur-val: 2.5px;'));
    assert(reset.includes('--message-avatar-size: 60px;'));
    assert(reset.includes('--avatar-radius: 30%;'));
    assert(reset.includes('--main-bg: none;'));
    assert(reset.includes('--settings-bg: none;'));
    assert(reset.includes('--chat-input-gap: 12px;'));
    assert(reset.includes('--server-list-top-padding: 12px;'));
    assert(reset.endsWith('.implementation { color: red; }\n'));
    assert.equal(await page.getByLabel('Accent Color', { exact: true }).inputValue(), '#5865f2');
    await page.getByLabel('Accent Color', { exact: true }).fill('#112233');
    await saveCategory('Colors');
    assert((await fs.readFile(destination, 'utf8')).includes('--main-color: #112233;'));
    await page.locator('#back').click();

    // An external edit must fail safely and leave the editor visible.
    await page.waitForTimeout(380);
    await page.locator('#customize').click();
    await page.waitForTimeout(380);
    await fs.appendFile(destination, '/* External edit */\n');
    await page.getByLabel('Accent Color', { exact: true }).fill('#abcdef');
    await page.getByRole('button', { name: 'Save Colors', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#settings-status').dataset.error === 'true');
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings');
    const externallyEdited = await fs.readFile(destination, 'utf8');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#reset-defaults').disabled);
    assert.equal(await page.locator('#settings-status').getAttribute('data-error'), 'true');
    assert.equal(await fs.readFile(destination, 'utf8'), externallyEdited);
    await page.locator('#back').click();
    await page.waitForTimeout(380);

    // Resize the actual native window, rather than only changing CSS viewport emulation.
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    for (const [width, height] of [[1440, 960], [600, 640], [1120, 780]]) {
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
      await page.waitForTimeout(300);
      const home = await geometry();
      await page.screenshot({ path: path.join(qa, `hotori-home-${width}.png`) });
      assert(home.centered && !home.overflow && home.cover, JSON.stringify({ width, height, home }));
      await page.locator('#customize').click();
      await page.waitForTimeout(380);
      const settings = await geometry();
      assert(settings.centered && !settings.overflow && settings.cover);
      await expandMenus();
      const form = page.locator('#settings-form');
      await form.evaluate(el => el.scrollTop = el.scrollHeight);
      assert(await form.evaluate(el => el.scrollTop > 0));
      await page.screenshot({ path: path.join(qa, `tauri-settings-${width}.png`) });
      await page.locator('#back').click();
      await page.waitForTimeout(380);
    }
    await page.locator('#uninstall').click();
    await page.waitForFunction(() => document.getElementById('customize').disabled && !document.getElementById('install').disabled);
    await assert.rejects(fs.access(destination));
    assert.equal(await fs.readFile(source, 'utf8'), theme);
    assert.deepEqual((await fs.readdir(folder)).sort(), ['devhotori.theme.css', 'hotori-assets']);
    await page.locator('#window-minimize').click();
    await page.waitForFunction(async () => await window.__TAURI__.window.getCurrentWindow().isMinimized());
    assert.deepEqual(errors, []);
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Custom close button did not exit Hotori')), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    // Dispatch from the document while the native window is minimized.
    await page.locator('#window-close').evaluate(button => button.click()).catch(error => {
      if (!/closed/i.test(error.message)) throw error;
    });
    await closed;
    console.log('PASS: native Tauri install, settings, save, Back, external edit protection, scrolling, resize, fixed cover background, centering, uninstall, and custom window controls.');
  } finally {
    if (browser) await browser.close();
    child.kill();
    // Preserve the disposable profile and screenshots for diagnostics; no user theme is touched.
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
