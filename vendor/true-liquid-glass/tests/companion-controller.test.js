import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { CompanionController } from '../src/companion-controller.js';

function snapshot(revision, requestedEnabled = false, quality = 'balanced') {
  return {
    kind: revision === null ? 'missing' : 'valid',
    config: { schemaVersion: 1, revision, requestedEnabled, quality },
    error: null
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(t, initial = snapshot(null), prepareRuntime = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const reports = [];
  const closed = [];
  const runtimes = [];
  const connection = { snapshot: initial, opens: 0, polls: 0 };

  const bridge = {
    open() {
      return { sessionId: `session-${++connection.opens}`, snapshot: connection.snapshot };
    },
    poll() {
      connection.polls++;
      return connection.snapshot;
    },
    report(id, report) { reports.push({ id, ...report }); },
    close(id) { closed.push(id); }
  };

  const controller = new CompanionController({
    bridge,
    createRuntime(options) {
      const runtime = {
        initial: options,
        started: 0,
        stopped: 0,
        updates: [],
        stats: { state: 'suspended', panels: 0 },
        start() { this.started++; },
        stop() { this.stopped++; },
        update(update) { this.updates.push(update); },
        getStats() { return this.stats; }
      };
      prepareRuntime(runtime, runtimes.length);
      runtimes.push(runtime);
      return runtime;
    }
  });
  t.after(() => controller.stop());

  return {
    controller, connection, bridge, reports, closed, runtimes,
    async tick(ms = 500) {
      t.mock.timers.tick(ms);
      await setImmediate();
    }
  };
}

test('applies on, quality, profile, fallback, and off states while acknowledging each revision', async t => {
  const { controller, connection, reports, runtimes, tick } = setup(t, snapshot(1));
  controller.start();
  controller.start();
  await setImmediate();
  assert.equal(connection.opens, 1);
  assert.deepEqual(reports[0], {
    id: 'session-1', appliedRevision: 1, requestedEnabled: false, quality: 'balanced', status: 'disabled', reason: null
  });
  assert.equal(runtimes.length, 0);

  connection.snapshot = snapshot(2, true, 'low');
  await tick();
  const [runtime] = runtimes;
  assert.deepEqual(runtime.initial, { enabled: true, quality: 'low' });
  assert.equal(runtime.started, 1);
  assert.equal(reports.at(-1).status, 'suspended');
  assert.equal(reports.at(-1).requestedEnabled, true);
  assert.equal(reports.at(-1).appliedRevision, 2);

  for (const state of ['loading', 'ready', 'waiting-for-panels']) {
    runtime.stats = { state, panels: 0 };
    await tick();
    assert.equal(controller.getStats().status, 'suspended');
  }

  runtime.stats = { state: 'active', panels: 2 };
  await tick();
  assert.equal(reports.at(-1).status, 'active');
  assert.equal(controller.getStats().panels, 2);

  connection.snapshot = snapshot(3, true, 'high');
  await tick();
  assert.deepEqual(runtime.updates, [{ enabled: true, quality: 'high' }]);
  assert.equal(reports.at(-1).appliedRevision, 3);
  assert.equal(reports.at(-1).quality, 'high');

  runtime.stats = { state: 'context-lost' };
  await tick();
  assert.equal(reports.at(-1).status, 'fallback');
  runtime.stats = { state: 'fallback', error: 'Wallpaper failed.\nSee settings.' };
  await tick();
  assert.equal(reports.at(-1).reason, 'Wallpaper failed. See settings.');
  runtime.stats = { state: 'stopped' };
  await tick();
  assert.equal(reports.at(-1).status, 'error');
  assert.equal(reports.at(-1).appliedRevision, 3);

  connection.snapshot = snapshot(4, false, 'high');
  await tick();
  assert.equal(runtime.stopped, 1);
  assert.equal(runtimes.length, 1);
  assert.deepEqual(reports.at(-1), {
    id: 'session-1', appliedRevision: 4, requestedEnabled: false, quality: 'high', status: 'disabled', reason: null
  });
});

test('defaults missing settings to off, fails closed on invalid data, and reports heartbeat', async t => {
  const { controller, connection, reports, runtimes, tick } = setup(t);
  controller.start();
  await setImmediate();
  assert.deepEqual(reports[0], {
    id: 'session-1', appliedRevision: null, requestedEnabled: false, quality: 'balanced', status: 'disabled', reason: null
  });
  for (let index = 0; index < 3; index++) await tick();
  assert.equal(reports.length, 1);
  await tick();
  assert.deepEqual(reports[1], reports[0]);

  connection.snapshot = snapshot(5, true);
  await tick();
  connection.snapshot = snapshot(6, true, 'maximum');
  await tick();
  assert.equal(runtimes[0].stopped, 1);
  assert.equal(reports.at(-1).status, 'error');
  assert.equal(reports.at(-1).appliedRevision, null);

  connection.snapshot = { ...snapshot(5, true), kind: 'invalid', error: 'Configuration is unreadable.' };
  await tick();
  assert.equal(runtimes.length, 1);
  assert.equal(reports.at(-1).reason, 'Configuration is unreadable.');
  connection.snapshot = snapshot(5, true);
  await tick();
  assert.equal(runtimes.length, 2);
  connection.snapshot = snapshot(null);
  await tick();
  assert.equal(runtimes[1].stopped, 1);
  assert.equal(reports.at(-1).status, 'disabled');
});

test('retries a bridge failure, rejects stale reports, and recovers after a session expires', async t => {
  const { controller, connection, bridge, reports, runtimes, tick } = setup(t, snapshot(1, true));
  const open = bridge.open;
  bridge.open = () => { throw new Error('Bridge unavailable.'); };
  controller.start();
  await setImmediate();
  assert.equal(controller.getStats().status, 'error');
  assert.equal(runtimes.length, 0);
  bridge.open = open;
  await tick();

  const report = bridge.report;
  bridge.report = () => { throw new Error('Status no longer matches the companion configuration.'); };
  connection.snapshot = snapshot(2, true, 'high');
  await tick();
  assert.equal(runtimes[0].stopped, 1);
  assert.equal(controller.getStats().status, 'error');
  assert.equal(controller.getStats().appliedRevision, null);
  bridge.report = report;
  await tick();
  assert.equal(connection.opens, 1);
  assert.equal(runtimes.length, 2);
  assert.equal(reports.at(-1).appliedRevision, 2);

  const poll = bridge.poll;
  bridge.poll = () => { throw new Error('Unknown companion session.'); };
  await tick();
  assert.equal(runtimes[1].stopped, 1);
  assert.equal(controller.getStats().status, 'error');
  bridge.poll = poll;
  await tick();
  assert.equal(reports.at(-1).id, 'session-2');
  assert.equal(reports.at(-1).status, 'suspended');
});

test('closes a late open and discards a stale poll across stop and restart', async t => {
  const { controller, connection, bridge, reports, closed, runtimes, tick } = setup(t, snapshot(1, true));
  const lateOpen = deferred();
  const open = bridge.open;
  bridge.open = () => lateOpen.promise;
  controller.start();
  controller.stop();
  bridge.open = open;
  controller.start();
  await setImmediate();
  lateOpen.resolve({ sessionId: 'late-open', snapshot: snapshot(8, true, 'high') });
  await setImmediate();
  assert.deepEqual(closed, ['late-open']);
  assert.equal(reports.length, 1);
  assert.equal(runtimes.length, 1);

  const latePoll = deferred();
  bridge.poll = () => latePoll.promise;
  await tick();
  controller.stop();
  assert.equal(runtimes[0].stopped, 1);
  assert.deepEqual(closed, ['late-open', 'session-1']);
  connection.snapshot = snapshot(2);
  controller.start();
  await setImmediate();
  latePoll.resolve(snapshot(9, true, 'high'));
  await setImmediate();
  assert.equal(runtimes.length, 1);
  assert.equal(reports.length, 2);
  assert.equal(controller.getStats().appliedRevision, 2);
});

test('reports a runtime startup error without repeatedly allocating for the same revision', async t => {
  const { controller, connection, reports, runtimes, tick } = setup(t, snapshot(1, true), (runtime, index) => {
    if (index === 0) runtime.start = () => { throw new Error('Runtime startup failed.'); };
  });
  controller.start();
  await setImmediate();
  assert.deepEqual(reports.at(-1), {
    id: 'session-1', appliedRevision: 1, requestedEnabled: true, quality: 'balanced',
    status: 'error', reason: 'Runtime startup failed.'
  });
  assert.equal(runtimes[0].stopped, 1);
  await tick();
  assert.equal(runtimes.length, 1);
  connection.snapshot = snapshot(2, true);
  await tick();
  assert.equal(runtimes.length, 2);
  assert.equal(reports.at(-1).status, 'suspended');
});

test('keeps each poll serial and clears timers and stale pending reports on stop', async t => {
  const { controller, connection, bridge, closed, runtimes, tick } = setup(t, snapshot(1, true));
  const lateReport = deferred();
  const report = bridge.report;
  bridge.report = () => lateReport.promise;
  controller.start();
  await setImmediate();
  await tick(4000);
  assert.equal(connection.polls, 0);
  controller.stop();
  assert.deepEqual(closed, ['session-1']);
  assert.equal(runtimes[0].stopped, 1);

  bridge.report = report;
  controller.start();
  await setImmediate();
  lateReport.reject(new Error('Stale acknowledgement.'));
  await setImmediate();
  assert.equal(runtimes.length, 2);
  assert.equal(runtimes[1].stopped, 0);
  assert.equal(controller.getStats().status, 'suspended');

  controller.stop();
  await tick(4000);
  assert.equal(connection.polls, 0);
  assert.deepEqual(closed, ['session-1', 'session-2']);
  assert.equal(controller.getStats().status, 'disabled');
});
