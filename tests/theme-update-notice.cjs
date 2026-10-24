const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const qa = path.resolve(__dirname, '../target/qa');
  await fs.mkdir(qa, { recursive: true });
  try {
    for (const scenario of ['outdated', 'current', 'newer', 'offline', 'unknown', 'absent']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(scenario => {
        let installed = scenario !== 'absent';
        let version = scenario === 'unknown' ? null : scenario === 'newer' ? '0.9.0' : scenario === 'current' ? '0.8.3' : '0.8.2';
        window.themeChecks = 0; window.themeInstalls = 0;
        window.__TAURI__ = { core: { invoke: async command => {
          if (command === 'get_status') return { ready: true, installed, theme_version: version };
          if (command === 'check_app_update') return { available: false };
          if (command === 'check_theme_update') {
            window.themeChecks++;
            if (scenario === 'offline') throw new Error('Offline');
            return { version: '0.8.3', installedVersion: version, available: version === '0.8.2' };
          }
          if (command === 'update_theme') { window.themeInstalls++; version = '0.8.3'; return { version, changed: true }; }
          if (command === 'uninstall_theme') { installed = false; return; }
          throw new Error(command);
        } } };
      }, scenario);
      await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
      await page.waitForFunction(() => status.ready && !checkingTheme);
      const notice = page.locator('#theme-update-notice');
      assert.equal(await notice.isVisible(), scenario === 'outdated', scenario);
      assert.equal(await page.evaluate(() => window.themeChecks), scenario === 'absent' ? 0 : 1);
      await page.evaluate(async () => { await refresh(); await refresh(); });
      assert.equal(await page.evaluate(() => window.themeChecks), scenario === 'absent' ? 0 : 1, 'Local status polling must not repeat GitHub checks');
      if (scenario === 'outdated') {
        assert.equal(await page.locator('#theme-update-label').textContent(), 'v0.8.3 available');
        await page.waitForTimeout(850);
        const rect = await page.locator('#theme-version-value').boundingBox();
        const update = await notice.boundingBox();
        assert(update.x > rect.x + rect.width, 'Notice appears to the right of installed version');
        assert.equal(await notice.evaluate(el => getComputedStyle(el).borderLeftWidth), '1px');
        await page.screenshot({ path: path.join(qa, 'theme-update-notice.png') });
        await page.setViewportSize({ width: 560, height: 560 });
        await page.waitForTimeout(100);
        await page.locator('#theme-version').scrollIntoViewIfNeeded();
        const bubble = await page.locator('#theme-version').boundingBox();
        assert(bubble.x >= 0 && bubble.x + bubble.width <= 560 && bubble.y + bubble.height <= 560);
        await page.screenshot({ path: path.join(qa, 'theme-update-notice-560.png') });
        await notice.click();
        await page.waitForFunction(() => status.theme_version === '0.8.3');
        assert.equal(await notice.isVisible(), false);
        assert.equal(await page.locator('#theme-version-value').textContent(), 'v0.8.3');
        assert.equal(await page.evaluate(() => window.themeInstalls), 1);
        await page.locator('#uninstall').click();
        await page.locator('#uninstall-confirm').click();
        await page.waitForFunction(() => !status.installed);
        assert.equal(await page.locator('#theme-version').isVisible(), false);
      }
      if (scenario === 'offline') assert((await page.locator('#home-status').textContent()).includes('Hotori is installed'));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: newer/current/ahead/offline/unknown/uninstalled states, cached checks, right-side separator, responsive layout, update action, and notice clearing.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
