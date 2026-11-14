const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const version = require('../tauri.conf.json').version;
    await page.addInitScript(version => {
      window.blockingWheelHandlers = new Set();
      const addListener = document.addEventListener.bind(document), removeListener = document.removeEventListener.bind(document);
      document.addEventListener = (type, listener, options) => {
        if (type === 'wheel' && !(typeof options === 'object' && options.passive)) window.blockingWheelHandlers.add(listener);
        return addListener(type, listener, options);
      };
      document.removeEventListener = (type, listener, options) => {
        if (type === 'wheel') window.blockingWheelHandlers.delete(listener);
        return removeListener(type, listener, options);
      };
      localStorage.setItem('hotori.appChangelogSeenVersion', version);
      window.statusCalls = 0; window.activeStatusCalls = 0; window.maxStatusCalls = 0; window.statusDelay = 0;
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === 'get_status') {
          window.statusCalls++; window.activeStatusCalls++;
          window.maxStatusCalls = Math.max(window.maxStatusCalls, window.activeStatusCalls);
          if (window.statusDelay) await new Promise(resolve => setTimeout(resolve, window.statusDelay));
          window.activeStatusCalls--;
          return { ready: true, installed: true, theme_version: '0.9.2' };
        }
        if (command === 'check_app_update' || command === 'check_theme_update') return { available: false };
        if (command === 'get_theme_changelog') return { schemaVersion: 1, versions: { '0.9.2': [{ title: 'Generic note', description: 'Generic release details.' }] } };
        if (command === 'get_app_changelog') return { schemaVersion: 1, currentVersion: version, releases: [{ version, body: 'Generic release notes.' }] };
        if (command === 'show_main_window') return;
        throw Error(command);
      } } };
    }, version);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../web/index.html')).href);
    await page.waitForFunction(() => document.getElementById('home-status').textContent.includes('Hotori is installed'));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.blockingWheelHandlers.size), 0, 'Ordinary scrolling has no cancellable document wheel handler');
    await page.keyboard.down('Control');
    assert.equal(await page.evaluate(() => window.blockingWheelHandlers.size), 1, 'Only Ctrl zoom intercepts wheel scrolling');
    await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => window.blockingWheelHandlers.size), 0, 'Releasing Ctrl restores compositor scrolling');
    const mutations = await page.evaluate(async () => {
      const mutations = [];
      const observer = new MutationObserver(records => mutations.push(...records.map(record => ({
        type: record.type, attribute: record.attributeName, target: record.target.id || record.target.className,
      }))));
      observer.observe(document.getElementById('app'), { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['disabled', 'hidden', 'aria-busy', 'aria-label', 'data-dirty', 'data-state', 'data-category'] });
      await refresh(); await new Promise(resolve => requestAnimationFrame(resolve)); observer.disconnect();
      return mutations;
    });
    assert.deepEqual(mutations, [], 'An unchanged status refresh must not rewrite labels or control state');
    const concurrency = await page.evaluate(async () => {
      window.statusDelay = 40; window.maxStatusCalls = 0;
      const before = window.statusCalls;
      await Promise.all([refresh(), refresh(), refresh()]);
      return { calls: window.statusCalls - before, concurrent: window.maxStatusCalls };
    });
    assert.equal(concurrency.concurrent, 1, 'Status reads never overlap');
    assert.equal(concurrency.calls, 2, 'Concurrent requests collapse into one queued fresh read');
    console.log('PASS: unchanged refresh produces no UI mutations, and overlapping refreshes coalesce without losing a fresh read.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
