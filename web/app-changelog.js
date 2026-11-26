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
  function symbol(name) {
    const paths={release:['M12 3 3 8l9 5 9-5-9-5Z','m3 12 9 5 9-5M3 16l9 5 9-5'],presets:['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],music:['M9 18V5l12-2v13M9 8l12-2','M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z'],image:['M4 3h16v18H4z','m4 16 4-5 4 4 3-3 3 4M8 7h.01'],fix:['m14 7 3 3','M20 4a6 6 0 0 1-7 8l-7 7a2 2 0 0 1-3-3l7-7a6 6 0 0 1 8-7l-4 4 4 4 4-4'],appearance:['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3c-.5-1 .1-2 1.2-2H17a4 4 0 0 0 4-4 9 9 0 0 0-9-9Z','M7 10h.01M10 6h.01M15 7h.01M17 11h.01'],check:['m5 12 4 4L19 6'],guide:['M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-5a4 4 0 0 0-3 2']};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('changelog-icon');
    for(const d of paths[name]||paths.release){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);}return svg;
  }
  function headingSymbol(text){return /preset/i.test(text)?'presets':/music|audio|artwork/i.test(text)?'music':/wallpaper|background|image/i.test(text)?'image':/fix|maintenance|reliab/i.test(text)?'fix':/guide|start|install/i.test(text)?'guide':/appearance|glass|design|changelog/i.test(text)?'appearance':'release';}
  function render(version) {
    const release = catalog.releases.find(item => item.version === version);
    const card = document.createElement('article'); card.className = 'app-changelog-card';
    const heading=node('header','');heading.className='changelog-release-heading';const badge=node('span','');badge.className='changelog-heading-icon';badge.append(symbol('release'));const copy=node('div','');copy.append(node('h3',`Hotori ${version}`));heading.append(badge,copy);card.append(heading);
    if (release?.publishedAt) {
      const date = new Date(release.publishedAt);
      if (Number.isFinite(date.getTime())) {
        const time = node('time', date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        time.dateTime = release.publishedAt; copy.append(time);
      }
    }
    let list, section;
    function group(title){
      section=node('section','');section.className='changelog-section';
      if(title){const label=node('h4','');label.className='changelog-section-heading';label.append(symbol(headingSymbol(title)),node('span',title));section.append(label);}
      const content=node('div','');content.className='changelog-section-body';section.append(content);card.append(section);return content;
    }
    let content;
    for (const raw of (release?.body || 'Release notes are not available for this app version.').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      if(/^#{1,6}\s/.test(line)){content=group(line.replace(/^#{1,6}\s+/,''));list=null;continue;}
      if(!content)content=group('');
      const bullet = /^[-*]\s+/.test(line);
      if (bullet && !list) { list = document.createElement('ul'); content.append(list); }
      if (!bullet) list = null;
      const el = document.createElement(bullet ? 'li' : 'p');
      if(bullet){const marker=symbol('check');marker.classList.add('changelog-bullet');const text=node('span','');inline(text,line.replace(/^[-*]\s+/,''));el.append(marker,text);}else inline(el,line);
      (bullet ? list : content).append(el);
    }
    $('app-changelog-content').replaceChildren(card);
    window.HotoriMotion?.enter(card);
    $('app-changelog-content').scrollTop = 0;
    displayedCurrent = version === current;
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
      $('app-changelog').setAttribute('aria-busy', 'true');
      const finishLoading = window.HotoriMotion?.loading($('app-changelog-content'), { label: 'Loading app releases…', rows: 2 }) || (() => {});
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
      } finally { finishLoading(); $('app-changelog').setAttribute('aria-busy', 'false'); }
    }
  };
})();
