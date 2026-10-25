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
    const catalog = JSON.parse(await fs.readFile(path.join(__dirname, '../assets/theme-changelog.json'), 'utf8'));
    for (const scenario of ['outdated', 'current', 'newer', 'offline', 'unknown', 'absent', 'latest-theme', 'previous-theme', 'future', 'normalized']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({scenario, catalog}) => {
        let installed = scenario !== 'absent';
        let version = scenario === 'future' ? '0.9.5' : scenario === 'normalized' ? 'v0.8.12+local' : scenario === 'latest-theme' ? '0.8.12' : scenario === 'previous-theme' ? '0.8.9' : scenario === 'unknown' ? null : scenario === 'newer' ? '0.9.0' : scenario === 'current' ? '0.8.3' : '0.8.2';
        window.setThemeVersion = next => { version = next; };
        window.themeChecks = 0; window.themeInstalls = 0;
        window.__TAURI__ = { core: { invoke: async (command, args) => {
          if (command === 'get_status') return { ready: true, installed, theme_version: version };
          if (command === 'get_theme_changelog') {
            if (args.refresh && scenario === 'offline') throw Error('Offline');
            if (args.refresh && scenario === 'future') return {schemaVersion: 1, versions: {...catalog.versions, '0.9.5': [{title: 'Future theme', description: 'Fetched without an app rebuild.'}]}};
            return structuredClone(catalog);
          }
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
      }, {scenario, catalog});
      await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
      await page.waitForFunction(() => status.ready && !checkingTheme && (!status.installed || (!!themeChangelog && !changelogLoading)));
      if (scenario === 'latest-theme' || scenario === 'previous-theme') {
        assert.equal(await page.locator('#theme-changelog-version').textContent(), scenario === 'latest-theme' ? 'Theme v0.8.12' : 'Theme v0.8.9');
        const notes = await page.locator('#theme-changelog-items').textContent();
        assert(notes.includes(scenario === 'latest-theme' ? 'Unread markers:' : 'Mentions:'));
        assert(!notes.includes('Startup:') && !notes.includes('Offline:'));
        if (scenario === 'previous-theme') {
          await page.evaluate(async () => { window.setThemeVersion('0.8.12'); await refresh(); });
          assert((await page.locator('#theme-changelog-items').textContent()).includes('Unread markers:'));
          assert(!(await page.locator('#theme-changelog-items').textContent()).includes('Mentions:'));
        }
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(qa, `changelog-${scenario}.png`) });
      } else if (scenario === 'future') {
        assert((await page.locator('#theme-changelog-items').textContent()).includes('Future theme:'));
      } else if (scenario === 'normalized' || scenario === 'offline') {
        assert(!(await page.locator('#theme-changelog-items').textContent()).includes('not available'));
      } else if (scenario === 'unknown' || scenario === 'newer') {
        assert((await page.locator('#theme-changelog-items').textContent()).includes('not available for this theme version'));
      }
      const notice = page.locator('#theme-update-notice');
      assert.equal(await notice.isVisible(), scenario === 'outdated', scenario);
      const expectedChecks = scenario === 'absent' ? 0 : scenario === 'previous-theme' ? 2 : 1;
      assert.equal(await page.evaluate(() => window.themeChecks), expectedChecks);
      await page.evaluate(async () => { await refresh(); await refresh(); });
      assert.equal(await page.evaluate(() => window.themeChecks), expectedChecks, 'Local status polling must not repeat GitHub checks');
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
        await page.waitForFunction(() => status.theme_version === '0.8.3' && !changelogLoading);
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
