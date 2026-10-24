"use strict";

// Hotori's hierarchy adapter for the pinned LiquidGlass 1.0.3 renderer.
// The vendor owns panel optics and blur; glass-wordmark.js adds glyph optics.
(() => {
  const vendor = window.HotoriLiquidGlass;
  if (!vendor) return;
  const selector = '.glass, .glass-wordmark, .dock-surface, .dock-symbol, .window-controls, .window-button, #home-status, .theme-version, .button, .category-tab, .submenu, .setting-row, .guide-step, .input, select';
  const excluded = '.glass-render-layer, .glass-optics-definitions, [data-glass-exclude], script, style, link, iframe';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const layers = new Map(), captures = new Map();
  const isAcrylic = element => element.matches('.guide-step') || (!!element.closest('#settings-page') && !element.matches('.settings-card, .settings-sidebar'));
  const mediaAccess = new WeakMap();
  const mediaProbe = document.createElement('canvas'); mediaProbe.width = mediaProbe.height = 1;
  const scene = document.createElement('canvas'), sceneContext = scene.getContext('2d');
  const wallpaper = document.querySelector('.wallpaper');
  const fonts = new vendor.HtmlCapture(document.body);
  const pad = vendor.SHADOW_PAD;
  let renderer, frame = 0, failed = false, image, imageURL = '', lastSize = '', dpr = 1;
  let styles, captureGeneration = 0;
  try { renderer = new vendor.GlassRenderer(); } catch { return; }
  const wordmark = window.HotoriGlassWordmark ? new window.HotoriGlassWordmark(renderer) : null;
  renderer.canvas.dataset.glassExclude = '';
  const styleOf = element => {
    if (!styles.has(element)) styles.set(element, getComputedStyle(element));
    return styles.get(element);
  };
  function schedule() {
    if (!frame && !failed && !document.hidden) frame = requestAnimationFrame(render);
  }
  function fallback() {
    failed = true;
    for (const [element] of layers) element.classList.remove('shader-glass');
    document.documentElement.dataset.glassRenderer = 'backdrop-refraction';
  }
  renderer.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); });
  renderer.canvas.addEventListener('webglcontextrestored', () => { failed = false; lastSize = ''; schedule(); });
  fonts.prefetchFontEmbedCSS().then(schedule).catch(() => {});
  document.fonts.ready.then(() => { wordmark?.invalidate(); schedule(); });

  // These are the live website's presets, with Hotori's existing control sizes.
  function material(element, box) {
    const main = element.matches('.glass:not(.submenu)');
    const dock = element.matches('.dock-surface');
    const button = element.matches('button, .category-tab, .dock-symbol');
    const config = { ...vendor.DEFAULTS, blurAmount: dock ? .5 : .25 };
    if (main) Object.assign(config, { blurAmount: .3, refraction: 1.2, chromAberration: .2, zRadius: 60, brightness: -.2 });
    if (button) Object.assign(config, { blurAmount: .3, brightness: -.1 });
    if (isAcrylic(element)) {
      Object.assign(config, {
        blurAmount: 0,
        refraction: 0, chromAberration: 0, specular: 0, fresnel: 0, edgeHighlight: 0, brightness: -.06,
      });
    }
    const scale = Math.min(box.width / (element.offsetWidth || box.width), box.height / (element.offsetHeight || box.height));
    config.cornerRadius = Math.min(parseFloat(styleOf(element).borderTopLeftRadius) || 0, (element.offsetWidth || box.width) / 2, (element.offsetHeight || box.height) / 2) * scale;
    config.zRadius *= scale;
    // Retain the requested muted hover. The site's button response is +0.2;
    // Hotori uses one quarter of it, with no added pointer-following light.
    if (button && !element.matches(':disabled')) {
      if (element.matches(':active')) { config.zRadius *= .8; config.shadowSpread *= 1.2; }
      else if (!motion.matches && element.matches(':hover')) config.brightness += .05;
    }
    if (element.matches('[aria-selected="true"], [aria-pressed="true"], .primary')) config.brightness += .06;
    if (element.dataset.config) {
      try { Object.assign(config, JSON.parse(element.dataset.config)); } catch { /* Keep the preset for malformed overrides. */ }
    }
    return config;
  }
  function visible(element) {
    return !element.matches(excluded) && element !== wallpaper && !element.closest('[inert], [data-glass-exclude]') && element.checkVisibility({ checkVisibilityCSS: true });
  }
  function withClip(element, draw) {
    sceneContext.save();
    let opacity = 1;
    for (let parent = element; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = styleOf(parent);
      opacity *= Number(style.opacity);
      if (parent === element) continue;
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
      const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
      if (!clipX && !clipY) continue;
      const r = parent.getBoundingClientRect();
      const x = clipX ? r.left : -scene.width / dpr, y = clipY ? r.top : -scene.height / dpr;
      const w = clipX ? r.width : scene.width / dpr * 3, h = clipY ? r.height : scene.height / dpr * 3;
      sceneContext.beginPath();
      sceneContext.roundRect(x * dpr, y * dpr, w * dpr, h * dpr, clipX && clipY ? Math.min(parseFloat(style.borderTopLeftRadius) || 0, w / 2, h / 2) * dpr : 0);
      sceneContext.clip();
    }
    sceneContext.globalAlpha = opacity;
    draw(); sceneContext.restore();
  }
  function background() {
    const style = styleOf(wallpaper), url = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) return false;
    if (url !== imageURL) {
      imageURL = url; image = new Image(); image.onload = schedule; image.onerror = fallback; image.src = url;
    }
    if (!image.complete || !image.naturalWidth) return false;
    const box = wallpaper.getBoundingClientRect();
    const cover = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const width = image.naturalWidth * cover, height = image.naturalHeight * cover;
    sceneContext.fillStyle = styleOf(document.documentElement).backgroundColor; sceneContext.fillRect(0, 0, scene.width, scene.height);
    sceneContext.drawImage(image, box.left * dpr, (box.top + (box.height - height) / 2) * dpr, width * dpr, height * dpr);
    const colors = style.backgroundImage.split('url(')[0].match(/rgba?\([^)]+\)/g);
    if (colors?.length >= 2) {
      const gradient = sceneContext.createLinearGradient(0, box.top * dpr, 0, box.bottom * dpr);
      gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
      sceneContext.fillStyle = gradient; sceneContext.fillRect(0, 0, scene.width, scene.height);
    }
    return true;
  }
  const resize = new ResizeObserver(schedule);
  function layerFor(element) {
    let layer = layers.get(element);
    if (!layer || (!layer.image && layer.canvas.parentElement !== element)) {
      const canvas = document.createElement('canvas');
      canvas.className = 'glass-render-layer'; canvas.setAttribute('aria-hidden', 'true');
      layer = { canvas, context: canvas.getContext('2d'), image: element.matches('input, select, textarea'), position: '' };
      layers.set(element, layer); resize.observe(element);
      if (!layer.image) element.prepend(canvas);
    }
    return layer;
  }
  function paintGlass(element, box) {
    const layer = layerFor(element), width = Math.round((box.width + pad * 2) * dpr), height = Math.round((box.height + pad * 2) * dpr);
    if (!element.classList.contains('shader-glass')) element.classList.add('shader-glass');
    const isWordmark = element.matches('.glass-wordmark');
    const config = material(element, box);
    if (layer.canvas.width !== width || layer.canvas.height !== height) { layer.canvas.width = width; layer.canvas.height = height; }
    layer.context.clearRect(0, 0, width, height);
    if (isAcrylic(element)) paintAcrylic(layer.context, box, config.cornerRadius);
    else {
      renderer.uploadAndBlur(scene, Math.round((box.left - pad) * dpr), Math.round((box.top - pad) * dpr), width, height, isWordmark ? .25 : config.blurAmount);
      if (isWordmark && wordmark) wordmark.render(element, width, height, dpr, pad * dpr);
      else { renderer.clear(); renderer.renderGlassPanel(config, box.width, box.height, dpr); }
      layer.context.drawImage(renderer.canvas, 0, 0, width, height, 0, 0, width, height);
    }
    if (layer.image) {
      // Replaced controls cannot host a canvas; use its exact interior as paint.
      const interior = document.createElement('canvas'); interior.width = Math.round(box.width * dpr); interior.height = Math.round(box.height * dpr);
      interior.getContext('2d').drawImage(layer.canvas, Math.round(pad * dpr), Math.round(pad * dpr), interior.width, interior.height, 0, 0, interior.width, interior.height);
      element.style.setProperty('--shader-surface-image', `url("${interior.toDataURL()}")`);
    } else {
      const sx = box.width / (element.offsetWidth || box.width), sy = box.height / (element.offsetHeight || box.height);
      const style = styleOf(element);
      const position = `left:${-pad / sx - parseFloat(style.borderLeftWidth)}px;top:${-pad / sy - parseFloat(style.borderTopWidth)}px;width:${(box.width + pad * 2) / sx}px;height:${(box.height + pad * 2) / sy}px`;
      if (position !== layer.position) { layer.canvas.style.cssText = position; layer.position = position; }
    }
    withClip(element, () => sceneContext.drawImage(layer.canvas, (box.left - pad) * dpr, (box.top - pad) * dpr, width, height));
  }
  function paintAcrylic(context, box, radius) {
    const padding = pad * dpr, blur = 24 * dpr;
    const left = (box.left - pad) * dpr, top = (box.top - pad) * dpr;
    // Capture a three-sigma margin so the fixed 24 CSS-pixel blur samples
    // beyond the card boundary rather than darkening its edges.
    const x = Math.max(0, Math.floor(left - blur * 3)), y = Math.max(0, Math.floor(top - blur * 3));
    const width = Math.min(scene.width - x, Math.ceil(context.canvas.width + blur * 6));
    const height = Math.min(scene.height - y, Math.ceil(context.canvas.height + blur * 6));
    context.save();
    context.filter = `blur(${blur}px)`;
    context.drawImage(scene, x, y, width, height, x - left, y - top, width, height);
    context.filter = 'none';
    context.globalCompositeOperation = 'destination-in';
    context.beginPath(); context.roundRect(padding, padding, box.width * dpr, box.height * dpr, radius * dpr);
    context.fillStyle = '#fff'; context.fill();
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = 'rgba(16, 18, 22, .20)'; context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalCompositeOperation = 'destination-over';
    context.shadowColor = 'rgba(0, 0, 0, .24)'; context.shadowBlur = 10 * dpr; context.shadowOffsetY = 2 * dpr;
    context.fillStyle = 'rgba(0, 0, 0, .10)'; context.fill();
    context.restore();
  }
  function ownsPaint(element) {
    const style = styleOf(element);
    return [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) ||
      style.backgroundImage !== 'none' || !/rgba\([^)]*, 0\)|transparent/.test(style.backgroundColor) || style.boxShadow !== 'none' ||
      ['Top','Right','Bottom','Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && !/rgba\([^)]*, 0\)|transparent/.test(style[`border${side}Color`]));
  }
  function requestCapture(element, ownOnly, box) {
    const width = element.offsetWidth || box.width, height = element.offsetHeight || box.height;
    const signature = `${width}/${height}/${dpr}/${ownOnly}`;
    let entry = captures.get(element);
    if (!entry) { entry = { dirty: true, signature: '', generation: 0 }; captures.set(element, entry); resize.observe(element); }
    if (entry.pending || (!entry.dirty && entry.signature === signature)) return entry.canvas;
    entry.pending = true; entry.dirty = false; entry.signature = signature;
    const generation = entry.generation = ++captureGeneration;
    vendor.toCanvas(element, {
      width, height, pixelRatio: dpr, fontEmbedCSS: fonts.fontEmbedCSSForElement(element),
      filter: node => !node.matches?.(excluded) && (!ownOnly || node.parentElement === element),
      onCloneNode: (native, clone) => {
        if (native !== element && ownOnly) clone.style.setProperty('visibility', 'hidden', 'important');
        if (native.tagName === 'IMG' && canSampleImage(native) === false) {
          // Keep its layout and live preview intact. An unreadable remote
          // image must never taint the shared scene or disable every lens.
          clone.removeAttribute('srcset'); clone.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
          clone.style.setProperty('visibility', 'hidden', 'important');
        }
      },
      style: { position: 'relative', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto', transform: 'none', margin: '0', opacity: '1',
        ...(element.matches(selector) ? { background: 'transparent', backgroundImage: 'none', borderColor: 'transparent', boxShadow: 'none', backdropFilter: 'none', webkitBackdropFilter: 'none', outline: 'none' } : {}) },
    }).then(canvas => {
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
      if (entry.generation === generation && element.isConnected) entry.canvas = canvas;
    })
      .catch(error => { console.warn('Glass content capture unavailable:', element.tagName, error.message); })
      .finally(() => { entry.pending = false; schedule(); });
    return entry.canvas;
  }
  function canSampleImage(element) {
    if (!element.complete || !element.naturalWidth) return undefined;
    const source = element.currentSrc || element.src;
    const cached = mediaAccess.get(element);
    if (cached?.source === source) return cached.allowed;
    let allowed = true;
    mediaProbe.width = 1; // Reset the probe's origin-clean flag each time.
    try {
      const context = mediaProbe.getContext('2d'); context.drawImage(element, 0, 0, 1, 1); context.getImageData(0, 0, 1, 1);
    } catch { allowed = false; }
    mediaAccess.set(element, { source, allowed }); return allowed;
  }
  function paintContent(element, ownOnly, box) {
    if (box.width <= 0 || box.height <= 0) return;
    if (!ownOnly && element.tagName === 'IMG' && element.complete && element.naturalWidth) {
      if (!canSampleImage(element)) return;
      const style = styleOf(element), fitted = vendor.LiquidGlass._objectFitRect(element.naturalWidth, element.naturalHeight, box.width, box.height, style.objectFit, style.objectPosition);
      withClip(element, () => sceneContext.drawImage(element, fitted.sx, fitted.sy, fitted.sw, fitted.sh, box.left * dpr, box.top * dpr, box.width * dpr, box.height * dpr));
      return;
    }
    const canvas = requestCapture(element, ownOnly, box);
    if (canvas) withClip(element, () => sceneContext.drawImage(canvas, box.left * dpr, box.top * dpr, box.width * dpr, box.height * dpr));
  }
  function walk(element) {
    if (!visible(element)) return;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || box.bottom < -pad || box.top > innerHeight + pad || box.right < -pad || box.left > innerWidth + pad) return;
    const glass = element.matches(selector);
    if (glass) paintGlass(element, box);
    if (glass && element.matches('.glass-wordmark')) return;
    const branch = !!element.querySelector(selector);
    if (!branch) { if (element.childNodes.length || element.matches('input, select, textarea, img')) paintContent(element, false, box); return; }
    if (ownsPaint(element)) paintContent(element, true, box);
    const children = [...element.children].filter(child => !child.matches(excluded));
    children.sort((a, b) => {
      const z = node => node.matches('dialog[open]') ? 1e6 : parseInt(styleOf(node).zIndex, 10) || 0;
      return z(a) - z(b);
    });
    for (const child of children) walk(child);
  }
  function paintPickers() {
    if (!CSS.supports('appearance', 'base-select')) return;
    for (const select of document.querySelectorAll('select:open')) {
      const options = [...select.options].map(option => option.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0);
      if (!options.length) continue;
      const left = Math.min(...options.map(box => box.left)) - 7, top = Math.min(...options.map(box => box.top)) - 7;
      const width = Math.max(...options.map(box => box.right)) - left + 7, height = Math.max(...options.map(box => box.bottom)) - top + 7;
      const w = Math.round((width + pad * 2) * dpr), h = Math.round((height + pad * 2) * dpr);
      const acrylic = document.createElement('canvas'); acrylic.width = w; acrylic.height = h;
      paintAcrylic(acrylic.getContext('2d'), { left, top, width, height }, Math.min(30, width / 2, height / 2));
      const interior = document.createElement('canvas'); interior.width = Math.round(width * dpr); interior.height = Math.round(height * dpr);
      interior.getContext('2d').drawImage(acrylic, Math.round(pad * dpr), Math.round(pad * dpr), interior.width, interior.height, 0, 0, interior.width, interior.height);
      select.style.setProperty('--shader-picker-image', `url("${interior.toDataURL()}")`);
    }
  }
  function render() {
    frame = 0; if (failed || renderer.contextLost) return;
    styles = new Map();
    try {
      dpr = devicePixelRatio || 1;
      const width = Math.round(innerWidth * dpr), height = Math.round(innerHeight * dpr);
      if (lastSize !== `${width}/${height}`) {
        scene.width = width; scene.height = height; renderer.resize(width, height); lastSize = `${width}/${height}`;
      }
      if (!background()) return;
      walk(document.body);
      paintPickers();
      for (const [element] of layers) if (!element.isConnected) { resize.unobserve(element); layers.delete(element); }
      for (const [element] of captures) if (!element.isConnected) { resize.unobserve(element); captures.delete(element); }
      document.documentElement.dataset.glassRenderer = 'reference-liquidglass';
      if (document.getAnimations().some(animation => animation.playState === 'running')) schedule();
    } catch (error) { console.warn('LiquidGlass fallback:', error); fallback(); }
  }
  function invalidateContent(element) {
    for (let node = element; node; node = node.parentElement) {
      const entry = captures.get(node); if (entry) entry.dirty = true;
    }
  }
  new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (!element || element.closest(excluded)) continue;
      if (record.type === 'attributes' && record.attributeName === 'style' && element.matches(`${selector}, .dock-item`)) continue;
      if (record.type === 'attributes' && record.attributeName === 'class') {
        const clean = value => (value || '').split(/\s+/).filter(name => name && !['optical-glass','shader-glass'].includes(name)).sort().join(' ');
        if (clean(record.oldValue) === clean(element.getAttribute('class'))) continue;
      }
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 1 && node.matches(excluded))) continue;
      invalidateContent(element); changed = true;
    }
    if (changed) schedule();
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
    attributeFilter: ['class','hidden','open','inert','data-page','data-config','style','aria-selected','aria-pressed','disabled','src'] });
  document.addEventListener('input', event => { invalidateContent(event.target); schedule(); }, true);
  document.addEventListener('load', event => { if (event.target.tagName === 'IMG') invalidateContent(event.target); schedule(); }, true);
  for (const event of ['scroll','transitionrun','transitionend','animationstart','animationend','toggle','close','load','click','keydown']) document.addEventListener(event, schedule, true);
  window.addEventListener('resize', schedule);
  let hovered;
  document.addEventListener('pointermove', event => {
    const target = event.target.closest?.(selector);
    if (target !== hovered) { hovered = target; schedule(); }
  }, { passive: true });
  for (const event of ['pointerdown','pointerup','pointercancel','visibilitychange']) document.addEventListener(event, schedule, true);
  document.addEventListener('hotori:glass-invalidate', () => { for (const entry of captures.values()) entry.dirty = true; schedule(); });
  schedule();
})();
