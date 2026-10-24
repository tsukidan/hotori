const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
(async () => {
  const root = path.resolve(__dirname, '..'), qa = path.join(root, 'target/qa');
  const upstream = JSON.parse(await fs.readFile(path.join(__dirname,'fixtures/liquidglass-upstream.json'),'utf8'));
  const shipped = (await fs.readFile(path.join(root,'web/vendor/liquidglass/liquidglass.js'),'utf8')).replace(/\r\n/g,'\n');
  const cachePatch = `      while (this.fboCache.size > 32) {\n        const oldest = this.fboCache.keys().next().value;\n        this._freeFBOSet(this.fboCache.get(oldest));\n        this.fboCache.delete(oldest);\n      }\n`;
  for (const block of upstream.blocks) {
    const start=shipped.indexOf(block.begin), end=shipped.indexOf(block.end,start+block.begin.length);
    assert(start>=0 && end>start);
    const original=shipped.slice(start,end).replace(cachePatch,'');
    assert.equal(createHash('sha256').update(original).digest('hex'),block.sha256,`The pinned upstream optical implementation changed: ${block.begin}`);
  }
  const server = http.createServer(async (request, response) => {
    try {
      const file = path.join(root, 'web', new URL(request.url, 'http://localhost').pathname);
      response.setHeader('Content-Type', ({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpeg':'image/jpeg'})[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const density of [1, 2]) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: density });
      const warnings = [];
      page.on('console', message => { if (message.type() === 'warning' && /capture|fallback/i.test(message.text())) warnings.push(message.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await page.waitForFunction(() => document.documentElement.dataset.glassRenderer === 'reference-liquidglass');
      await page.addStyleTag({ content: '#app {visibility:hidden!important} .comparison-probe{position:fixed!important;left:200px;top:180px;width:240px;height:140px;min-height:0!important;padding:0!important;border:0!important;border-radius:60px;z-index:20!important} .comparison-text-layout{position:fixed;inset:0;display:grid;grid-template-columns:215px 210px 1fr;grid-template-rows:205px 80px 1fr;pointer-events:none;z-index:10} .comparison-text{grid-area:2/2;margin:0;font:20px/26px "Segoe UI";letter-spacing:normal;color:white;white-space:pre-line;}' });
      await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
        const context = canvas.getContext('2d');
        for (let y=0;y<900;y+=12) for(let x=0;x<1600;x+=12){context.fillStyle=(x/12+y/12)%2?'#176785':'#e0b467';context.fillRect(x,y,12,12);}
        const image = canvas.toDataURL();
        document.querySelector('.wallpaper').style.cssText=`inset:0;background-image:url("${image}");background-size:cover`;
        const probe = document.createElement('div'); probe.className='button comparison-probe'; document.body.append(probe);
        window.comparisonImage=image;
      });
      await page.waitForFunction(() => document.querySelector('.comparison-probe').classList.contains('shader-glass'));
      for (const name of ['frosted','hero','text','layers']) {
        const result = await page.evaluate(async name => {
          const probe=document.querySelector('.comparison-probe');
          const config={...HotoriLiquidGlass.DEFAULTS,blurAmount:.25,cornerRadius:60};
          if(name==='hero') Object.assign(config,{blurAmount:.3,refraction:1.2,chromAberration:.2,zRadius:60,brightness:-.2});
          if(name==='text') {
            const layout=document.createElement('div');layout.className='comparison-text-layout';
            const text=document.createElement('p');text.className='comparison-text';text.textContent='Captured foreground\nText and icons below\nThe actual glass lens';layout.append(text);document.body.append(layout);
          }
          probe.dataset.config=JSON.stringify(config);
          if(name==='layers'){
            const prior=document.createElement('div');prior.className='button comparison-underlay';prior.style.cssText='position:fixed;left:160px;top:140px;width:320px;height:180px;min-height:0;padding:0;border:0;border-radius:40px;z-index:15';prior.dataset.config=JSON.stringify({...HotoriLiquidGlass.DEFAULTS,blurAmount:.25,cornerRadius:40});document.body.append(prior);
          }
          const iframe=document.createElement('iframe');iframe.style.cssText='position:fixed;inset:0;width:1600px;height:900px;border:0;opacity:0;pointer-events:none';iframe.setAttribute('data-glass-exclude','');document.body.append(iframe);
          const doc=iframe.contentDocument;doc.open();doc.write('<!doctype html><html><head></head><body style="margin:0"><div id="root" style="position:relative;width:1600px;height:900px;display:grid;grid-template-columns:215px 210px 1fr;grid-template-rows:205px 80px 1fr"></div></body></html>');doc.close();
          await new Promise((resolve,reject)=>{const script=doc.createElement('script');script.src=location.origin+'/vendor/liquidglass/liquidglass.js';script.onload=resolve;script.onerror=reject;doc.head.append(script);});
          const root=doc.getElementById('root'),image=doc.createElement('img');image.src=window.comparisonImage;image.style.cssText='position:absolute;inset:0;width:1600px;height:900px;z-index:0';root.append(image);await image.decode();
          if(name==='text'){const text=doc.createElement('p');text.style.cssText='grid-area:2/2;margin:0;font:20px/26px "Segoe UI";letter-spacing:normal;color:white;white-space:pre-line;z-index:10';text.textContent='Captured foreground\nText and icons below\nThe actual glass lens';root.append(text);}
          const glass=doc.createElement('div');glass.style.cssText='position:absolute;left:200px;top:180px;width:240px;height:140px;z-index:20';glass.dataset.config=JSON.stringify(config);root.append(glass);
          const glasses=[glass];
          if(name==='layers'){
            const prior=doc.createElement('div');prior.style.cssText='position:absolute;left:160px;top:140px;width:320px;height:180px;z-index:15';prior.dataset.config=JSON.stringify({...HotoriLiquidGlass.DEFAULTS,blurAmount:.25,cornerRadius:40});root.insertBefore(prior,glass);glasses.unshift(prior);
          }
          const instance=await iframe.contentWindow.HotoriLiquidGlass.LiquidGlass.init({root,glassElements:glasses});
          await new Promise(resolve=>setTimeout(resolve,700));
          const actual=probe.querySelector('canvas'),expected=instance.glassCanvases.get(glass);
          const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
          let total=0,max=0,changed=0;
          if(a.length!==b.length) throw new Error(`Canvas shape mismatch ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`);
          for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);total+=difference;max=Math.max(max,difference);if(difference>3)changed++;}
          const proof={name,dpr:devicePixelRatio,meanError:total/a.length,maxError:max,changedChannels:changed,actual:actual.toDataURL(),reference:expected.toDataURL()};
          instance.destroy();iframe.remove();document.querySelector('.comparison-text-layout')?.remove();document.querySelector('.comparison-underlay')?.remove();
          return proof;
        }, name);
        results.push(result);
        assert(result.meanError < (name==='text' ? 2 : .05), JSON.stringify({...result,actual:undefined,reference:undefined}));
        console.log('Reference comparison:',JSON.stringify({...result,actual:undefined,reference:undefined}));
      }
      assert.deepEqual(warnings,[]);
      await page.close();
    }
    await fs.mkdir(qa,{recursive:true});
    const html=`<!doctype html><meta charset="utf-8"><title>Hotori reference comparison</title><style>body{background:#171820;color:#fff;font:16px system-ui;padding:28px}h1{font-size:24px}.case{display:inline-block;vertical-align:top;margin:0 24px 28px 0;padding:20px;background:#232630;border-radius:20px}.pair{display:flex;gap:20px}img{width:280px;height:180px;background:#526372}small{color:#bac3d0}</style><h1>Hotori and the original LiquidGlass renderer</h1><p>Identical source, dimensions, material settings and display density. No custom optical shader.</p>${results.filter(r=>r.dpr===1).map(r=>`<section class="case"><h2>${r.name}</h2><div class="pair"><div>Original library<br><img src="${r.reference}"></div><div>Hotori adapter<br><img src="${r.actual}"></div></div><small>Mean channel error: ${r.meanError.toFixed(4)} / 255</small></section>`).join('')}`;
    await fs.writeFile(path.join(qa,'liquidglass-reference-comparison.html'),html);
    const proof=await browser.newPage({viewport:{width:1320,height:930}});await proof.setContent(html);await proof.screenshot({path:path.join(qa,'liquidglass-reference-comparison.png'),fullPage:true});await proof.close();
    await fs.writeFile(path.join(qa,'liquidglass-reference-results.json'),JSON.stringify(results.map(({actual,reference,...metrics})=>metrics),null,2));
    console.log('PASS: original-library comparisons at DPR 1 and 2, including captured foreground text.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
