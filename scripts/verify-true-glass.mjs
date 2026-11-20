import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),base=path.join(root,'assets/true-glass');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'bundle.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.id,hash(Buffer.from(JSON.stringify(manifest.files))).slice(0,24));
const exeIndex=process.argv.indexOf('--exe'),exe=exeIndex<0?null:fs.readFileSync(process.argv[exeIndex+1]);
if(exe)assert(exe.includes(Buffer.from(manifest.id)),'EXE does not embed the current bundle manifest');
const generated=fs.readFileSync(path.join(root,'src/runtime_payload.rs'),'utf8');
const seen=new Set();
for(const entry of manifest.files){
  assert(!seen.has(entry.path),'Duplicate payload entry');seen.add(entry.path);
  assert(entry.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!/[\\:]/.test(entry.path)&&!path.isAbsolute(entry.path));
  assert(/^(dist|sources|licenses)\//.test(entry.path));
  assert(!/(^|\/)(node_modules|rollback|\.build|\.git|status|settings)(\/|$)/.test(entry.path));
  const bytes=fs.readFileSync(path.join(base,entry.path));assert.equal(bytes.length,entry.size);assert.equal(hash(bytes),entry.sha256);
  assert(generated.includes(JSON.stringify('../assets/true-glass/'+entry.path)),'Compile-time payload list missing '+entry.path);
  if(exe)assert(exe.includes(bytes),'EXE missing embedded payload '+entry.path);
  if(entry.path.startsWith('sources/plugin/'))assert.equal(hash(fs.readFileSync(path.join(root,'vendor/true-liquid-glass',entry.path.slice('sources/plugin/'.length)))),entry.sha256,'Rebuild payload after plugin source changes');
}
for(const name of ['patcher.js','renderer.js']){const text=fs.readFileSync(path.join(base,'dist',name),'utf8');assert(text.includes('Updater Disabled: true'));assert(text.includes('Standalone: true'));assert(text.includes('HotoriTrueLiquidGlass'));assert(!text.includes('sourceMappingURL='));}
for(const name of ['dist/preload.js','dist/renderer.css','licenses/Vencord-GPL-3.0.txt','licenses/LiquidGlass-MIT.txt','sources/vencord.zip'])assert(seen.has(name));
console.log('Verified bundle '+manifest.id+', source/license completeness, disabled upstream updater'+(exe?', and payload embedded in release EXE.':'.'));
