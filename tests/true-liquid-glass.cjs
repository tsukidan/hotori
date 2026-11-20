const { chromium } = require('playwright');
const fs = require('fs/promises'), path = require('path'), http = require('http'), assert = require('assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req,res) => {
    try { const p = new URL(req.url,'http://localhost').pathname;
      res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(p)] || 'application/octet-stream');
      res.end(await fs.readFile(path.join(root,'web',p)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage({ viewport:{width:1280,height:900} }), errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const defaults=[{name:'--blur-profile',label:'Glass Profile',section:'Glass appearance',kind:'choice',value:'Acrylic',choices:['Acrylic','Liquid Glass','No Glass'],choiceHints:['Soft frosted panels.','Clear refractive glass.','No blur.'],hint:'Choose your glass style.'}];
      let fields=JSON.parse(localStorage.getItem('test-fields') || 'null') || defaults;
      window.bridge={config:JSON.parse(localStorage.getItem('test-config') || 'null'),instances:[],error:null};
      window.bridgeWrites=[]; window.bridgeReads=0; window.bridgeFail=false;
      window.__TAURI__={core:{invoke:async(command,args)=>{
        if(command==='get_status') return {ready:true,installed:true,theme_version:'0.9.9'};
        if(command.startsWith('check_')) return {available:false};
        if(command==='load_settings') return structuredClone(fields);
        if(command==='save_settings') { fields=fields.map(f=>({...f,value:args.edits.find(e=>e.name===f.name).value}));localStorage.setItem('test-fields',JSON.stringify(fields));return structuredClone(fields); }
        if(command==='reset_settings') { fields=structuredClone(defaults);localStorage.setItem('test-fields',JSON.stringify(fields));return structuredClone(fields); }
        if(command==='get_true_liquid_glass') { window.bridgeReads++;return structuredClone(window.bridge); }
        if(command==='save_true_liquid_glass') {
          if(window.bridgeFail) throw Error('Atomic replacement failed; previous request preserved.');
          window.bridgeWrites.push(args);
          window.bridge.config={schemaVersion:1,revision:(window.bridge.config?.revision||0)+1,requestedEnabled:args.requestedEnabled,quality:args.quality};
          window.bridge.error=null;localStorage.setItem('test-config',JSON.stringify(window.bridge.config));return structuredClone(window.bridge);
        }
        throw Error(command);
      }}};
    });
    const url=`http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(url);
    const open=async()=>{await page.locator('#customize').click();await page.getByRole('tab',{name:'Glass Appearance',exact:true}).click();};
    await open();
    const profile=page.getByLabel('Glass Profile',{exact:true}), toggle=page.getByRole('switch',{name:'True Liquid Glass',exact:true});
    const save=page.getByRole('button',{name:'Save Glass Appearance',exact:true}), region=page.locator('.true-glass-reveal'), status=page.locator('#true-glass-status');
    const saved=async()=>{await save.click();await page.waitForFunction(()=>document.querySelector('#save-category').disabled);};
    assert.equal(await region.getAttribute('aria-hidden'),'true');
    assert.deepEqual(await page.evaluate(()=>window.bridgeWrites),[],'Opening settings must not create a request');
    await profile.selectOption('Liquid Glass'); await toggle.waitFor({state:'visible'});
    assert.equal(await toggle.isChecked(),false); await toggle.focus();await page.keyboard.press('Space');
    assert(await save.isEnabled());await saved();
    assert.deepEqual(await page.evaluate(()=>window.bridgeWrites),[{requestedEnabled:true,quality:'balanced'}]);
    assert.match(await status.textContent(),/unavailable/); assert.doesNotMatch(await status.textContent(),/Active/);
    await profile.selectOption('Acrylic');await saved();
    assert.equal((await page.evaluate(()=>window.bridgeWrites)).length,1,'Changing profiles preserves the On request');
    await profile.selectOption('Liquid Glass');await saved();assert(await toggle.isChecked());
    const report=async(states, patch={})=>page.evaluate(({states,patch})=>{
      const config=window.bridge.config;
      window.bridge.instances=states.map((state,index)=>({schemaVersion:1,instanceId:`71fb3a2d-4bc0-45ba-81cd-${String(index).padStart(12,'0')}`,pid:123+index,pluginEnabled:true,requestedRevision:config.revision,appliedRevision:config.revision,requestedEnabled:config.requestedEnabled,quality:config.quality,status:state,reason:null,updatedAt:new Date().toISOString(),heartbeatExpiresAt:new Date(Date.now()+10000).toISOString(),...patch}));
      return window.HotoriTrueGlass.refresh();
    },{states,patch});
    await report(['active'],{appliedRevision:0});assert.match(await status.textContent(),/Pending/);
    await report(['active']);assert.match(await status.textContent(),/Active—rendering confirmed/);
    for(const [state,label] of [['suspended','Suspended'],['fallback','Fallback'],['error','Plugin error']]){await report([state]);assert.match(await status.textContent(),new RegExp(label));}
    await report(['active','suspended']);assert.match(await status.textContent(),/Mixed Discord instances: 1 active, 1 suspended/);
    await report(['active'],{heartbeatExpiresAt:new Date(Date.now()-1000).toISOString()});assert.match(await status.textContent(),/unavailable/);
    await report(['active'],{updatedAt:new Date(Date.now()+60000).toISOString()});assert.match(await status.textContent(),/unavailable/);
    await report(['disabled'],{pluginEnabled:false});assert.match(await status.textContent(),/unavailable/);
    await report(['suspended'],{reason:'Waiting for wallpaper.'});assert.match(await status.textContent(),/Waiting for wallpaper/);
    await toggle.uncheck();await page.locator('#back').click();await open();assert(await toggle.isChecked(),'Unsaved drafts are discarded');
    await page.reload();await open();assert(await toggle.isChecked(),'Shared configuration survives restart');
    await toggle.uncheck();await page.evaluate(()=>window.bridgeFail=true);await save.click();
    await page.waitForFunction(()=>document.querySelector('#settings-status').textContent.includes('Atomic replacement failed'));
    assert(await save.isEnabled());assert.equal(await page.evaluate(()=>window.bridge.config.requestedEnabled),true);
    await page.evaluate(()=>window.bridgeFail=false);await saved();assert.equal(await page.evaluate(()=>window.bridge.config.requestedEnabled),false);
    await report(['disabled']);assert.match(await status.textContent(),/Off—plugin acknowledged/);
    await page.locator('#back').click();await page.evaluate(()=>{window.bridge.config.quality='high';});await open();
    await toggle.check();await saved();assert.equal(await page.evaluate(()=>window.bridge.config.quality),'high','Preserve plugin quality');
    await page.evaluate(()=>document.documentElement.style.setProperty('--accent','#8255cc'));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#true-glass-toggle')).backgroundColor==='rgb(130, 85, 204)');
    await fs.mkdir(path.join(root,'target/qa'),{recursive:true});await page.waitForTimeout(300);
    await page.screenshot({path:path.join(root,'target/qa/true-liquid-glass.png')});
    for(const width of [560,800,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('.true-glass-toggle-row').boundingBox();assert(box.x>=0&&box.x+box.width<=width);}
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await region.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    await page.locator('#reset-defaults').click();await page.locator('#reset-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#settings-status').textContent.includes('reset and saved'));
    assert.deepEqual(await page.evaluate(()=>({enabled:window.bridge.config.requestedEnabled,quality:window.bridge.config.quality})),{enabled:false,quality:'balanced'});
    assert.equal(await region.getAttribute('aria-hidden'),'true');
    await page.locator('#back').click();
    await page.evaluate(()=>{localStorage.removeItem('test-config');localStorage.setItem('hotori.true-liquid-glass.v1','on');});
    await page.reload();await open();await profile.selectOption('Liquid Glass');assert(await toggle.isChecked());assert(await save.isEnabled());
    assert.deepEqual(await page.evaluate(()=>window.bridgeWrites),[],'Legacy preference migration requires explicit Save');
    await saved();assert.equal(await page.evaluate(()=>localStorage.getItem('hotori.true-liquid-glass.v1')),null);
    await page.locator('#back').click();const reads=await page.evaluate(()=>window.bridgeReads);await page.waitForTimeout(1250);assert.equal(await page.evaluate(()=>window.bridgeReads),reads,'No polling on home page');
    assert.deepEqual(errors,[]);
    console.log('PASS bridge UI: explicit migration, persisted On/Off, profile suspension, exact revision acknowledgement, mixed/stale statuses, failure retry, quality preservation, reset, motion and layout.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
