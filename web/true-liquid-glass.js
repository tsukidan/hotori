"use strict";
// Shared companion requests; no Vencord settings or plugin installation changes.
(() => {
  const invoke = window.__TAURI__?.core?.invoke;
  const key = 'hotori.true-liquid-glass.v1';
  const legacy = () => { try { return localStorage.getItem(key) === 'on'; } catch { return false; } };
  let saved = null, draft = false, quality = 'balanced', needsMigration = false;
  let snapshot = { config: null, instances: [] }, readError = '', timer = 0, currentRegion, generation = 0, polling = false;
  function stopPolling() { clearTimeout(timer); timer = 0; }
  function canPoll() { return currentRegion?.isConnected && currentRegion.classList.contains('is-visible') && !currentRegion.closest('[hidden], [inert]') && document.querySelector('#app')?.dataset.page === 'settings' && !document.hidden; }
  function statusText() {
    if (readError || snapshot.error) return readError || snapshot.error;
    if (dirty()) return 'Unsaved preference. Save Glass Appearance to send it to the plugin.';
    if (!saved) return 'No request saved. The effect defaults to Off. Apply the bundled runtime, then enable the plugin in Vencord.';
    if (!snapshot.config || snapshot.config.revision !== saved.revision) return 'The shared request changed outside this window. Reopen settings to load it.';
    const now = Date.now();
    const live = (snapshot.instances || []).filter(i => i.pluginEnabled && Date.parse(i.updatedAt) >= now - 10000 && Date.parse(i.updatedAt) <= now + 2000 && Date.parse(i.heartbeatExpiresAt) > now);
    if (!live.length) return 'Plugin unavailable—no fresh connection. Request saved; check plugin setup, restart Discord, and enable the plugin in Vencord.';
    const states = live.map(i => {
      if (i.requestedRevision !== saved.revision || i.appliedRevision !== saved.revision || i.requestedEnabled !== saved.requestedEnabled || i.quality !== saved.quality) return 'pending';
      if (i.status === 'active' && !saved.requestedEnabled) return 'pending';
      return i.status;
    });
    const labels = { active: 'Active—rendering confirmed.', disabled: 'Off—plugin acknowledged the request.', suspended: 'Suspended—waiting for Liquid Glass, wallpaper, or supported panels.', fallback: 'Fallback—standard CSS glass is in use.', error: 'Plugin error—the effect is stopped.', pending: 'Pending—waiting for the plugin to acknowledge this request.' };
    if (new Set(states).size > 1) {
      const counts = [...new Set(states)].map(state => states.filter(s => s === state).length + ' ' + state);
      return 'Mixed Discord instances: ' + counts.join(', ') + '.';
    }
    const state = states[0];
    const reason = ['suspended','fallback','error'].includes(state) ? live.map(i => i.reason).filter(Boolean).filter((r,i,a) => a.indexOf(r) === i).join(' ') : '';
    return (live.length > 1 ? live.length + ' Discord instances: ' : '') + labels[state] + (reason ? ' ' + reason : '');
  }
  function renderStatus() {
    const node = currentRegion?.querySelector('#true-glass-status');
    if (node) { const text = statusText(); if (node.textContent !== text) node.textContent = text; }
  }
  async function poll() {
    stopPolling();
    if (!invoke || !canPoll() || polling) return;
    polling = true;
    const token = generation;
    try { const next = await invoke('get_true_liquid_glass'); if (token === generation) { snapshot = next; readError = ''; } }
    catch (error) { if (token === generation) readError = 'Plugin status unavailable: ' + String(error); }
    finally {
      polling = false;
      renderStatus();
      if (canPoll()) timer = setTimeout(poll, token === generation ? 1000 : 0);
    }
  }
  async function load() {
    generation++; stopPolling(); readError = '';
    try { snapshot = invoke ? await invoke('get_true_liquid_glass') : { config: null, instances: [] }; }
    catch (error) { snapshot = { config: null, instances: [] }; readError = 'Cannot read companion settings: ' + String(error); }
    saved = snapshot.config;
    quality = saved?.quality || 'balanced';
    needsMigration = !saved && !snapshot.error && !readError && legacy();
    draft = saved?.requestedEnabled ?? needsMigration;
  }
  function dirty() { return needsMigration || draft !== (saved?.requestedEnabled ?? false); }
  async function store(enabled, selectedQuality, force = false) {
    if (!invoke) throw Error('The companion bridge is unavailable.');
    if (!force && !dirty()) return;
    const next = await invoke('save_true_liquid_glass', { requestedEnabled: enabled, quality: selectedQuality });
    if (!next.config || next.config.requestedEnabled !== enabled || next.config.quality !== selectedQuality) throw Error('The companion request was not saved.');
    generation++; stopPolling(); snapshot = next; saved = next.config; draft = enabled; quality = selectedQuality; needsMigration = false; readError = '';
    try { localStorage.removeItem(key); } catch { /* Shared configuration is authoritative. */ }
    renderStatus(); poll();
  }
  function control(profile, changed) {
    const region = document.createElement('div');
    region.className = 'true-glass-reveal';
    const clip = document.createElement('div');
    clip.className = 'true-glass-clip';
    clip.innerHTML = `<div class="true-glass-option">
      <div class="true-glass-toggle-row"><label for="true-glass-toggle">True Liquid Glass</label>
        <input id="true-glass-toggle" class="true-glass-switch" type="checkbox" role="switch" aria-describedby="true-glass-warning true-glass-status"></div>
      <div id="true-glass-warning" class="true-glass-warning">
        <strong>Experimental WebGL shader plugin. On requests the effect; Off disables the request.</strong>
        <p>Bends your wallpaper behind supported Discord panels for more realistic glass. It can make scrolling and animations less smooth, especially on lower-end hardware. The developer has observed dropped frames on an RTX 5080.</p>
      </div>
      <p id="true-glass-status" class="true-glass-status">Reading companion plugin status…</p>
      <button class="button acrylic-select true-glass-setup" type="button">Plugin setup &amp; updates</button>
    </div>`;
    stopPolling(); generation++; currentRegion = region;
    region.append(clip);
    region.querySelector('.true-glass-setup').addEventListener('click', () => window.HotoriRuntimeDelivery?.open());
    region.querySelector("#true-glass-status").setAttribute("role", "status");
    const toggle = region.querySelector('input');
    toggle.checked = draft;
    toggle.addEventListener('change', () => { draft = toggle.checked; renderStatus(); changed(); });
    function reveal() {
      const show = profile.value === 'Liquid Glass';
      region.classList.toggle('is-visible', show);
      region.inert = !show;
      region.setAttribute('aria-hidden', String(!show));
      renderStatus();
      if (show) queueMicrotask(poll); else stopPolling();
    }
    profile.addEventListener('change', reveal);
    reveal();
    return region;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else poll(); });
  new MutationObserver(() => { if (!canPoll()) stopPolling(); else if (!timer) poll(); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['data-page'] });
  window.HotoriTrueGlass = { control, dirty, load, refresh: poll, save: () => store(draft, quality), reset: () => store(false, 'balanced', true) };
})();
