const DEFAULT_OPTIONS = { appliedRevision: null, requestedEnabled: false, quality: 'balanced' };
const DISABLED = { ...DEFAULT_OPTIONS, status: 'disabled', reason: null };

function errorReason(error, fallback) {
  const message = error instanceof Error ? error.message : error;
  return typeof message === 'string'
    ? message.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 256) || fallback
    : fallback;
}

function runtimeStatus(stats) {
  switch (stats.state) {
    case 'active':
      return { status: 'active', reason: null };
    case 'suspended':
      return { status: 'suspended', reason: 'Waiting for the theme glass profile and wallpaper.' };
    case 'loading':
    case 'ready':
      return { status: 'suspended', reason: 'Preparing the wallpaper effect.' };
    case 'waiting-for-panels':
      return { status: 'suspended', reason: 'Waiting for supported panels.' };
    case 'context-lost':
      return { status: 'fallback', reason: 'The WebGL context was lost.' };
    case 'fallback':
      return { status: 'fallback', reason: errorReason(stats.error, 'The wallpaper effect is using CSS fallback.') };
    default:
      return { status: 'error', reason: 'The wallpaper effect is not running.' };
  }
}

export class CompanionController {
  #bridge;
  #createRuntime;
  #run;
  #runtime;
  #runtimeQuality;
  #runtimeStats;
  #runtimeFailure;
  #status = DISABLED;

  constructor({ bridge, createRuntime }) {
    this.#bridge = bridge;
    this.#createRuntime = createRuntime;
  }

  start() {
    if (this.#run) return;
    const run = { sessionId: null, timer: null, lastReport: null, reportedAt: 0 };
    this.#run = run;
    if (!this.#bridge) {
      this.#failClosed('The companion bridge is unavailable.');
      return;
    }
    void this.#poll(run);
  }

  stop() {
    const run = this.#run;
    this.#run = undefined;
    this.#runtimeFailure = undefined;
    clearTimeout(run?.timer);
    this.#failClosed(null);
    if (run?.sessionId) void this.#close(run.sessionId);
  }

  getStats() {
    return { ...this.#runtimeStats, ...this.#status };
  }

  #stopRuntime() {
    const runtime = this.#runtime;
    this.#runtime = undefined;
    this.#runtimeQuality = undefined;
    this.#runtimeStats = undefined;
    runtime?.stop();
  }

  #failClosed(reason) {
    try {
      this.#stopRuntime();
    } catch (error) {
      reason ||= errorReason(error, 'Could not stop the wallpaper effect.');
    }
    this.#status = reason ? { ...DEFAULT_OPTIONS, status: 'error', reason } : DISABLED;
  }

  #apply(snapshot) {
    if (snapshot?.kind === 'missing') {
      this.#failClosed(null);
      return;
    }

    const config = snapshot?.config;
    if (snapshot?.kind !== 'valid' || config?.schemaVersion !== 1 ||
        !Number.isSafeInteger(config.revision) || config.revision < 0 ||
        typeof config.requestedEnabled !== 'boolean' ||
        !['low', 'balanced', 'high'].includes(config.quality)) {
      this.#failClosed(errorReason(snapshot?.error, 'The companion configuration is invalid.'));
      return;
    }

    const { revision: appliedRevision, requestedEnabled, quality } = config;
    const request = { appliedRevision, requestedEnabled, quality };
    if (this.#runtimeFailure?.revision === appliedRevision) {
      this.#status = { ...request, status: 'error', reason: this.#runtimeFailure.reason };
      return;
    }
    this.#runtimeFailure = undefined;

    try {
      if (!requestedEnabled) {
        this.#stopRuntime();
        this.#status = { ...request, status: 'disabled', reason: null };
        return;
      }

      const options = { enabled: true, quality };
      if (!this.#runtime) {
        this.#runtime = this.#createRuntime(options);
        this.#runtime.start();
      } else if (this.#runtimeQuality !== quality) {
        this.#runtime.update(options);
      }
      this.#runtimeQuality = quality;
      this.#runtimeStats = this.#runtime.getStats();
      this.#status = { ...request, ...runtimeStatus(this.#runtimeStats) };
    } catch (error) {
      const reason = errorReason(error, 'Could not run the wallpaper effect.');
      this.#failClosed(reason);
      this.#runtimeFailure = { revision: appliedRevision, reason };
      this.#status = { ...request, status: 'error', reason };
    }
  }

  async #poll(run) {
    let failureReason = 'Could not read the companion configuration.';
    try {
      let snapshot;
      if (run.sessionId) {
        snapshot = await this.#bridge.poll(run.sessionId);
      } else {
        failureReason = 'Could not connect to the companion bridge.';
        const opened = await this.#bridge.open();
        if (typeof opened?.sessionId !== 'string' || !opened.sessionId) {
          throw new Error('The companion bridge returned an invalid session.');
        }
        if (this.#run !== run) {
          void this.#close(opened.sessionId);
          return;
        }
        run.sessionId = opened.sessionId;
        snapshot = opened.snapshot;
      }

      if (this.#run !== run) return;
      this.#apply(snapshot);

      const report = this.#status;
      const serialized = JSON.stringify(report);
      if (serialized !== run.lastReport || Date.now() - run.reportedAt >= 2000) {
        failureReason = 'Could not publish the wallpaper effect status.';
        const accepted = await this.#bridge.report(run.sessionId, report);
        if (accepted === false) throw new Error(failureReason);
        if (this.#run !== run) return;
        run.lastReport = serialized;
        run.reportedAt = Date.now();
      }
    } catch (error) {
      if (this.#run !== run) return;
      this.#failClosed(failureReason);
      run.lastReport = null;
      if (errorReason(error, '').includes('Unknown companion session.')) run.sessionId = null;
    } finally {
      if (this.#run === run) run.timer = setTimeout(() => void this.#poll(run), 500);
    }
  }

  async #close(sessionId) {
    try {
      await this.#bridge.close(sessionId);
    } catch {
      // The renderer may unload before the bridge acknowledges close.
    }
  }
}
