"use strict";

// Refract the compositor's real backdrop, never a screenshot or a copy of the
// wallpaper. Foreground text, icons, inputs and hit targets remain native DOM.
(() => {
  const selector = '.glass, .dock-surface, .dock-symbol, .window-controls, .window-button, #home-status, .theme-version, .button, .category-tab, .submenu, .setting-row, .guide-step, .input, select';
  const ns = 'http://www.w3.org/2000/svg';
  const surfaces = new Set();
  const cache = new Map();
  const supported = CSS.supports('backdrop-filter', 'url("#hotori-optics")');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('glass-optics-definitions');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  const defs = document.createElementNS(ns, 'defs'); svg.append(defs);
  document.body.append(svg);
  let serial = 0, frame = 0, resizeTimer;

  const smooth = value => value * value * (3 - 2 * value);
  function opticalMap(width, height, radius, panel) {
    const key = `${width}/${height}/${radius}/${panel}`;
    if (cache.has(key)) return cache.get(key);
    // Geometry is evaluated in CSS pixels; texture resolution is bounded.
    const density = Math.min(1, 512 / width, 384 / height);
    const w = Math.max(2, Math.ceil(width * density)), h = Math.max(2, Math.ceil(height * density));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const displacement = ctx.createImageData(w, h), highlights = ctx.createImageData(w, h);
    const bevel = Math.min(panel ? 16 : 10, radius * .65, height * .26);
    const thickness = panel ? 18 : 13;
    const maxShift = thickness * Math.tan(Math.asin(.88) - Math.asin(.88 / 1.45));
    const scale = maxShift * 2;
    const halfW = width / 2, halfH = height / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = (x + .5) / w * width - halfW, py = (y + .5) / h * height - halfH;
      const qx = Math.abs(px) - halfW + radius, qy = Math.abs(py) - halfH + radius;
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0), length = Math.hypot(ax, ay);
      const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
      let nx = 0, ny = 0;
      if (length > 0) { nx = Math.sign(px) * ax / length; ny = Math.sign(py) * ay / length; }
      else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
      const depth = Math.max(0, -distance);
      const rim = distance <= 0 ? 1 - smooth(Math.min(1, depth / bevel)) : 0;
      const slope = rim * .88;
      const bend = thickness * Math.tan(Math.asin(slope) - Math.asin(slope / 1.45));
      const i = (y * w + x) * 4;
      displacement.data[i] = Math.round(127.5 - nx * bend / scale * 255);
      displacement.data[i + 1] = Math.round(127.5 - ny * bend / scale * 255);
      displacement.data[i + 2] = 128; displacement.data[i + 3] = 255;
      // Rounded lens normals, a top-left key light and a weaker lower-right
      // reflection produce the rim; no rainbow gradients are painted on it.
      const nz = Math.sqrt(1 - slope * slope);
      const keyLight = Math.pow(Math.max(0, -nx * slope * .38 - ny * slope * .49 + nz * .78), 18);
      const fill = Math.pow(Math.max(0, nx * slope * .45 + ny * slope * .55 + nz * .70), 22);
      const fresnel = .034 + .966 * Math.pow(1 - nz, 5);
      const ridge = Math.exp(-Math.pow((depth - .8) / .75, 2));
      const rimLight = Math.max(0, -nx * .55 - ny * .8) * .42 + Math.max(0, nx * .4 + ny * .8) * .24 + .025;
      const caustic = Math.exp(-Math.pow((depth - bevel * .7) / Math.max(1, bevel * .16), 2)) * .012;
      const coverage = Math.max(0, Math.min(1, .5 - distance));
      const alpha = Math.min(.6, ridge * rimLight + Math.pow(rim, 3) * (keyLight * .10 + fill * .06 + fresnel * .12) + caustic) * coverage;
      highlights.data[i] = 255; highlights.data[i + 1] = 255; highlights.data[i + 2] = 255;
      highlights.data[i + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(displacement, 0, 0); const map = canvas.toDataURL();
    ctx.putImageData(highlights, 0, 0); const sheen = canvas.toDataURL();
    const filter = document.createElementNS(ns, 'filter');
    const id = `hotori-lens-${++serial}`;
    filter.id = id;
    for (const [name, value] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(name, value);
    const image = document.createElementNS(ns, 'feImage');
    image.setAttribute('href', map); image.setAttribute('width', '100%'); image.setAttribute('height', '100%');
    image.setAttribute('preserveAspectRatio', 'none'); image.setAttribute('result', 'lens-map');
    const refract = document.createElementNS(ns, 'feDisplacementMap');
    refract.setAttribute('in', 'SourceGraphic'); refract.setAttribute('in2', 'lens-map');
    refract.setAttribute('scale', scale.toFixed(3));
    refract.setAttribute('xChannelSelector', 'R'); refract.setAttribute('yChannelSelector', 'G');
    filter.append(image, refract); defs.append(filter);
    const result = { id, sheen, filter };
    cache.set(key, result);
    return result;
  }

  function update() {
    frame = 0;
    for (const surface of document.querySelectorAll(selector)) if (!surfaces.has(surface)) {
      surfaces.add(surface); surface.classList.add('optical-glass'); resize.observe(surface);
    }
    const used = new Set();
    for (const surface of surfaces) {
      if (!surface.isConnected) { resize.unobserve(surface); surfaces.delete(surface); continue; }
      const page = surface.closest('.page');
      if (page?.inert || !surface.checkVisibility({ checkVisibilityCSS: true })) continue;
      if (surface.matches('.guide-step') || (surface.closest('#settings-page') && !surface.matches('.settings-card, .settings-sidebar'))) {
        for (const property of ['--glass-refraction', '--glass-sheen-image', '--glass-picker-refraction', '--glass-picker-sheen-image']) surface.style.removeProperty(property);
        continue;
      }
      if (!supported) { surface.style.removeProperty('--glass-refraction'); continue; }
      const width = surface.offsetWidth, height = surface.offsetHeight;
      if (width < 2 || height < 2) continue;
      const radius = Math.min(parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0, width / 2, height / 2);
      const panel = surface.matches('.glass, .dock-surface, .submenu');
      const optics = opticalMap(width, height, radius, panel);
      used.add(optics.id);
      surface.style.setProperty('--glass-refraction', `url("#${optics.id}")`);
      surface.style.setProperty('--glass-sheen-image', `url("${optics.sheen}")`);
      if (surface.tagName === 'SELECT' && CSS.supports('appearance', 'base-select')) {
        const picker = opticalMap(width, surface.options.length * 40 + 14, 30, true);
        used.add(picker.id);
        surface.style.setProperty('--glass-picker-refraction', `url("#${picker.id}")`);
        surface.style.setProperty('--glass-picker-sheen-image', `url("${picker.sheen}")`);
      }
    }
    // Keep active maps, and bound cached maps left behind by resizing or rerenders.
    if (cache.size > 96) for (const [key, value] of cache) {
      if (used.has(value.id)) continue;
      value.filter.remove(); cache.delete(key);
      if (cache.size <= 96) break;
    }
    if (!document.querySelector('.shader-glass')) document.documentElement.dataset.glassRenderer = supported ? 'backdrop-refraction' : 'translucent-fallback';
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  const resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer); resizeTimer = setTimeout(schedule, 80);
  });
  const mutations = new MutationObserver(schedule);
  mutations.observe(document.getElementById('app'), {
    subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'inert', 'data-page'],
  });
  document.querySelectorAll('dialog').forEach(dialog => mutations.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('toggle', schedule, true);
  document.addEventListener('close', schedule, true);
  // The material responds to interaction without a perpetual render loop.
  let hoverFrame = 0, hoverTarget, pointer;
  document.addEventListener('pointermove', event => {
    if (reduceMotion.matches || event.pointerType === 'touch') return;
    hoverTarget = event.target.closest('.optical-glass'); pointer = { x: event.clientX, y: event.clientY };
    if (hoverFrame || !hoverTarget) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!hoverTarget) return;
      const box = hoverTarget.getBoundingClientRect();
      hoverTarget.style.setProperty('--glass-light-x', `${((pointer.x - box.x) / box.width * 100).toFixed(1)}%`);
      hoverTarget.style.setProperty('--glass-light-y', `${((pointer.y - box.y) / box.height * 100).toFixed(1)}%`);
    });
  }, { passive: true });
  schedule();
})();
