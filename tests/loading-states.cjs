const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(version => {
      const fields = [{ name: '--blur-profile', section: 'Glass appearance', label: 'Glass Profile', hint: 'Choose a material.', kind: 'choice', value: 'Acrylic', choices: ['Acrylic', 'Liquid Glass'], choiceHints: ['', ''] }];
      window.rejectNextSettings = false;
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === 'get_status') return { ready: true, installed: true, theme_version: '0.9.2' };
        if (command === 'check_app_update' || command === 'check_theme_update') return { available: false };
        if (command === 'show_main_window') return;
        if (command === 'load_settings') return new Promise((resolve, reject) => {
          window.finishSettings = () => window.rejectNextSettings ? reject(Error('Test settings unavailable')) : resolve(structuredClone(fields));
        });
        if (command === 'get_app_changelog') return { schemaVersion: 1, currentVersion: version, releases: [{ version, body: 'Generic release notes.' }] };
        throw Error(command);
      } } };
      localStorage.setItem('hotori.appChangelogSeenVersion', version);
    }, require('../tauri.conf.json').version);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
    await page.locator('#customize').click();
    await page.locator('#settings-form[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('#app').getAttribute('data-page'), 'settings');
    assert(await page.locator('#settings-list .loading-skeleton').count() > 0, 'Pending settings show skeleton placeholders');
    assert.equal(await page.locator('#settings-list input').count(), 0, 'Loading does not leave editable stale controls');
    await page.screenshot({ path: path.resolve(__dirname, '../target/qa/settings-loading.png') });
    await page.evaluate(() => window.finishSettings());
    await page.getByLabel('Glass Profile', { exact: true }).waitFor();
    const frames = await page.evaluate(async () => {
      const samples = [];
      for (let index = 0; index < 18; index++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const panel = document.querySelector('.settings-card').getBoundingClientRect();
        samples.push({ x: panel.x, y: panel.y,
          opacity: ['#settings-page', '#settings-list', '.settings-section:not([hidden])'].map(selector => getComputedStyle(document.querySelector(selector)).opacity),
          animations: document.getAnimations().filter(animation => animation.effect?.target?.matches?.('#settings-page, #settings-list, .settings-section, .settings-card, .settings-sidebar')).length });
      }
      return samples;
    });
    assert(frames.every(frame => frame.opacity.slice(1).every(value => value === '1')), 'Nested glass containers do not add a second fade');
    assert.equal(await page.locator('#settings-page').evaluate(el => getComputedStyle(el).transitionProperty), 'opacity, visibility', 'Page entry uses a compositor fade');
    assert(frames.every(frame => Math.abs(frame.x - frames[0].x) < .1 && Math.abs(frame.y - frames[0].y) < .1), 'Glass panel geometry is stable from the first settings frames');
    assert.notEqual(await page.locator('#settings-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#settings-list .loading-skeleton').count(), 0);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.evaluate(() => { window.rejectNextSettings = true; });
    await page.locator('#customize').click();
    await page.locator('#settings-form[aria-busy="true"]').waitFor();
    await page.evaluate(() => window.finishSettings());
    await page.waitForFunction(() => document.querySelector('#app').dataset.page === 'installer');
    assert.notEqual(await page.locator('#settings-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#settings-list .loading-skeleton').count(), 0, 'Failures clean up loading placeholders');
    assert((await page.locator('#home-status').textContent()).includes('Could not load settings'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { window.rejectNextSettings = false; });
    await page.locator('#customize').click();
    await page.locator('#settings-form[aria-busy="true"]').waitFor();
    assert.equal(await page.locator('.loading-skeleton').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'Reduced motion disables shimmer');
    await page.evaluate(() => window.finishSettings());
    await page.getByLabel('Glass Profile', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: deferred settings skeleton, stale-control prevention, success/error cleanup, and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
