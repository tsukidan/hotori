// Real IPC and filesystem coverage using the release EXE and a disposable profile only.
const {chromium}=require('playwright'),{spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..');await fs.mkdir(path.join(root,'target/qa'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'target/qa/native-presets-'));
  const themes=path.join(profile,'Vencord/themes');await fs.mkdir(themes,{recursive:true});
  const theme=path.join(themes,'hotori.theme.css'),original=await fs.readFile(path.join(root,'assets/hotori.theme.css'),'utf8');await fs.writeFile(theme,original);
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const child=spawn(path.join(root,'target/release/hotori.exe'),[],{windowsHide:true,env:{...process.env,APPDATA:profile,LOCALAPPDATA:profile,WEBVIEW2_USER_DATA_FOLDER:path.join(profile,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`},stdio:['ignore','ignore','pipe']});
  let errors='',browser;child.stderr.on('data',data=>errors+=data);
  try{
    let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Native startup failed: '+errors);try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Native WebView startup');
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const page=browser.contexts()[0].pages()[0];await page.waitForFunction(()=>window.__TAURI__?.core?.invoke);
    const result=await page.evaluate(async()=>{
      const invoke=window.__TAURI__.core.invoke;
      const fields=await invoke('load_settings'),edits=fields.map(f=>({name:f.name,value:f.value}));
      const saved=await invoke('save_preset',{name:'Native test preset',edits,companion:{requestedEnabled:true,quality:'high'}}),id=saved[0].id;
      edits.find(e=>e.name==='--main-color').value='#aabbcc';edits.find(e=>e.name==='--message-bubble-self-tint').value='#12345678';
      const overwritten=await invoke('overwrite_preset',{id,edits,companion:{requestedEnabled:false,quality:'low'}});
      let rejected=false;try{await invoke('overwrite_preset',{id:'missing',edits,companion:null});}catch{rejected=true;}
      const loaded=await invoke('list_presets');return{id,overwritten,loaded,rejected};
    });
    assert(result.rejected);assert.equal(result.overwritten.length,1);assert.equal(result.loaded[0].id,result.id);assert.equal(result.loaded[0].name,'Native test preset');assert.equal(result.loaded[0].values['--main-color'],'#aabbcc');assert.equal(result.loaded[0].values['--message-bubble-self-tint'],'#12345678');assert.deepEqual(result.loaded[0].companion,{requestedEnabled:false,quality:'low'});
    assert.equal(await fs.readFile(theme,'utf8'),original,'Native overwrite does not apply the theme');
    const disk=JSON.parse(await fs.readFile(path.join(profile,'Hotori/presets.json'),'utf8'));assert.equal(disk.presets[0].values['--main-color'],'#aabbcc');
    await page.evaluate(id=>window.__TAURI__.core.invoke('apply_preset',{id}),result.id);assert.match(await fs.readFile(theme,'utf8'),/--main-color: #aabbcc;/);
    console.log('PASS native preset IPC: release EXE startup, save/overwrite/read persistence, stable identity/name, alpha, companion preference, missing-ID rejection, unchanged CSS until explicit Apply.');
  }finally{if(browser)await browser.close();if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
