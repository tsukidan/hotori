const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    for (const mode of ['available','current','offline','deferred']) {
      const page = await browser.newPage();
      await page.addInitScript(mode => {
        window.checks = 0;
        window.__TAURI__ = {core:{invoke: async command => {
          if(command === 'get_status') return {ready:true,installed:false};
          if(command === 'show_main_window') {
            window.shown = true;
            if(mode === 'deferred') document.querySelector('#guide-dialog').showModal();
            return;
          }
          if(command === 'check_app_update') {
            if(!window.shown) throw Error('Window not ready');
            window.checks++;
            if(mode === 'offline') throw Error('Offline');
            return {available:mode !== 'current',version:'1.7.5',currentVersion:'1.7.4'};
          }
          throw Error(command);
        }}};
      },mode);
      await page.goto(pathToFileURL(path.resolve('web/index.html')).href);
      await page.waitForFunction(() => window.checks === 1);
      if(mode === 'deferred') {
        assert.equal(await page.locator('#app-update-dialog').isVisible(), false);
        await page.locator('#guide-close').click();
      }
      if(mode === 'available' || mode === 'deferred') {
        await page.locator('#app-update-dialog').waitFor({state:'visible'});
        assert.deepEqual(await page.locator('#app-update-description strong').allTextContents(),['1.7.5','1.7.4']);
        assert.equal(await page.locator('#app-update-dialog').evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');
        assert.equal(await page.locator('#app-update-dialog').evaluate(e=>getComputedStyle(e).animationName),'hotori-prompt-in');
        await page.locator('#app-update-cancel').click();
        await page.waitForTimeout(700);
        assert.equal(await page.locator('#app-update-dialog').isVisible(),false);
      } else {
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#app-update-dialog').isVisible(),false);
      }
      await page.close();
    }
    console.log('PASS startup update offer, version emphasis, dialog animation/scrollbars, dismissal, deferred offer, current and offline states');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
