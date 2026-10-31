const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
 const catalog=JSON.parse(fs.readFileSync('assets/app-changelog.json','utf8')); catalog.currentVersion='1.7.10';
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1120,height:780}});
  await page.addInitScript(catalog=>{
   window.installs=0;
   window.__TAURI__={core:{invoke:async command=>{
    if(command==='get_status')return {ready:true,installed:false};
    if(command==='show_main_window')return;
    if(command==='get_app_changelog')return catalog;
    if(command==='check_app_update')return {available:localStorage.getItem('testOfferUpdate')==='yes',currentVersion:'1.7.10',version:'1.7.11'};
    if(command==='install_app_update')window.installs++;
    throw Error(command);
   }}};
  },catalog);
  const url=pathToFileURL(path.resolve('web/index.html')).href;
  await page.goto(url);
  const dialog=page.locator('#app-changelog-dialog');
  await dialog.waitFor({state:'visible'});
  assert.equal(await page.locator('.app-changelog-card h3').textContent(),'Hotori 1.7.10');
  assert.equal(await page.locator('#app-changelog-close').evaluate(el=>el===document.activeElement),true);
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
  const body=catalog.releases.find(r=>r.version==='1.7.8').body;
  await page.getByLabel('App release version').selectOption('1.7.8');
  assert((await page.locator('.app-changelog-card').textContent()).includes('50%'));
  assert(body.includes('50%'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>localStorage.getItem('hotori.appChangelogSeenVersion')==='1.7.10');
  await page.reload(); await page.waitForTimeout(900);
  assert.equal(await dialog.isVisible(),false,'Same version does not reopen');
  await page.getByRole('button',{name:'App Changelog',exact:true}).click();
  await dialog.waitFor({state:'visible'});
  await page.getByLabel('App release version').selectOption('1.0.0');
  assert.equal(await page.locator('.app-changelog-card h3').textContent(),'Hotori 1.0.0');
  await page.setViewportSize({width:560,height:560});
  await page.waitForTimeout(300);
  const box=await dialog.boundingBox();
  assert(box.y>=0&&box.y+box.height<=560);
  await page.locator('#app-changelog-content').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.screenshot({path:'target/qa/app-changelog-560.png'});
  await page.locator('#app-changelog-close').click();
  await page.evaluate(()=>localStorage.setItem('hotori.appChangelogSeenVersion','1.7.8'));
  await page.evaluate(()=>localStorage.setItem('testOfferUpdate','yes'));
  await page.reload(); await dialog.waitFor({state:'visible'});
  assert.equal(await page.locator('.app-changelog-card h3').textContent(),'Hotori 1.7.10');
  assert.equal(await page.locator('#app-update-dialog').isVisible(),false);
  await page.locator('#app-changelog-close').click();
  await page.locator('#app-update-dialog').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.installs),0);
  console.log('PASS first/new version prompt, dismiss/relaunch, manual app-only history, current selection, small-window scrolling and no automatic install');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
