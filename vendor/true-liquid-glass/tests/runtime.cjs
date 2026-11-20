const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  const dependencyRoot = process.env.HOTORI_TEST_DEPENDENCIES;
  if (!dependencyRoot) throw new Error('Install Playwright for testing, or set HOTORI_TEST_DEPENDENCIES to an existing package directory.');
  ({ chromium } = createRequire(path.join(dependencyRoot, 'package.json'))('playwright'));
}
const html = `<!doctype html><style>
body{margin:0;--blur-profile:1;--main-bg:url('/wallpaper.svg');--bg-overlay-top:rgba(0,0,0,.2);--bg-overlay-bottom:rgba(0,0,0,.5);--glass-background:rgba(12,16,24,.24);--liquid-blur-val:2.5px;--liquid-saturation:220%}
.panel{position:absolute;top:50px;left:50px;width:240px;height:320px;border-radius:20px;background:#333}.second{left:340px}
.membersWrap_fixture{border-radius:0;overflow:hidden;width:72px;transition:width 120ms linear}
.membersWrap_fixture:hover{width:240px}
.members_fixture{height:100%;overflow:auto;border-radius:24px;background:#456}
.member_fixture{height:1000px}
</style><div class="panel sidebarList_fixture"><button id="control">Native control</button></div><div class="panel second membersWrap_fixture"><div class="members_fixture"><div class="member_fixture">Members</div></div></div>
<nav class="guilds_fixture" style="position:absolute;left:5px;top:50px;width:36px;height:320px;border-radius:16px;background:#345;overflow:hidden"><div id="servers" style="height:100%;overflow:auto"><button id="server">S</button><div style="height:900px"></div></div></nav><div class="channelTextArea_fixture" style="position:absolute;left:60px;top:430px;width:500px;height:64px;border-radius:16px;background:#345"><div id="editor" role="textbox" contenteditable="true" style="min-height:32px"></div></div><script type="module">import {GlassRuntime} from '/src/runtime.js';window.runtime = new GlassRuntime({enabled:true});runtime.start();</script>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="40" height="80" fill="#77aadd"/><rect x="40" width="40" height="80" fill="#dd8855"/></pattern></defs><rect width="800" height="600" fill="url(#p)"/></svg>';
(async () => {
 const server = http.createServer(async(req,res) => {
   const pathname = new URL(req.url,'http://localhost').pathname;
   if (pathname === '/') { res.setHeader('Content-Type','text/html'); return res.end(html); }
   if (pathname === '/wallpaper.svg') { res.setHeader('Content-Type','image/svg+xml'); return res.end(svg); }
   const file = path.resolve(root, '.' + pathname);
   if (!file.startsWith(root + path.sep)) {res.writeHead(403);return res.end();}
   try {res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));} catch {res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
   browser = await chromium.launch({channel:'msedge',headless:true});
   const page = await browser.newPage({viewport:{width:900,height:650}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.waitForFunction(()=>window.runtime?.getStats().state==='active');
   assert.equal(await page.locator('.hotori-true-glass-output').count(),4);
   const paints = await page.evaluate(()=>runtime.getStats().paints);
   await page.waitForTimeout(1200);
   assert.equal(await page.evaluate(()=>runtime.getStats().paints),paints,'idle must not repaint');
   assert.equal(await page.evaluate(()=>document.elementFromPoint(90,60)?.id),'control','canvas must not intercept hit testing');
   await page.locator('#server').click();
   await page.locator('#editor').fill('Native typing stays editable');
   assert.equal(await page.locator('#editor').innerText(),'Native typing stays editable');
   await page.addStyleTag({content:'.channelTextArea_fixture::before{content:"";position:absolute;inset:0;z-index:-1;background:#234;backdrop-filter:blur(3px);pointer-events:none}'});
   const inputFilter = () => page.locator('.channelTextArea_fixture').evaluate(el=>getComputedStyle(el,'::before').backdropFilter);
   assert.equal(await inputFilter(),'none','autocomplete background must not duplicate the optical layer');
   await page.evaluate(()=>document.querySelector('#servers').scrollTop=90);
   assert.equal(await page.locator('#servers').evaluate(el=>el.scrollTop),90);
   const memberGeometry = () => page.evaluate(() => {
     const wrap = document.querySelector('.second'), surface = wrap.querySelector('.members_fixture');
     const canvas = wrap.querySelector('canvas'), ctx = canvas.getContext('2d');
     return { width: wrap.getBoundingClientRect().width, top: canvas.getBoundingClientRect().top,
       corner: ctx.getImageData(20,20,1,1).data[3], center: ctx.getImageData(canvas.width/2,canvas.height/2,1,1).data[3],
       overflow: getComputedStyle(surface).overflowY, scroll: surface.scrollTop };
   });
   const compact = await memberGeometry();
   assert.equal(compact.width,72);
   assert.equal(compact.corner,0,'output must clip the inner surface rounded corner');
   assert(compact.center>0);
   await page.evaluate(() => { document.querySelector('.members_fixture').scrollTop=100; });
   const scrolled = await memberGeometry();
   assert.equal(scrolled.scroll,100); assert.equal(scrolled.top,compact.top);
   assert.equal(scrolled.overflow,'auto');
   await page.evaluate(() => {
     const render = runtime.renderer.renderGlassPanel.bind(runtime.renderer);
     runtime.renderer.renderGlassPanel = (config,...args) => { if(args[1]===320 && args[0]===document.querySelector('.second').getBoundingClientRect().width) { window.lastRadius=config.cornerRadius; window.memberBevel=config.zRadius; } return render(config,...args); };
     document.querySelector('.members_fixture').style.borderRadius='30px'; runtime.schedule();
   });
   await page.waitForFunction(() => window.lastRadius===30);
   assert.equal(await page.evaluate(()=>window.memberBevel),18,'collapsed bevel must flatten before the center');
   await page.evaluate(() => {
     document.querySelector('.members_fixture').style.borderRadius='0px'; runtime.schedule();
   });
   await page.waitForFunction(() => window.lastRadius===16);
   assert.equal((await memberGeometry()).corner,0,'Hotori zero-radius list still gets a rounded optical panel');
   await page.evaluate(() => {
     document.querySelector('.second').style.borderRadius='18px'; runtime.schedule();
   });
   await page.waitForFunction(() => window.lastRadius===18);
   await page.evaluate(() => {
     document.querySelector('.members_fixture').style.borderRadius='30px'; runtime.schedule();
   });
   await page.waitForFunction(() => window.lastRadius===30);
   await page.hover('.second');
   await page.waitForFunction(() => document.querySelector('.second').getBoundingClientRect().width===240);
   await page.waitForTimeout(100);
   assert.equal((await memberGeometry()).corner,0);
   assert.equal(await page.evaluate(()=>window.memberBevel),60,'expanded list restores full bevel');
   await page.mouse.move(800,600);
   await page.waitForFunction(() => document.querySelector('.second').getBoundingClientRect().width===72);
   await page.waitForTimeout(100);
   const beforeMove = await page.evaluate(()=>runtime.getStats().paints);
   await page.evaluate(()=>document.querySelector('.second').style.left='380px');
   await page.waitForFunction(old=>runtime.getStats().paints>old,beforeMove);
   const moved = await page.evaluate(()=>runtime.getStats().paints);
   assert.equal(moved,beforeMove+1,'only moved panel repaints');
   await page.evaluate(()=>document.querySelector('.hotori-true-glass-output').remove());
   await page.waitForFunction(()=>document.querySelectorAll('.hotori-true-glass-output').length===4);
   await page.evaluate(()=>document.body.style.setProperty('--main-bg','linear-gradient(red,blue)'));
   await page.waitForFunction(()=>runtime.getStats().state==='fallback');
   const failedGeneration=await page.evaluate(()=>runtime.generation);
   await page.waitForTimeout(1100);
   assert.equal(await page.evaluate(()=>runtime.generation),failedGeneration,'invalid source must not retry indefinitely');
   await page.evaluate(()=>document.body.style.setProperty('--main-bg',"url('/wallpaper.svg')"));
   await page.waitForFunction(()=>runtime.getStats().state==='active');
   await page.evaluate(()=>document.body.style.setProperty('--blur-profile','0'));
   await page.waitForFunction(()=>runtime.getStats().state==='suspended');
   assert.equal(await page.locator('.hotori-true-glass-output').count(),0);
   await page.evaluate(()=>document.body.style.setProperty('--blur-profile','1'));
   await page.waitForFunction(()=>runtime.getStats().state==='active');
   await page.evaluate(()=>runtime.update({enabled:false}));
   assert.equal(await page.locator('.hotori-true-glass-output').count(),0);
   assert.equal(await page.locator('.members_fixture').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(68, 85, 102)');
   assert.equal(await page.locator('.members_fixture').evaluate(el=>el.scrollTop),100);
   assert.equal(await page.locator('.guilds_fixture').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(51, 68, 85)');
   assert.equal(await page.locator('.channelTextArea_fixture').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(51, 68, 85)');
   assert.equal(await page.locator('#editor').innerText(),'Native typing stays editable');
   assert.equal(await inputFilter(),'blur(3px)','disabled restores autocomplete CSS background');
   await page.evaluate(()=>{runtime.update({enabled:true});runtime.schedule();});
   await page.waitForFunction(()=>runtime.getStats().state==='active');
   const loss = await page.evaluate(()=>{const gl=runtime.renderer.gl;const ext=gl.getExtension('WEBGL_lose_context'); if(!ext)return false; window.lossExtension=ext;ext.loseContext();return true;});
   if(loss){await page.waitForFunction(()=>runtime.getStats().state==='context-lost');assert.equal(await page.locator('.hotori-true-glass-output').count(),0);await page.evaluate(()=>lossExtension.restoreContext());await page.waitForFunction(()=>runtime.getStats().state==='active');}
   await page.evaluate(async()=>{
     const image=document.createElement('canvas');image.width=image.height=64;
     const ctx=image.getContext('2d');ctx.fillStyle='#5689ab';ctx.fillRect(0,0,64,64);
     const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
     const bytes=new Uint8Array(await blob.arrayBuffer());
     window.localLoads=0; window.revocations=0;
     const revoke=URL.revokeObjectURL.bind(URL);
     URL.revokeObjectURL=url=>{revocations++;revoke(url);};
     runtime.options.resolveLocalWallpaper=async uri=>{localLoads++;return {mime:'image/png',bytes};};
     document.body.style.setProperty('--main-bg',"url('vencord:///themes/hotori-assets/0123456789abcdef.png')");
   });
   await page.waitForFunction(()=>localLoads===1 && runtime.getStats().state==='active');
   assert.equal(await page.evaluate(()=>revocations),1,'local image Blob URL must be released after decoding');
   await page.evaluate(()=>runtime.stop());
   assert.equal(await page.locator('.hotori-true-glass-output,.hotori-true-glass-host').count(),0);
   assert.equal(await page.evaluate(()=>runtime.getStats().renderer),null);
   assert.deepEqual(errors,[]);
   console.log('PASS: four panels, idle cache, hit testing, movement, profile gating, disable/re-enable, context recovery, cleanup. No Discord performance claim.');
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

