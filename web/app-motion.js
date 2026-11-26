"use strict";
(() => {
  const animations = new WeakMap();
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function enter(element) {
    if (!element) return;
    if (element.id === 'theme-changelog-items') { for (const copy of element.querySelectorAll('.theme-note-copy')) enter(copy); return; }
    // Fading a glass surface (or one of its ancestors) also fades the backdrop
    // composed for nested lenses, then the browser fades that result again.
    // Keep material containers solid and animate only their foreground copy.
    if (element.matches('.page, .settings-section, #settings-list, #settings-form, .app-changelog-card, .glass, .optical-glass, .shader-glass')
        || element.querySelector('.glass, .optical-glass, .shader-glass, .setting-row, select')) {
      for (const copy of [...element.querySelectorAll('.setting-info, .status-copy, .settings-header > p, .app-changelog-card > h3, .app-changelog-card > h4, .app-changelog-card > p, .app-changelog-card > ul')].slice(0, 12)) enter(copy);
      return;
    }
    animations.get(element)?.cancel();
    if (reduced() || !element.checkVisibility({ checkVisibilityCSS: true })) return;
    element.classList.add('motion-enter');
    const animation = element.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    animations.set(element, animation);
    animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) {
        animations.delete(element); element.classList.remove('motion-enter');
      }
    });
  }
  function loading(container, { label = 'Loading…', rows = 3, overlay = false } = {}) {
    const skeleton = document.createElement('div');
    skeleton.className = `loading-skeleton${overlay ? ' loading-skeleton-overlay' : ''}`;
    skeleton.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < rows; index++) {
      const row = document.createElement('div'); row.className = 'skeleton-card';
      for (const width of ['wide', 'medium', 'short']) {
        const line = document.createElement('span'); line.className = `skeleton-line skeleton-${width}`; row.append(line);
      }
      skeleton.append(row);
    }
    const announcement = document.createElement('span');
    announcement.className = 'visually-hidden loading-announcement'; announcement.setAttribute('role', 'status'); announcement.textContent = label;
    container.setAttribute('aria-busy', 'true'); container.dataset.loading = 'true'; container.classList.add('loading-host');
    container.append(skeleton, announcement); enter(skeleton);
    let completed = false;
    return () => {
      if (completed) return; completed = true;
      announcement.remove();
      container.removeAttribute('data-loading'); container.setAttribute('aria-busy', 'false');
      const remove = () => { skeleton.remove(); if (!container.querySelector('.loading-skeleton')) container.classList.remove('loading-host'); };
      if (overlay && skeleton.isConnected && !reduced()) {
        skeleton.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out' }).finished.then(remove, remove);
      } else remove();
      enter(container);
    };
  }
  function present(element) {
    if (!element) return;
    animations.get(element)?.cancel();
    // The renderer ignores this presentation opacity when composing lenses;
    // Chromium fades the completed category once, just like page navigation.
    element.classList.add('material-fade');
    if (reduced() || !element.checkVisibility({ checkVisibilityCSS: true })) return;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    animations.set(element, animation);
    animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) animations.delete(element);
    });
  }
  window.HotoriMotion = { enter, present, loading };
})();
