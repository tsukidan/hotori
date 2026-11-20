// Build/import a pinned Vencord runtime. Never reads a user's Vencord settings.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'), plugin=path.join(root,'vendor/true-liquid-glass');
const args=process.argv.slice(2), option=k=>args[args.indexOf(k)+1];
const spec=JSON.parse(fs.readFileSync(path.join(plugin,'UPSTREAM.json')));
const checkout=path.resolve(args.includes('--checkout')?option('--checkout'):path.join(root,'target/vencord-build'));
const out=path.join(root,'assets/true-glass');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...a)=>cp.execFileSync('git',['-C',checkout,...a],{encoding:'utf8',windowsHide:true}).trim();
const list=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(p,e.name)):e.isFile()?[path.join(p,e.name)]:[]);
if(!fs.existsSync(path.join(checkout,'.git'))) {
  cp.execFileSync('git',['clone',spec.repository,checkout],{stdio:'inherit',windowsHide:true});
  cp.execFileSync('git',['-C',checkout,'checkout','--detach',spec.revision],{stdio:'inherit',windowsHide:true});
}
assert.equal(git('rev-parse','HEAD'),spec.revision,'Use the pinned upstream checkout');
assert.equal(git('status','--porcelain','--untracked-files=no'),'','Upstream tracked source must be clean');
const slot=path.join(checkout,'src/userplugins/hotoriTrueLiquidGlass.desktop');
const siblings=fs.existsSync(path.dirname(slot))?fs.readdirSync(path.dirname(slot)).filter(n=>n!==path.basename(slot)):[];
assert.equal(siblings.length,0,'Distribution must not contain other user plugins');
if(!args.includes('--reuse-build')) {
  fs.mkdirSync(slot,{recursive:true});
  for(const name of ['index.ts','native.ts','src'])fs.cpSync(path.join(plugin,name),path.join(slot,name),{recursive:true});
  const env={...process.env,SOURCE_DATE_EPOCH:String(Number(git('show','-s','--format=%ct',spec.revision))*1000),VENCORD_HASH:spec.revision.slice(0,7)};
  const run=command=>cp.execSync(command,{cwd:checkout,env,stdio:'inherit',windowsHide:true});
  run('pnpm install --frozen-lockfile');run('pnpm build '+spec.flags.join(' '));run('pnpm exec tsc --noEmit');
}
// Verify that both native and renderer maps were produced from this exact plugin
// and pinned upstream source. Maps are inspected, not distributed.
const seen=new Set();
for(const name of ['patcher.js','renderer.js','preload.js','renderer.css']) {
  const map=JSON.parse(fs.readFileSync(path.join(checkout,'dist',name+'.map')));
  for(let i=0;i<map.sources.length;i++) {
    const source=map.sources[i].replaceAll('\\','/');
    if(source.startsWith('../src/userplugins/')) {
      assert(source.startsWith('../src/userplugins/hotoriTrueLiquidGlass.desktop/'),'Unexpected user plugin in build');
      const relative=source.slice('../src/userplugins/hotoriTrueLiquidGlass.desktop/'.length);
      assert.equal(map.sourcesContent[i],fs.readFileSync(path.join(plugin,relative),'utf8'),'Plugin source mismatch: '+relative);seen.add(relative);
    } else if(source.startsWith('../src/')||source.startsWith('../scripts/')) {
      const relative=source.slice(3);
      assert.equal(map.sourcesContent[i],cp.execFileSync('git',['-C',checkout,'show',spec.revision+':'+relative],{encoding:'utf8',windowsHide:true}),'Upstream source mismatch: '+relative);
    }
  }
}
for(const name of ['index.ts','native.ts','src/runtime.js','src/renderer.js','src/companion-native.js','src/local-wallpaper.js'])assert(seen.has(name),'Build missing '+name);
const outputNames=['patcher.js','preload.js','renderer.js','renderer.css','patcher.js.LEGAL.txt','renderer.js.LEGAL.txt'];
for(const name of ['patcher.js','renderer.js']){
  const data=fs.readFileSync(path.join(checkout,'dist',name),'utf8');
  assert(data.includes('HotoriTrueLiquidGlass'));assert(data.includes('Updater Disabled: true'));assert(data.includes('Standalone: true'));
}
fs.mkdirSync(out,{recursive:true});
const entries=[];
function put(name,data){assert(!name.includes('..')&&!path.isAbsolute(name));const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);entries.push({path:name,size:data.length,sha256:hash(data)});}
for(const name of outputNames){let data=fs.readFileSync(path.join(checkout,'dist',name));if(/\.(js|css)$/.test(name))data=Buffer.from(data.toString().replace(/^\/\/# sourceMappingURL=.*$/gm,'').replace(/\/\*# sourceMappingURL=.*?\*\//g,''));put('dist/'+name,data);}
put('dist/package.json',Buffer.from('{}\n'));
put('licenses/Vencord-GPL-3.0.txt',fs.readFileSync(path.join(checkout,'LICENSE')));
put('licenses/LiquidGlass-MIT.txt',fs.readFileSync(path.join(plugin,'src/vendor/LICENSE')));
put('licenses/LiquidGlass-NOTICE.md',fs.readFileSync(path.join(plugin,'src/vendor/NOTICE.md')));
put('licenses/Apache-2.0.txt',fs.readFileSync(path.join(plugin,'licenses/Apache-2.0.txt')));
const mit=fs.readFileSync(path.join(plugin,'src/vendor/LICENSE'),'utf8');
put('licenses/Third-party-MIT.txt',Buffer.from('Copyright notices for vendored dependencies are retained in the generated .LEGAL.txt files and corresponding sources.\n\n'+mit.slice(mit.indexOf('Permission is hereby granted'))));
// Retain dependency license texts using only packages mapped into the shipped bundles.
const packages=new Set();for(const name of ['patcher.js','renderer.js','preload.js']){const map=JSON.parse(fs.readFileSync(path.join(checkout,'dist',name+'.map')));for(const source of map.sources){const full=path.resolve(checkout,'dist',source);if(!full.includes(path.sep+'node_modules'+path.sep))continue;let parent=path.dirname(full);while(parent.startsWith(checkout)){if(fs.existsSync(path.join(parent,'package.json'))){packages.add(parent);break;}parent=path.dirname(parent);}}}
for(const pkg of packages){const json=JSON.parse(fs.readFileSync(path.join(pkg,'package.json')));const tag=(json.name+'-'+json.version).replaceAll('/','_').replaceAll('@','');for(const file of fs.readdirSync(pkg)){if(/^(licen[cs]e|copying|notice)(\.|$)/i.test(file)&&fs.statSync(path.join(pkg,file)).isFile())put('licenses/dependencies/'+tag+'/'+file,fs.readFileSync(path.join(pkg,file)));}}
const archive=path.join(root,'target/vencord-corresponding-source.zip');fs.mkdirSync(path.dirname(archive),{recursive:true});cp.execFileSync('git',['-C',checkout,'archive','--format=zip','--output='+archive,spec.revision],{windowsHide:true});put('sources/vencord.zip',fs.readFileSync(archive));
for(const file of list(plugin)){const rel=path.relative(plugin,file).replaceAll('\\','/');put('sources/plugin/'+rel,fs.readFileSync(file));}
put('sources/BUILD.txt',Buffer.from('Pinned Vencord '+spec.revision+' (GPL-3.0-or-later). Extract vencord.zip, copy plugin/index.ts, native.ts and src/ to src/userplugins/hotoriTrueLiquidGlass.desktop/. Install the pnpm version in package.json. In PowerShell set $env:VENCORD_HASH="e75ac9a" before building the archive without Git metadata. Run pnpm install --frozen-lockfile, then pnpm build --dev --standalone --disable-updater. The installer repository scripts/build-true-glass.mjs validates maps and packages this source. Runtime updater is owned by Hotori; update upstream pin regularly and test before publishing. Plugin source contains the MIT-licensed optical renderer; retain its notices.\n'));
entries.sort((a,b)=>a.path.localeCompare(b.path));
const baselines=[];
function baseline(dir,label,stock=false){
  if(stock){for(const name of ['patcher.js','preload.js','renderer.js']){const m=JSON.parse(fs.readFileSync(path.join(dir,name+'.map')));for(let i=0;i<m.sources.length;i++){const s=m.sources[i].replaceAll('\\','/');assert(!s.includes('userplugins'),'Custom stock baseline rejected');if(s.startsWith('../src/')||s.startsWith('../scripts/'))assert.equal(m.sourcesContent[i],cp.execFileSync('git',['-C',checkout,'show',spec.revision+':'+s.slice(3)],{encoding:'utf8',windowsHide:true}));}}}
  const files={};for(const file of fs.readdirSync(dir)){assert(fs.statSync(path.join(dir,file)).isFile());files[file]=hash(fs.readFileSync(path.join(dir,file)));}baselines.push({label,files});
}
if(args.includes('--stock-baseline'))baseline(path.resolve(option('--stock-baseline')),'verified-stock-'+spec.revision,true);
// This is the tested pre-integration build, whose exact sources were verified above.
const legacyNames=[...outputNames,...['patcher.js.map','preload.js.map','renderer.js.map','renderer.css.map']];
const legacy={};for(const name of legacyNames)legacy[name]=hash(fs.readFileSync(path.join(checkout,'dist',name)));legacy['package.json']=baselines[0]?.files['package.json'] || hash(Buffer.from('{}\n'));
baselines.push({label:'tested-pre-integration-runtime',files:legacy});
const existing=path.join(out,'bundle.json');if(fs.existsSync(existing)){for(const b of JSON.parse(fs.readFileSync(existing)).baselines||[])if(!baselines.some(x=>JSON.stringify(x.files)===JSON.stringify(b.files)))baselines.push(b);}
const id=hash(Buffer.from(JSON.stringify(entries))).slice(0,24);
const manifest={schemaVersion:1,id,pluginVersion:spec.pluginVersion,upstreamRevision:spec.revision,files:entries,baselines};
fs.writeFileSync(existing,JSON.stringify(manifest,null,2)+'\n');
// Stale previous payload files are not included in the embedded allowlist.
fs.writeFileSync(path.join(root,'src/runtime_payload.rs'),'// Generated by scripts/build-true-glass.mjs.\npub const MANIFEST: &str = include_str!("../assets/true-glass/bundle.json");\npub const FILES: &[(&str, &[u8])] = &[\n'+entries.map(e=>'    ('+JSON.stringify(e.path)+', include_bytes!('+JSON.stringify('../assets/true-glass/'+e.path)+')),').join('\n')+'\n];\n');
console.log('Packaged runtime '+id+': '+entries.length+' verified files; '+entries.reduce((s,e)=>s+e.size,0)+' bytes. No settings, status, rollback or node_modules included.');
