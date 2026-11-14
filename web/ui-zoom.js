"use strict";
(() => {
  const pill = document.getElementById('zoom-pill');
  const label = document.getElementById('zoom-value');
  const key = 'hotori.uiZoom';
  const bounded = value => Math.max(50, Math.min(200, Math.round(value / 10) * 10));
  let current = 100, requested = 100, applying = false;
  let wheelDelta = 0, lastWheel = 0;
  let hideTimer;
  const show = () => {
    clearTimeout(hideTimer);
    pill.classList.add('is-visible');
    pill.setAttribute('aria-hidden', 'false');
    hideTimer = setTimeout(() => {
      if (document.activeElement === pill) pill.blur();
      pill.classList.remove('is-visible');
      pill.setAttribute('aria-hidden', 'true');
    }, 1500);
  };
  const display = () => {
    label.textContent = `${current}%`;
    pill.setAttribute('aria-label', `Zoom ${current}%. Click to reset to 100%.`);
    pill.title = 'Ctrl + scroll or + / − to zoom · Ctrl + 0 to reset';
    document.documentElement.dataset.uiZoom = String(current);
  };
  async function apply() {
    if (applying) return;
    applying = true;
    try {
      while (requested !== current) {
        const next = requested;
        const invoke = window.__TAURI__?.core?.invoke;
        if (!invoke) { requested = current; break; }
        await invoke('set_app_zoom', { percent: next });
        current = next; display();
        if (pill.classList.contains('is-visible')) show();
        try { localStorage.setItem(key, String(current)); } catch {}
        document.dispatchEvent(new Event('hotori:glass-invalidate'));
      }
    } catch {
      requested = current;
      pill.title = 'Could not change zoom. Try again.';
    } finally { applying = false; }
  }
  const change = (value, announce = true) => {
    requested = bounded(value);
    if (announce) show();
    void apply();
  };
  let interceptingWheel = false;
  const interceptWheel = enabled => {
    if (enabled === interceptingWheel) return;
    interceptingWheel = enabled;
    if (enabled) document.addEventListener('wheel', zoomWheel, { capture: true, passive: false });
    else { document.removeEventListener('wheel', zoomWheel, true); wheelDelta = 0; }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Control' || event.ctrlKey) interceptWheel(true);
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    let next;
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') next = requested + 10;
    else if (event.key === '-' || event.code === 'NumpadSubtract') next = requested - 10;
    else if (event.key === '0' || event.code === 'Numpad0') next = 100;
    else return;
    event.preventDefault(); event.stopImmediatePropagation(); change(next);
  }, true);
  function zoomWheel(event, cancellable = true) {
    if (!event.ctrlKey || event.altKey || !event.deltaY) return;
    if (cancellable) event.preventDefault();
    event.stopImmediatePropagation();
    const now = performance.now();
    if (now - lastWheel > 180 || Math.sign(wheelDelta) !== Math.sign(event.deltaY)) wheelDelta = 0;
    lastWheel = now;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheelDelta) >= 40) { change(requested - Math.sign(wheelDelta) * 10); wheelDelta = 0; }
  }
  // Leave ordinary wheel scrolling on the compositor's fast path. Only Ctrl
  // zoom needs a cancellable listener; pointer state also covers held Ctrl
  // when focus enters the app from another window.
  document.addEventListener('keyup', event => { if (!event.ctrlKey) interceptWheel(false); }, true);
  document.addEventListener('pointermove', event => interceptWheel(event.ctrlKey), { passive: true });
  // Trackpad pinch/held modifiers can arrive without a local Control keydown.
  // Native zoom hotkeys are disabled, so this passive fallback can still apply
  // app zoom without putting normal scrolling behind a cancellable listener.
  document.addEventListener('wheel', event => { if (event.ctrlKey && !interceptingWheel) zoomWheel(event, false); }, { passive: true });
  window.addEventListener('blur', () => interceptWheel(false));
  pill.addEventListener('click', () => change(100));
  display();
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= 50 && saved <= 200) change(saved, false);
  } catch {}
})();
