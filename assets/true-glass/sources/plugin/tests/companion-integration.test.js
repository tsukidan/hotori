import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createCompanionNative } from '../src/companion-native.js';
import { CompanionController } from '../src/companion-controller.js';

test('real files round trip through native and controller across restart and invalid requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const directory = mkdtempSync(join(tmpdir(), 'hotori-roundtrip-'));
  const root = join(directory, 'Hotori', 'TrueLiquidGlass');
  mkdirSync(root, { recursive: true });
  const file = join(root, 'config.json');
  const sender = new EventEmitter(); sender.isDestroyed = () => false;
  const event = { sender }, native = createCompanionNative(root);
  const bridge = Object.fromEntries(['open','poll','report','close'].map(name => [name, (...args) => native[name](event, ...args)]));
  const runtimes = [];
  const controller = new CompanionController({ bridge, createRuntime(options) {
    const runtime = { state: 'suspended', stopped: false, options,
      start() {}, stop() { this.stopped = true; }, update(options) { this.options = options; },
      getStats() { return { state: this.state }; } };
    runtimes.push(runtime); return runtime;
  } });
  t.after(() => {controller.stop();rmSync(directory, { recursive: true, force: true });});
  const save = value => { writeFileSync(file + '.tmp', typeof value === 'string' ? value : JSON.stringify(value)); renameSync(file + '.tmp', file); };
  const request = (revision, requestedEnabled, quality = 'balanced') => ({ schemaVersion: 1, revision, requestedEnabled, quality });
  const tick = async () => { t.mock.timers.tick(500); await setImmediate(); };
  const statuses = () => readdirSync(join(root,'status')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(root,'status',n),'utf8')));
  const current = () => statuses().find(s=>s.pluginEnabled);
  controller.start(); await setImmediate();
  assert.equal(current().status,'disabled'); assert.equal(current().appliedRevision,null);
  save(request(1,true)); await tick();
  assert.equal(current().status,'suspended'); assert.equal(current().requestedEnabled,true);
  runtimes.at(-1).state='active'; await tick();
  assert.equal(current().status,'active'); assert.equal(current().appliedRevision,1);
  runtimes.at(-1).state='suspended'; await tick();
  assert.equal(current().requestedEnabled,true);
  assert.equal(JSON.parse(readFileSync(file)).requestedEnabled,true,'profile suspension must not rewrite request');
  save(request(2,true,'low')); await tick(); assert.equal(runtimes.at(-1).options.quality,'low');
  save('{'); await tick(); assert.equal(current().status,'error'); assert.equal(runtimes.at(-1).stopped,true);
  save(request(3,true)); await tick(); runtimes.at(-1).state='active'; await tick();
  save(request(4,false)); await tick(); assert.equal(current().status,'disabled'); assert.equal(current().appliedRevision,4);
  assert.equal(runtimes.at(-1).stopped,true);
  controller.stop(); await setImmediate();
  assert.ok(statuses().every(s=>!s.pluginEnabled)); assert.equal(sender.listenerCount('destroyed'),0);
  controller.start(); await setImmediate();
  assert.equal(current().appliedRevision,4); assert.equal(current().status,'disabled');
  save(request(5,true)); await tick();
  unlinkSync(file); await tick(); assert.equal(current().status,'disabled'); assert.equal(current().appliedRevision,null);
  save(request(2,true)); await tick(); assert.equal(current().status,'error','revision rollback fails closed');
  save(request(6,true)); await tick(); assert.equal(current().appliedRevision,6);
  controller.stop(); await setImmediate(); const count = runtimes.length;
  t.mock.timers.tick(20000); await setImmediate();
  assert.equal(runtimes.length,count); assert.ok(statuses().every(s=>!s.pluginEnabled));
});
