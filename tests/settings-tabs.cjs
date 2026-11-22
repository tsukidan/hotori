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
      defaults.push({ name: '--show-friends-sidebar', section: 'Friends sidebar', label: 'Friends Sidebar',
        hint: 'Show or hide the persistent right-side Friends sidebar.', kind: 'choice', value: 'Hidden',
        choices: ['Hidden', 'Shown'], choiceHints: ['Hide the sidebar.', 'Show the sidebar.'] });
      defaults.push({ name: '--message-bubbles', section: 'Message bubbles', label: 'Message Bubbles', kind: 'choice', value: 'Off', choices: ['Off','On'], choiceHints: ['', ''], hint: 'Requires Vencord’s built-in ThemeAttributes plugin. Enable via Discord Settings → Vencord → Plugins → ThemeAttributes.' });
      for (const [name,label,value] of [['--message-bubble-self-tint','Your Messages','#5865f23d'],['--message-bubble-other-tint','Other Messages','#10182052']]) defaults.push({name, label, section:'Message bubbles', kind:'color', value, color:value.slice(0,7), alphaEnabled:true, opacity:parseInt(value.slice(7),16)/255, hint:'Color and opacity of grouped messages.'});
      defaults.push({ name: '--collapse-member-list', section: 'Member list', label: 'Compact Member List', kind: 'choice', value: 'Disabled', choices: ['Disabled', 'Enabled'], choiceHints: ['Restores the normal member list.', 'Hover expands the icons-only rail.'], hint: 'Hover expands the icons-only rail without resizing chat.' });
      let saved = structuredClone(defaults);
      window.savedSettings = saved;
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command === 'get_true_liquid_glass') return { config: null, instances: [], error: null };
        if (command === 'save_true_liquid_glass') return { config: { schemaVersion: 1, revision: 1, requestedEnabled: args.requestedEnabled, quality: args.quality }, instances: [], error: null };
        if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.8.0' };
        if (command === 'check_app_update') return { available: false };
        if (command === 'check_theme_update') return { available: false, installedVersion: '0.8.0', version: '0.8.0' };
        if (command === 'list_presets') return [];
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
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Presets','Wallpapers','Colors','Avatars','Messages','Glass Appearance','Server List','Background Music']);
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
    assert.equal(await tab('Wallpapers').getAttribute('aria-selected'), 'true');
    await tab('Glass Appearance').click();
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
    await tab('Server List').click();
    const compact = page.locator('[data-name="--collapse-member-list"]');
    assert.equal(await compact.isVisible(), true, 'Compact Member List is visible under Server List');
    assert.deepEqual(await compact.locator('select option').allTextContents(), ['Disabled', 'Enabled']);
    assert.equal(await compact.locator('select').inputValue(), 'Disabled');
    const serverSave = page.getByRole('button', { name: 'Save Server List', exact: true });
    for (const choice of ['Enabled', 'Disabled']) {
      await compact.locator('select').selectOption(choice);
      await page.getByRole('button', { name: 'Save Server List', exact: true }).waitFor();
      assert.equal(await serverSave.isEnabled(), true, 'Changing Compact Member List enables Server List save');
      assert.equal(await tab('Server List').getAttribute('data-dirty'), 'true');
      assert.notEqual(await tab('Colors').getAttribute('data-dirty'), 'true', 'Member list edits do not dirty Colors');
      await serverSave.click();
      await page.waitForFunction(choice => window.savedSettings.find(f => f.name === '--collapse-member-list').value === choice, choice);
      await page.waitForFunction(() => document.querySelector('#save-category').disabled);
      assert.equal(await serverSave.isDisabled(), true, 'Save returns to disabled after saving');
    }
    const friends = page.getByLabel('Friends Sidebar', { exact: true });
    assert.equal(await friends.count(), 0, 'Retired Friends Sidebar option is not rendered');
    assert.equal(await page.locator('[data-name="--show-friends-sidebar"]').count(), 0);
    await tab('Colors').click();
    await tab('Server List').click();
    assert.equal(await friends.count(), 0);
    await tab('Glass Appearance').click();
    await page.getByLabel('Glass appearance 1', { exact: true }).fill('24');
    await tab('Wallpapers').click();
    assert.equal(await page.locator('[role="tabpanel"]:visible').evaluate(el => el.classList.contains('material-fade')), true, 'Category switches fade the completed panel');
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
    assert.equal(saved.find(field => field.name === '--show-friends-sidebar').value, 'Hidden', 'Retired option keeps its existing saved value');
    await tab('Wallpapers').click();
    assert.equal(await page.locator('#settings-form').evaluate(el => el.scrollTop), scroll);
    assert.equal(await page.getByLabel('Wallpapers 1', { exact: true }).inputValue(), '32');
    await page.locator('#settings-form').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: path.join(qa, 'settings-sidebar-wallpapers.png') });
    await tab('Wallpapers').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await tab('Colors').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await tab('Background Music').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowUp');
    assert.equal(await tab('Server List').getAttribute('aria-selected'), 'true');
    await page.locator('#reset-defaults').click();
    assert.equal(await page.locator('#reset-cancel').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#reset-dialog').evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    await page.locator('#reset-cancel').click();
    assert.equal((await page.evaluate(() => window.savedSettings)).find(field => field.name === '--test-0-0').value, '24');
    await page.locator('#reset-defaults').click();
    await page.keyboard.press('Escape');
    await page.locator('#reset-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#reset-dialog').isVisible(), false);
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings');
    assert.equal(await page.locator('.settings-header #back').count(), 1);
    assert.equal(await page.locator('.settings-footer #back').count(), 0);
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await page.locator('#reset-confirm').click();
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('reset and saved'));
    assert.equal(await tab('Server List').getAttribute('aria-selected'), 'true', 'Reset keeps the selected category');
    await tab('Wallpapers').click();
    assert.equal(await page.getByLabel('Wallpapers 1', { exact: true }).inputValue(), '12');
    for (const [width, height] of [[1920, 1080], [2560, 1440], [1120, 780], [800, 600], [560, 560]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      for (const selector of ['.settings-sidebar', '.settings-card', '#settings-form', '.settings-footer']) {
        const rect = await page.locator(selector).boundingBox();
        assert(rect.x >= 0 && rect.y >= 52 && rect.x + rect.width <= width && rect.y + rect.height <= height, JSON.stringify({ width, selector, rect }));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const typography = await page.locator('.category-tab:visible, .setting-hint:visible, .settings-footer .status, .settings-card .settings-footer .button').evaluateAll(elements => elements.map(element => ({ text: element.textContent.trim().slice(0, 30), size: parseFloat(getComputedStyle(element).fontSize) })));
      assert(typography.every(item => item.size >= 13), JSON.stringify({ width, typography }));
      for (const selector of ['.settings-heading-row', '.settings-footer']) {
        assert(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${selector} must wrap without overflowing at ${width}px`);
      }
      const workspace = await page.locator('.settings-workspace').boundingBox();
      if (width >= 1920) assert(workspace.width > width * .9, 'Settings use the maximized window width instead of a centered 1280px column');
      if (height >= 1440) assert(workspace.height > 1200, 'Tall windows show more settings instead of capping panel height at 960px');
      await page.screenshot({ path: path.join(qa, `settings-sidebar-${width}.png`) });
    }
    await tab('Messages').click();
    await page.getByLabel('Message Bubbles', { exact: true }).selectOption('On');
    assert.equal(await page.locator('.bubble-dependency-warning svg').count(), 2);
    assert.equal(await page.locator('.bubble-warning-marker').allTextContents().then(v=>v.join('')), '!!!!');
    const self = page.locator('[data-name="--message-bubble-self-tint"]');
    await self.locator('input[type="color"]').fill('#123456');
    await self.locator('input[type="range"]').fill('50');
    const other = page.locator('[data-name="--message-bubble-other-tint"]');
    await other.locator('input[type="range"]').fill('25');
    assert((await page.locator('[data-name="--message-bubbles"]').textContent()).includes('ThemeAttributes'));
    await page.locator('#save-category').click();
    await page.waitForFunction(() => window.savedSettings.find(f=>f.name==='--message-bubbles').value==='On');
    const bubbleValues = await page.evaluate(() => window.savedSettings.filter(f=>f.section==='Message bubbles').map(f=>f.value));
    assert.deepEqual(bubbleValues, ['On','#12345680','#10182040']);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'installer');
    assert.deepEqual(errors, []);
    console.log('PASS: category fades, separate glass panels, category isolation, preserved drafts/scroll, independent saves, reset, keyboard navigation, and 560–2560px layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
