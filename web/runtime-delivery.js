"use strict";
(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  const dialog = document.getElementById('runtime-dialog');
  const text = document.getElementById('runtime-status');
  let working = false, current;
  function render() {
    document.getElementById('runtime-apply').disabled = working || !current?.canApply;
    document.getElementById('runtime-rollback').disabled = working || !current?.canRollback;
    document.getElementById('runtime-refresh').disabled = working;
    document.getElementById('runtime-close').disabled = working;
    document.getElementById('runtime-sources').disabled = working || !current?.payloadReady;
    document.getElementById('runtime-version').textContent = current?.payloadReady ? `Plugin ${current.pluginVersion} · Bundle ${current.buildId}` : '';
  }
  async function check() {
    if (!invoke || working) return;
    try { current = await invoke('get_true_glass_runtime'); text.textContent = current.message; }
    catch (e) { current = undefined; text.textContent = 'Runtime delivery unavailable: ' + String(e); }
    render();
  }
  async function operate(command, label) {
    if (!invoke || working) return;
    working = true; text.textContent = label; render();
    try { current = await invoke(command); text.textContent = current.message; }
    catch (e) { text.textContent = String(e); try { current = await invoke('get_true_glass_runtime'); } catch { current = undefined; } }
    finally { working = false; render(); }
  }
  function open() { if (!dialog.open) dialog.showModal(); check(); }
  document.getElementById('runtime-close').addEventListener('click', () => dialog.close());
  document.getElementById('runtime-refresh').addEventListener('click', check);
  document.getElementById('runtime-sources').addEventListener('click', async () => {
    try { await invoke('open_true_glass_sources'); } catch (error) { text.textContent = String(error); }
  });
  document.getElementById('runtime-apply').addEventListener('click', () => operate('apply_true_glass_runtime', 'Verifying, backing up and applying runtime… Keep Discord closed.'));
  document.getElementById('runtime-rollback').addEventListener('click', () => operate('rollback_true_glass_runtime', 'Verifying and restoring the previous runtime… Keep Discord closed.'));
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  window.HotoriRuntimeDelivery = { open, check };
  check();
})();
