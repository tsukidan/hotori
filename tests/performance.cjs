// Deterministic workload/counters; timing is reported, never a machine-specific
// FPS gate. Run: node tests/performance.cjs --label baseline (or optimized).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..');
  const qa = path.join(root, 'target/qa');
  const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'current';
  const sourceRef = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : null;
  assert(/^[a-z0-9-]+$/i.test(label));
  if(sourceRef) assert(/^[a-z0-9/_-]+$/i.test(sourceRef));
  await fs.mkdir(qa, { recursive: true });
  const frozen = new Map();
  // Freeze implementation assets now so parallel edits do not alter a run.
  for (const name of ['index.html','styles.css','liquid-glass.css','settings-preview.css','app-motion.css','typography.css','app-motion.js','wallpaper-accent.js','wallpaper-tools.js','app-changelog.js','app.js','ui-zoom.js','liquid-glass.js','glass-wordmark.js','glass-shader.js','vendor/liquidglass/liquidglass.js']) {
    try { frozen.set(name, sourceRef ? execFileSync('git',['show',`${sourceRef}:web/${name}`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore']}) : await fs.readFile(path.join(root,'web',name))); } catch {}
  }
  const instrument = `\n;(()=>{const vendor=window.HotoriLiquidGlass; const stats=window.perfStats;
    for(const name of ['renderGlassPanel','uploadAndBlur']) {const original=vendor.GlassRenderer.prototype[name];vendor.GlassRenderer.prototype[name]=function(...args){const start=performance.now();stats[name]++;try{return original.apply(this,args)}finally{stats[name+'Ms']+=performance.now()-start}}}
    const capture=vendor.toCanvas;vendor.toCanvas=function(...args){stats.captures++;stats.pendingCaptures++;const target=args[0].tagName+'.'+args[0].className;stats.captureTargets[target]=(stats.captureTargets[target]||0)+1;const start=performance.now();return capture.apply(this,args).finally(()=>{stats.pendingCaptures--;stats.captureMs+=performance.now()-start})};
  })();`;
  const server = http.createServer(async (request,response) => {
    try {
      const name = decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\//,'');
      let data = frozen.get(name) || await fs.readFile(path.join(root,'web',name));
      if(name==='vendor/liquidglass/liquidglass.js') data=Buffer.from(data.toString()+instrument);
      response.setHeader('Content-Type', ({'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpeg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'})[path.extname(name)] || 'application/octet-stream');
      response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1600,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(() => {
      window.perfStats={renderGlassPanel:0,renderGlassPanelMs:0,uploadAndBlur:0,uploadAndBlurMs:0,captures:0,captureMs:0,pendingCaptures:0,dataURLs:0,dataURLMs:0,drawImages:0,drawImageMs:0,captureTargets:{},longTasks:[]};
      const encode=HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL=function(...args){const start=performance.now();window.perfStats.dataURLs++;try{return encode.apply(this,args)}finally{window.perfStats.dataURLMs+=performance.now()-start}};
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(...args){const start=performance.now();window.perfStats.drawImages++;try{return draw.apply(this,args)}finally{window.perfStats.drawImageMs+=performance.now()-start}};
      try {new PerformanceObserver(list=>window.perfStats.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({entryTypes:['longtask']});}catch{}
      const fields=[
        {name:'--blur-profile',label:'Glass Profile',section:'Glass appearance',kind:'choice',value:'Acrylic',choices:['Acrylic','Liquid Glass','No Glass'],choiceHints:['','',''],hint:'Choose your material.'},
        ...Array.from({length:36},(_,index)=>({name:'--performance-'+index,label:'Appearance option '+(index+1),section:'Glass appearance',kind:'number',value:'24',hint:'A generic appearance option for the scrolling performance workload.',choices:[],choiceHints:[]})),
        {name:'--main-bg',label:'Main Background',section:'Wallpapers',kind:'image',value:'',choices:[],choiceHints:[],hint:'Choose a wallpaper.'},
        {name:'--settings-bg',label:'Settings Background',section:'Wallpapers',kind:'image',value:'',choices:[],choiceHints:[],hint:'Choose a wallpaper.'},
      ];
      window.__TAURI__={core:{invoke:async command=>{
        if(command==='get_status')return {ready:true,installed:true,theme_version:'0.9.2'};
        if(command==='check_app_update'||command==='check_theme_update')return {available:false};
        if(command==='load_settings')return structuredClone(fields);
        if(command==='get_app_changelog')return {schemaVersion:1,currentVersion:'test',releases:[]};
        if(command==='get_theme_changelog')return {schemaVersion:1,releases:[]};
        if(command==='show_main_window')return;
        throw Error(command);
      }}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(()=>document.documentElement.dataset.glassRenderer==='reference-liquidglass');
    await page.waitForTimeout(1800);
    async function phase(name,selector,duration=1500,scroll=false) {
      const result=await page.evaluate(async ({selector,duration,scroll})=>{
        const element=document.querySelector(selector);
        const before=structuredClone(window.perfStats),started=performance.now(),intervals=[];
        let prior=started,frames=0;
        await new Promise(resolve=>{
          const tick=now=>{intervals.push(now-prior);prior=now;frames++;
            if(scroll){const max=element.scrollHeight-element.clientHeight;element.scrollTop=max*(.5-.5*Math.cos(frames*.16));}
            if(now-started<duration)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);
        });
        const elapsed=performance.now()-started,after=window.perfStats,delta={};
        for(const key of ['renderGlassPanel','renderGlassPanelMs','uploadAndBlur','uploadAndBlurMs','captures','captureMs','dataURLs','dataURLMs','drawImages','drawImageMs'])delta[key]=after[key]-before[key];
        delta.captureTargets=Object.fromEntries(Object.entries(after.captureTargets).map(([key,count])=>[key,count-(before.captureTargets[key]||0)]).filter(([,count])=>count>0));
        const sorted=intervals.slice(1).sort((a,b)=>a-b),percentile=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]||0;
        const longTasks=after.longTasks.filter(task=>task.start>=started);
        return {elapsedMs:elapsed,frames,fps:frames/elapsed*1000,p50FrameMs:percentile(.5),p95FrameMs:percentile(.95),maxFrameMs:Math.max(...intervals),longTasks:longTasks.length,longTaskMs:longTasks.reduce((sum,task)=>sum+task.duration,0),...delta,pendingCaptures:after.pendingCaptures,scrollRange:element.scrollHeight-element.clientHeight};
      },{selector,duration,scroll});
      console.log(name,JSON.stringify(result));return {name,...result};
    }
    const phases=[];
    phases.push(await phase('home-idle','body',1400));
    await page.locator('#customize').click();
    await page.getByLabel('Glass Profile',{exact:true}).waitFor();
    await page.waitForTimeout(1000);
    phases.push(await phase('settings-idle','#settings-form',1400));
    phases.push(await phase('settings-scroll','#settings-form',1800,true));
    await page.locator('#settings-form').evaluate(element=>element.scrollTop=0);
    await page.waitForTimeout(600);
    await page.locator('#back').click();
    await page.locator('#installation-guide').click();
    await page.locator('#guide-dialog').waitFor({state:'visible'});
    await page.waitForTimeout(700);
    phases.push(await phase('guide-scroll','#guide-dialog .guide-scroll',1800,true));
    await page.locator('#guide-close').click();
    await page.waitForTimeout(700);
    phases.push(await phase('settled-idle','body',1400));
    if (process.argv.includes('--assert-idle')) {
      await page.evaluate(() => {
        const hidden = document.createElement('div'); hidden.className = 'wallpaper-preview-loader'; hidden.dataset.performanceFixture = 'true';
        const line = document.createElement('span'); line.className = 'preview-loader-line'; hidden.append(line); document.body.append(hidden);
      });
      await page.waitForTimeout(300);
      phases.push(await phase('cosmetic-idle','body',1000));
      const scrolling = phases.find(phase => phase.name === 'settings-scroll');
      assert.equal(scrolling.dataURLs, 0, 'Scrolling must not encode PNGs for control backgrounds');
      assert(!Object.keys(scrolling.captureTargets).some(target => target.startsWith('DIV.setting-row')), 'Empty glass wrappers must not be rasterized');
    }
    assert(phases.find(phase=>phase.name==='settings-scroll').scrollRange>1000,'Workload must actually scroll');
    assert(phases.every(phase=>Number.isFinite(phase.p95FrameMs)&&phase.frames>0));
    assert.deepEqual(errors,[]);
    if(process.argv.includes('--assert-idle')) {
      for(const phase of phases.filter(phase=>phase.name.endsWith('idle'))) {
        assert.equal(phase.uploadAndBlur,0,`${phase.name}: settled idle must not upload or blur glass`);
        assert.equal(phase.captures,0,`${phase.name}: settled idle must not recapture DOM`);
        assert.equal(phase.dataURLs,0,`${phase.name}: settled idle must not encode PNGs`);
      }
    }
    const report={label,sourceRef,recordedAt:new Date().toISOString(),viewport:{width:1600,height:900},sourceHash:crypto.createHash('sha256').update(frozen.get('glass-shader.js')).digest('hex'),phases};
    await fs.writeFile(path.join(qa,`performance-${label}.json`),JSON.stringify(report,null,2)+'\n');
    console.log('PASS: deterministic scrolling workload completed; timings reported without hardware-specific FPS thresholds.');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
