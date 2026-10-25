"use strict";

(() => {
  // Full settings panel in the supplied reference: 1398 x 1293 pixels.
  const settingsAspect = 1398 / 1293;
  const localPrefix = 'vencord:///themes/hotori-assets/';
  let api, colors = [], paletteSource = '', paletteGeneration = 0;
  let seen = new Set(), views = [], previews = [], cropDialog;
  const node = (tag, cls = '', text) => {
    const el = document.createElement(tag); el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (text, action, cls = 'button') => {
    const el = node('button', cls, text); el.type = 'button'; el.addEventListener('click', action); return el;
  };
  const imageFrom = async source => {
    const image = new Image(); image.src = source; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40000000) throw Error('Choose an image below 40 megapixels.');
    return image;
  };
  const readFile = file => new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) return reject(Error('Choose an image smaller than 10 MB.'));
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Could not read this image.')); reader.readAsDataURL(file);
  });
  const readMeta = uri => { try { return JSON.parse(localStorage.getItem(`hotori.crop.${uri}`)); } catch { return null; } };
  const saveMeta = (uri, value) => { try { localStorage.setItem(`hotori.crop.${uri}`, JSON.stringify(value)); } catch {} };

  function sample(image) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, 80, 80);
    const pixels = context.getImageData(0, 0, 80, 80).data, bins = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const key = rgb.map(v => v >> 4).join(',');
      const bin = bins.get(key) || { count: 0, rgb: [0, 0, 0] };
      bin.count++; rgb.forEach((value, index) => bin.rgb[index] += value); bins.set(key, bin);
    }
    const candidates = [...bins.values()].map(bin => {
      const rgb = bin.rgb.map(value => Math.round(value / bin.count));
      const saturation = (Math.max(...rgb) - Math.min(...rgb)) / 255;
      return { rgb, score: bin.count * (.25 + saturation), light: (Math.max(...rgb) + Math.min(...rgb)) / 510 };
    }).sort((a, b) => b.score - a.score);
    const usable = candidates.filter(item => item.light > .10 && item.light < .9);
    const selected = [];
    for (const candidate of usable.length ? usable : candidates) {
      if (selected.every(other => Math.hypot(...candidate.rgb.map((value, i) => value - other[i])) > 50)) selected.push(candidate.rgb);
      if (selected.length === 6) break;
    }
    if (selected.length === 1) {
      const base = selected[0], lighten = (Math.max(...base) + Math.min(...base)) / 510 < .55;
      selected.push(base.map(value => Math.round(lighten ? value + (255 - value) * .25 : value * .75)));
    }
    return selected.map(rgb => '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join(''));
  }
  function markTabs() {
    for (const category of ['Colors', 'Messages']) {
      const tab = document.getElementById(`category-${category.toLowerCase()}`);
      if (!tab) continue;
      if (!tab.querySelector('.recommendation-dot')) {
        const dot = node('span', 'recommendation-dot'); dot.setAttribute('aria-hidden', 'true'); tab.append(dot);
      }
      const relevant = api?.fields().some(field => category === 'Colors' ? field.name === '--main-color' : field.name.startsWith('--mention-') && field.kind === 'color');
      tab.classList.toggle('has-recommendations', !!relevant && colors.length > 0 && !seen.has(category));
      tab.title = colors.length ? `Wallpaper ${category === 'Colors' ? 'color' : 'mention color'} recommendations available` : '';
    }
  }
  function visit(category) {
    if (!colors.length || !['Colors', 'Messages'].includes(category)) return;
    seen.add(category);
    try { localStorage.setItem('hotori.paletteSeen', JSON.stringify({ source: paletteSource, categories: [...seen] })); } catch {}
    markTabs();
  }
  function publishPalette(image, source) {
    colors = image ? sample(image) : [];
    if (source !== paletteSource) {
      seen = new Set();
      try { const saved = JSON.parse(localStorage.getItem('hotori.paletteSeen')); if (saved?.source === source) seen = new Set(saved.categories); } catch {}
    }
    paletteSource = source; refreshSwatches(); markTabs();
    if (document.getElementById('app').dataset.page === 'settings') visit(api?.current?.());
  }
  function refreshSwatches() {
    views = views.filter(view => view.root.isConnected);
    for (const view of views) {
      view.list.replaceChildren();
      for (const hex of colors.slice(0, view.limit)) {
        const swatch = button('', () => api.saveColor(view.field, hex), 'button recommended-swatch settings-glass-action');
        swatch.setAttribute('aria-label', `Use ${hex.toUpperCase()} for ${view.label}`);
        swatch.title = `${view.label}: ${hex.toUpperCase()} · saves immediately`;
        const fill = node('span', 'recommended-color'); fill.style.backgroundColor = hex; swatch.append(fill); view.list.append(swatch);
      }
      view.empty.hidden = colors.length > 0;
    }
  }
  function recommendations(root, field, label, limit = 6, quick = false) {
    const section = node('section', quick ? 'palette-quick' : 'submenu palette-section settings-glass-action');
    section.setAttribute('aria-label', quick ? 'Quick wallpaper colors' : `Recommended colors for ${label}`);
    if (!quick) section.append(node('h4', '', 'Recommended colors'));
    const list = node('div', 'recommended-swatches');
    const empty = node('p', 'palette-hint', 'Choose a Main Background to get recommended colors.');
    section.append(list, empty);
    if (quick) {
      const hint = node('p', 'palette-hint', 'More color options and controls in ');
      hint.append(button('Colors', () => api.select('Colors'), 'palette-link'), document.createTextNode('.'));
      section.append(hint);
    } else section.append(node('p', 'palette-hint', 'Sampled from your Main Background. Click to apply and save this color.'));
    root.append(section); views.push({ root: section, field, label, limit, list, empty });
  }

  function crop(image, main, initial) {
    if (cropDialog?.open) return Promise.resolve(null);
    const dialog = cropDialog = node('dialog', 'glass vencord-dialog crop-dialog'); dialog.id = 'wallpaper-crop-dialog';
    dialog.setAttribute('aria-labelledby', 'wallpaper-crop-title');
    const title = node('h2', '', main ? 'Crop Main Background' : 'Crop Settings Background'); title.id = 'wallpaper-crop-title';
    const stage = node('canvas', 'crop-stage'); stage.tabIndex = 0;
    stage.setAttribute('aria-label', 'Crop preview. Drag to position; arrow keys also move the image.');
    const instructions = node('p', 'crop-hint', 'Drag to position. Use the slider or mouse wheel to zoom.');
    const ratioLabel = node('label', 'crop-control', 'Aspect ratio');
    const ratio = node('select'); ratio.setAttribute('aria-label', 'Crop aspect ratio');
    const aspect = main ? 16 / 9 : settingsAspect;
    const option = node('option', '', main ? '16:9' : 'Settings panel · 466:431');
    option.value = String(aspect); ratio.append(option);
    ratio.disabled = true; ratio.value = String(aspect);
    ratioLabel.append(ratio);
    const zoomLabel = node('label', 'crop-control', 'Zoom');
    const range = node('input'); range.type = 'range'; range.min = '1'; range.max = '4'; range.step = '.01'; range.value = String(initial?.zoom || 1);
    range.setAttribute('aria-label', 'Crop zoom');
    const zoomSurface = node('div', 'range-surface'), zoomTrack = node('div', 'range-track'); zoomTrack.setAttribute('aria-hidden', 'true'); zoomTrack.append(node('div', 'range-fill')); zoomSurface.append(zoomTrack, range); zoomLabel.append(zoomSurface);
    const controls = node('div', 'crop-controls'); controls.append(ratioLabel, zoomLabel);
    const position = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : .5;
    let x = position(initial?.x ?? .5), y = position(initial?.y ?? .5), drag;
    const geometry = () => {
      const aspect = Number(ratio.value), zoom = Number(range.value);
      const width = Math.min(image.naturalWidth, image.naturalHeight * aspect) / zoom, height = width / aspect;
      return { sx: (image.naturalWidth - width) * x, sy: (image.naturalHeight - height) * y, width, height, aspect };
    };
    const draw = () => {
      const g = geometry(); stage.width = Math.round(Math.min(960, 540 * g.aspect)); stage.height = Math.round(stage.width / g.aspect);
      stage.style.aspectRatio = String(g.aspect);
      const context = stage.getContext('2d'); context.drawImage(image, g.sx, g.sy, g.width, g.height, 0, 0, stage.width, stage.height);
      context.strokeStyle = '#ffffff55'; context.lineWidth = 1;
      for (const third of [1 / 3, 2 / 3]) { context.beginPath(); context.moveTo(stage.width * third, 0); context.lineTo(stage.width * third, stage.height); context.moveTo(0, stage.height * third); context.lineTo(stage.width, stage.height * third); context.stroke(); }
      range.setAttribute('aria-valuetext', `${Math.round(Number(range.value) * 100)}%`);
      zoomSurface.style.setProperty('--range-progress', `${(Number(range.value) - 1) / 3 * 100}%`);
    };
    stage.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY }; stage.setPointerCapture(event.pointerId); });
    stage.addEventListener('pointermove', event => {
      if (!drag) return;
      const g = geometry(), box = stage.getBoundingClientRect();
      const extraX = image.naturalWidth / g.width * box.width - box.width, extraY = image.naturalHeight / g.height * box.height - box.height;
      if (extraX > 0) x = Math.max(0, Math.min(1, x - (event.clientX - drag.x) / extraX));
      if (extraY > 0) y = Math.max(0, Math.min(1, y - (event.clientY - drag.y) / extraY));
      drag = { x: event.clientX, y: event.clientY }; draw();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(event, () => { drag = null; });
    stage.addEventListener('wheel', event => { event.preventDefault(); range.value = String(Math.max(1, Math.min(4, Number(range.value) - Math.sign(event.deltaY) * .1))); draw(); }, { passive: false });
    stage.addEventListener('keydown', event => {
      const delta = event.shiftKey ? .05 : .01;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); x = Math.max(0, Math.min(1, x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0)));
      y = Math.max(0, Math.min(1, y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0))); draw();
    });
    range.addEventListener('input', draw); ratio.addEventListener('change', () => { x = y = .5; draw(); });
    return new Promise(resolve => {
      let result = null;
      const cancel = button('Cancel', () => dialog.close()); cancel.autofocus = true;
      const apply = button('Use crop', () => {
        const g = geometry();
        const scale = Math.min(1, 1920 / g.width, 1920 / g.height, Math.sqrt(2073600 / (g.width * g.height)));
        const output = document.createElement('canvas');
        output.width = main ? Math.max(16, Math.floor(g.width * scale / 16) * 16) : Math.max(1, Math.round(g.width * scale));
        output.height = main ? output.width / 16 * 9 : Math.max(1, Math.round(output.width / g.aspect));
        output.getContext('2d').drawImage(image, g.sx, g.sy, g.width, g.height, 0, 0, output.width, output.height);
        result = { data: output.toDataURL('image/png'), ratio: g.aspect, zoom: Number(range.value), x, y }; dialog.close();
      }, 'button primary');
      const actions = node('div', 'app-update-actions'); actions.append(cancel, apply);
      dialog.append(title, stage, instructions, controls, actions);
      dialog.addEventListener('close', () => { dialog.remove(); cropDialog = null; resolve(result); }, { once: true });
      document.body.append(dialog); draw(); dialog.showModal();
    });
  }

  function discordPreview(root, image, main) {
    if (!main) { root.append(image); return null; }
    const stage = node('div', 'wallpaper-discord-preview'); stage.hidden = true;
    stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', 'Illustrative Discord preview with your cropped Main Background');
    image.alt = ''; stage.append(image, node('div', 'preview-dimming'));
    const ui = node('div', 'preview-discord-ui'); ui.setAttribute('aria-hidden', 'true');
    const topbar = node('div', 'preview-topbar');
    const history = node('span', 'preview-history'); history.append(api.icon('back'), node('span', '', '→'));
    const windowControls = node('span', 'preview-window-controls'); windowControls.append(api.icon('minimize'), api.icon('maximize'), api.icon('close'));
    topbar.append(history, node('span', 'preview-window-name', 'Community'), windowControls);
    const servers = node('div', 'preview-servers');
    for (const letter of ['H', 'C', 'G', 'P', 'S', 'A', '+']) servers.append(node('span', 'preview-server', letter));
    const channels = node('div', 'preview-channels');
    const serverTitle = node('strong', 'preview-server-title', 'Community'); serverTitle.append(api.icon('chevron'));
    channels.append(serverTitle, node('span', 'preview-channel-group', 'CHANNELS'));
    for (const name of ['general', 'photos', 'projects', 'notes', 'ideas']) {
      const channel = node('span', `preview-channel${name === 'general' ? ' is-active' : ''}`);
      channel.append(node('span', 'preview-hash', '#'), document.createTextNode(name)); channels.append(channel);
    }
    channels.append(node('span', 'preview-channel-group', 'VOICE'));
    const voice = node('span', 'preview-channel preview-voice'); voice.append(api.icon('speaker'), document.createTextNode('Lounge')); channels.append(voice);
    const chat = node('div', 'preview-chat');
    const header = node('div', 'preview-chat-header');
    const channelTitle = node('strong', 'preview-channel-pill', '# general');
    const toolbar = node('div', 'preview-toolbar'); toolbar.append(api.icon('bell'), api.icon('pin'), api.icon('user'));
    const search = node('span', 'preview-search', 'Search Community'); search.append(api.icon('search')); toolbar.append(search); header.append(channelTitle, toolbar);
    const members = node('div', 'preview-members'); members.append(node('span', '', 'Online — 1'));
    const member = node('div', 'preview-member'); member.append(node('span', 'preview-avatar', 'G'), node('strong', '', 'Guest')); members.append(member);
    const welcome = node('div', 'preview-welcome'); welcome.append(node('span', 'preview-welcome-hash', '#'), node('strong', '', 'Welcome to #general!'), node('span', '', 'This is the start of the channel.'));
    const mention = node('div', 'preview-mention');
    const reply = node('div', 'preview-mention-reply'); reply.append(node('span', '', '↳'), node('span', 'preview-reply-avatar'), node('span', '', 'Replying to @you'));
    const author = node('div', 'preview-mention-author'); author.append(node('strong', '', 'Member'), node('span', '', 'Today at 12:00'));
    const body = node('div', 'preview-mention-body'); body.append(document.createTextNode('Thanks for sharing this, '), node('span', 'preview-inline-mention', '@you'), document.createTextNode('!'));
    mention.append(reply, node('span', 'preview-avatar preview-mention-avatar', 'M'), author, body);
    const composer = node('div', 'preview-input'); composer.append(node('span', 'preview-compose-plus', '+'), node('span', '', 'Message #general'), node('span', 'preview-compose-tools', 'GIF  ☺'));
    chat.append(header, members, welcome, mention, composer);
    const profile = node('div', 'preview-user'); profile.append(node('span', 'preview-avatar', 'G'));
    const userLabel = node('span', 'preview-user-label'); userLabel.append(node('strong', '', 'Guest'), node('span', '', 'Online'));
    const userTools = node('span', 'preview-user-tools'); userTools.append(api.icon('mic'), api.icon('headphones'), api.icon('gear')); profile.append(userLabel, userTools);
    ui.append(topbar, servers, channels, chat, profile); stage.append(ui); root.append(stage); previews.push(stage); return stage;
  }
  function updatePreviewColors() {
    previews = previews.filter(preview => preview.isConnected);
    const fields = api?.fields() || [], get = (name, fallback) => fields.find(field => field.name === name)?.value || fallback;
    for (const preview of previews) {
      preview.style.setProperty('--preview-accent', get('--main-color', '#5865f2'));
      preview.style.setProperty('--preview-mention', get('--mention-glass-tint', 'rgba(88,101,242,.2)'));
      preview.style.setProperty('--preview-mention-hover', get('--mention-glass-hover', get('--mention-glass-tint', 'rgba(88,101,242,.3)')));
      preview.style.setProperty('--preview-mention-accent', get('--mention-glass-accent', '#aab4ff'));
      preview.style.setProperty('--preview-dim-top', get('--bg-overlay-top', 'rgba(0,0,0,.25)'));
      preview.style.setProperty('--preview-dim-bottom', get('--bg-overlay-bottom', 'rgba(0,0,0,.5)'));
    }
  }

  function control(field, root, bridge) {
    api = bridge;
    const main = field.name === '--main-bg';
    const input = node('input', 'input'); input.type = 'text'; input.spellcheck = false; input.placeholder = 'Paste an image link, then crop it';
    const image = node('img', 'wallpaper-preview'); image.alt = `${field.label} preview`; image.hidden = true;
    const stage = discordPreview(root, image, main);
    const actions = node('div', 'wallpaper-actions');
    const picker = node('input', 'wallpaper-picker'); picker.type = 'file'; picker.hidden = true; picker.accept = 'image/png,image/jpeg,image/webp,image/gif'; picker.setAttribute('aria-label', `${field.label} local image`);
    const feedback = node('p', 'wallpaper-feedback'); feedback.setAttribute('role', 'status');
    const notice = node('p', 'wallpaper-notice', 'Crops are saved locally as still PNG images. Save Wallpapers to apply the background to your theme.');
    let previewRequest = 0, working = false;
    const sync = () => { input.readOnly = field.value.startsWith(localPrefix); input.value = input.readOnly ? 'Local image selected' : field.value; api.changed(); };
    const show = async source => {
      await Promise.resolve();
      const request = ++previewRequest, current = field.value;
      const paletteRequest = main ? ++paletteGeneration : 0;
      image.hidden = true; if (stage) stage.hidden = true;
      if (!current) { if (main) publishPalette(null, ''); return; }
      if (main && current !== paletteSource) publishPalette(null, current);
      try {
        source ||= await api.invoke('app_wallpaper', { uri: current });
        const decoded = await imageFrom(source);
        if (request !== previewRequest || current !== field.value || !root.isConnected) return;
        image.src = source; image.hidden = false;
        if (stage) stage.hidden = false;
        else image.style.aspectRatio = String(settingsAspect);
        if (main && paletteRequest === paletteGeneration) publishPalette(decoded, current);
        updatePreviewColors();
      } catch (error) {
        if (request === previewRequest) feedback.textContent = `Could not preview this image: ${error.message || error}`;
        if (main && paletteRequest === paletteGeneration) publishPalette(null, current);
      }
    };
    async function choose(source, meta, sourceUri) {
      if (working || api.busy()) return;
      working = true; local.disabled = edit.disabled = clear.disabled = link.disabled = true;
      try {
        feedback.textContent = 'Loading image…';
        const decoded = await imageFrom(source);
        feedback.textContent = '';
        const result = await crop(decoded, main, meta);
        if (!result) { sync(); return; }
        api.setBusy(true); feedback.textContent = 'Saving your crop locally…';
        sourceUri ||= await api.invoke('import_wallpaper', { data: source });
        const uri = await api.invoke('import_wallpaper', { data: result.data });
        saveMeta(uri, { sourceUri, ratio: result.ratio, zoom: result.zoom, x: result.x, y: result.y });
        field.value = uri; sync(); await show(result.data);
        feedback.textContent = 'Crop ready. Save Wallpapers to apply it.';
      } catch (error) { feedback.textContent = `Could not crop this image: ${error.message || error}`; sync(); }
      finally { working = false; api.setBusy(false); local.disabled = edit.disabled = clear.disabled = link.disabled = false; }
    }
    async function cropUri(uri) {
      if (!uri || working || api.busy()) return;
      try {
        const meta = readMeta(uri), sourceUri = meta?.sourceUri?.startsWith(localPrefix) ? meta.sourceUri : uri;
        const source = await api.invoke('app_wallpaper', { uri: sourceUri });
        await choose(source, meta, sourceUri.startsWith(localPrefix) ? sourceUri : undefined);
      } catch (error) { feedback.textContent = `Could not load this image: ${error.message || error}`; sync(); }
    }
    const local = button('Choose local image', () => { notice.textContent = 'Local files are never uploaded. Crops are saved locally as still PNG images. Save Wallpapers to apply the background.'; picker.click(); }); local.prepend(bridge.icon('folder'));
    const link = button('Use image link', () => {
      notice.textContent = 'Image links contact that website to load the source. Your crop is saved locally as a still PNG image.';
      if (input.readOnly) { input.readOnly = false; input.value = ''; }
      else if (/^https?:\/\//i.test(input.value.trim())) { cropUri(input.value.trim()); return; }
      input.focus();
    }); link.prepend(bridge.icon('image'));
    const edit = button('Crop & zoom', () => cropUri(input.readOnly ? field.value : input.value.trim() || field.value));
    const clear = button('Clear background', () => { if (working || api.busy()) return; field.value = ''; input.value = ''; previewRequest++; sync(); show(); }); clear.prepend(bridge.icon('trash'));
    input.addEventListener('change', () => { if (!input.readOnly && input.value.trim()) cropUri(input.value.trim()); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !input.readOnly) { event.preventDefault(); cropUri(input.value.trim()); } });
    picker.addEventListener('change', async () => { const file = picker.files[0]; if (!file) return; try { await choose(await readFile(file)); } catch (error) { feedback.textContent = error.message; } finally { picker.value = ''; } });
    root.addEventListener('paste', async event => {
      const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
      if (!file) return; event.preventDefault();
      try { await choose(await readFile(file)); } catch (error) { feedback.textContent = error.message; }
    });
    actions.append(local, link, edit, clear);
    if (main) recommendations(actions, '--main-color', 'Main Color', 2, true);
    root.append(input, actions, picker, notice, feedback); sync(); show(); return input;
  }
  function mount(bridge) {
    api = bridge;
    for (const field of api.fields().filter(field => field.kind === 'color' && (field.name === '--main-color' || field.name.startsWith('--mention-')))) {
      const root = [...document.querySelectorAll('.setting-row')].find(row => row.dataset.name === field.name)?.querySelector('.setting-control');
      if (root) recommendations(root, field.name, field.name === '--main-color' ? 'Main Color' : field.label);
    }
    refreshSwatches(); markTabs(); updatePreviewColors();
  }
  window.HotoriWallpaperTools = { control, mount, visit, updatePreviewColors, sample };
})();
