const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
      const sections = ['Glass appearance', 'Wallpapers', 'Accent color', 'Avatars', 'Message spacing', 'Server list'];
      const defaults = sections.flatMap((section, category) => Array.from({ length: category === 1 ? 8 : 3 }, (_, index) => ({
        name: `--test-${category}-${index}`, section, label: `${section} ${index + 1}`, hint: 'Adjust this detail of your theme.',
        kind: 'number', value: '12', unit: 'pixels',
      })));
      let saved = structuredClone(defaults);
      window.savedSettings = saved;
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.8.0' };
        if (command === 'check_app_update') return { available: false };
        if (command === 'check_theme_update') return { available: false, installedVersion: '0.8.0', version: '0.8.0' };
        if (command === 'load_settings') return structuredClone(saved);
        if (command === 'reset_settings') { saved = structuredClone(defaults); window.savedSettings = saved; return structuredClone(saved); }
        if (command === 'save_settings') {
          saved = saved.map(field => ({ ...field, value: args.edits.find(edit => edit.name === field.name).value }));
          window.savedSettings = saved; return structuredClone(saved);
        }
        throw new Error(command);
      } } };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
    await page.locator('#customize').click();
    await page.waitForTimeout(400);
    const tab = name => page.getByRole('tab', { name, exact: true });
    assert.equal(await page.getByRole('tab').count(), 6);
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
    assert.equal(await tab('Glass Appearance').getAttribute('aria-selected'), 'true');
    const restingWidth = await tab('Wallpapers').evaluate(el => el.getBoundingClientRect().width);
    await tab('Wallpapers').hover();
    await page.waitForTimeout(300);
    assert(await tab('Wallpapers').evaluate(el => el.getBoundingClientRect().width) > restingWidth * 1.02);
    const selectedGlow = await tab('Glass Appearance').evaluate(el => getComputedStyle(el).boxShadow);
    assert.notEqual(selectedGlow, 'none', 'Selected acrylic category has an accent halo');
    await page.mouse.move(780, 100);
    await page.waitForTimeout(300);
    assert(Math.abs(await tab('Wallpapers').evaluate(el => el.getBoundingClientRect().width) - restingWidth) < .1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await tab('Wallpapers').hover();
    assert.equal(await tab('Wallpapers').evaluate(el => getComputedStyle(el).transform), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.move(780, 100);
    const surfaces = await page.evaluate(() => {
      const sidebar = document.querySelector('.settings-sidebar');
      const editor = document.querySelector('.settings-card');
      const a = sidebar.getBoundingClientRect(), b = editor.getBoundingClientRect();
      return { siblings: sidebar.parentElement === editor.parentElement, gap: b.left - a.right };
    });
    assert(surfaces.siblings && surfaces.gap > 0);
    await page.getByLabel('Glass appearance 1', { exact: true }).fill('24');
    await tab('Wallpapers').click();
    assert.equal(await page.getByLabel('Glass appearance 1', { exact: true }).isVisible(), false);
    assert.equal(await tab('Glass Appearance').getAttribute('data-dirty'), 'true');
    await page.getByLabel('Wallpapers 1', { exact: true }).fill('32');
    await page.locator('#settings-form').evaluate(el => el.scrollTop = 160);
    const scroll = await page.locator('#settings-form').evaluate(el => el.scrollTop);
    await tab('Glass Appearance').click();
    assert.equal(await page.getByLabel('Glass appearance 1', { exact: true }).inputValue(), '24');
    await page.getByRole('button', { name: 'Save Glass Appearance', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-category="Glass Appearance"]').dataset.state === 'saved');
    const saved = await page.evaluate(() => window.savedSettings);
    assert.equal(saved.find(field => field.name === '--test-0-0').value, '24');
    assert.equal(saved.find(field => field.name === '--test-1-0').value, '12', 'Saving one category leaves other drafts unsaved');
    await tab('Wallpapers').click();
    assert.equal(await page.locator('#settings-form').evaluate(el => el.scrollTop), scroll);
    assert.equal(await page.getByLabel('Wallpapers 1', { exact: true }).inputValue(), '32');
    await page.locator('#settings-form').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: path.join(qa, 'settings-sidebar-wallpapers.png') });
    await tab('Wallpapers').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await tab('Colors').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await tab('Messages').getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('reset and saved'));
    assert.equal(await tab('Messages').getAttribute('aria-selected'), 'true', 'Reset keeps the selected category');
    await tab('Wallpapers').click();
    assert.equal(await page.getByLabel('Wallpapers 1', { exact: true }).inputValue(), '12');
    for (const [width, height] of [[1120, 780], [800, 600], [560, 560]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      for (const selector of ['.settings-sidebar', '.settings-card', '#settings-form', '.settings-footer']) {
        const rect = await page.locator(selector).boundingBox();
        assert(rect.x >= 0 && rect.y >= 52 && rect.x + rect.width <= width && rect.y + rect.height <= height, JSON.stringify({ width, selector, rect }));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(qa, `settings-sidebar-${width}.png`) });
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'installer');
    assert.deepEqual(errors, []);
    console.log('PASS: separate glass panels, category isolation, preserved drafts/scroll, independent saves, reset, keyboard navigation, and 560–1600px layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
