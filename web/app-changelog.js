"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const key = 'hotori.appChangelogSeenVersion';
  let catalog, current, pending = false, displayedCurrent = false;
  const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  // Only construct text nodes and emphasis: release-note HTML never executes.
  function inline(parent, text) {
    for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
      if (part.startsWith('**') && part.endsWith('**')) parent.append(node('strong', part.slice(2, -2)));
      else parent.append(document.createTextNode(part));
    }
  }
  function render(version) {
    const release = catalog.releases.find(item => item.version === version);
    const card = document.createElement('article'); card.className = 'guide-step app-changelog-card';
    const title = node('h3', `Hotori ${version}`); card.append(title);
    if (release?.publishedAt) {
      const date = new Date(release.publishedAt);
      if (Number.isFinite(date.getTime())) {
        const time = node('time', date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        time.dateTime = release.publishedAt; card.append(time);
      }
    }
    let list;
    for (const raw of (release?.body || 'Release notes are not available for this app version.').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      const bullet = /^[-*]\s+/.test(line);
      if (bullet && !list) { list = document.createElement('ul'); card.append(list); }
      if (!bullet) list = null;
      const el = document.createElement(bullet ? 'li' : /^#{1,6}\s/.test(line) ? 'h4' : 'p');
      inline(el, line.replace(bullet ? /^[-*]\s+/ : /^#{1,6}\s+/, ''));
      (bullet ? list : card).append(el);
    }
    $('app-changelog-content').replaceChildren(card);
    $('app-changelog-content').scrollTop = 0;
    displayedCurrent = version === current;
    // Reading an older entry after the current one still acknowledges this version.
    if (displayedCurrent) $('app-changelog-dialog').dataset.readCurrent = 'true';
  }
  function open() {
    if (!catalog || $('app-changelog-dialog').open) return;
    $('app-changelog-dialog').dataset.readCurrent = 'false';
    $('app-changelog-version').value = current;
    render(current);
    $('app-changelog-dialog').showModal();
  }
  $('app-changelog').addEventListener('click', open);
  $('app-changelog-version').addEventListener('change', event => render(event.target.value));
  $('app-changelog-close').addEventListener('click', () => $('app-changelog-dialog').close());
  $('app-changelog-dialog').addEventListener('close', () => {
    pending = false;
    if ($('app-changelog-dialog').dataset.readCurrent === 'true') {
      try { localStorage.setItem(key, current); } catch { /* Still one offer per launch without storage. */ }
    }
  });
  window.HotoriAppChangelog = {
    async initialize(invoke, idle) {
      $('app-changelog').disabled = true;
      try {
        const result = await invoke('get_app_changelog');
        if (result.schemaVersion !== 1 || !Array.isArray(result.releases) || !result.releases.some(r => r.version === result.currentVersion)) throw Error('App release notes unavailable');
        catalog = result; current = result.currentVersion;
        const select = $('app-changelog-version'); select.replaceChildren();
        for (const release of catalog.releases) {
          const option = node('option', `Hotori ${release.version}`); option.value = release.version; select.append(option);
        }
        $('app-changelog').disabled = false;
        let seen;
        try { seen = localStorage.getItem(key); } catch {}
        if (seen === current) return;
        pending = true;
        const offer = () => {
          if (!pending || $('app-changelog-dialog').open) return;
          if (!idle() || document.querySelector('dialog[open]')) { setTimeout(offer, 500); return; }
          open();
        };
        offer();
      } catch (error) {
        $('app-changelog').title = 'App release notes are unavailable.';
        console.warn('Could not load app changelog:', error);
      }
    }
  };
})();
