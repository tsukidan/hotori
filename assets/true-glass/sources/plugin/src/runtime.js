import { GlassRenderer, DEFAULTS, SHADOW_PAD } from './renderer.js';

const QUALITY = { low: .65, balanced: 1, high: 1.5 };
const HOST = 'hotori-true-glass-host';
const POSITION = 'hotori-true-glass-position';
const SELECTORS = [
  '[class^="sidebarList_"], [class*=" sidebarList_"]',
  '[class^="membersWrap_"], [class*=" membersWrap_"]',
  '[class^="guilds_"], [class*=" guilds_"], .wrapper_5dqHTG',
  '[class^="channelTextArea_"], [class*=" channelTextArea_"]',
];
const MEMBERS = '[class^="members_"], [class*=" members_"]';
const MEMBERS_WRAP = '[class^="membersWrap_"], [class*=" membersWrap_"]';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const css = `.${HOST}.${HOST}{isolation:isolate;background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
.${POSITION}{position:relative!important}
.${HOST}>.hotori-true-glass-output{position:absolute;pointer-events:none!important;z-index:-1;max-width:none!important;contain:strict}
.${HOST}.${HOST}:is([class^="channelTextArea_"],[class*=" channelTextArea_"])::before{background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
`;

/** Wallpaper-only runtime. No DOM capture, socket, or Vencord settings writes. */
export class GlassRuntime {
  constructor(options = {}) {
    this.options = { enabled: false, quality: 'balanced', ...options };
    this.layers = new Map(); this.cleanups = []; this.generation = 0;
    this.metrics = { paints: 0, checks: 0, sceneBuilds: 0, lastCpuMs: 0 };
    this.state = 'stopped'; this.frame = 0;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.state = 'suspended';
    this.style = document.createElement('style'); this.style.textContent = css;
    document.head.append(this.style);
    const schedule = () => this.schedule();
    const listen = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      this.cleanups.push(() => target.removeEventListener(name, fn, options));
    };
    this.resizeObserver = new ResizeObserver(schedule);
    this.resizeObserver.observe(document.documentElement);
    listen(window, 'resize', schedule);
    listen(document, 'scroll', schedule, true);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.frame); this.frame = 0; }
      else this.schedule();
    });
    listen(document, 'transitionrun', event => {
      if ([...this.layers.keys()].some(el => el === event.target || event.target.contains?.(el))) {
        this.trackUntil = performance.now() + 2000; this.schedule();
      }
    }, true);
    listen(document, 'transitionend', schedule, true);
    // A low-frequency geometry/settings check covers route remounts and stylesheet
    // replacement without subscribing to Discord's message mutation stream.
    this.timer = setInterval(schedule, 500);
    this.schedule();
  }
  update(options) {
    this.options = { ...this.options, ...options };
    if (!this.options.enabled) this.release('disabled');
    this.schedule();
  }
  schedule() {
    if (this.running && !this.frame && !document.hidden)
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.check(); });
  }
  detach(el, layer) {
    this.resizeObserver?.unobserve(el); layer.canvas.remove();
    el.classList.remove(HOST, POSITION); this.layers.delete(el);
    layer.canvas.width = layer.canvas.height = 0;
  }
  release(state) {
    this.generation++;
    for (const [el, layer] of this.layers) this.detach(el, layer);
    this.renderer?.destroy(); this.renderer = null;
    if (this.scene) this.scene.width = this.scene.height = 0;
    this.scene = null; this.image = null; this.source = ''; this.sceneKey = '';
    this.state = state;
  }
  stop() {
    this.running = false; cancelAnimationFrame(this.frame); this.frame = 0;
    clearInterval(this.timer); this.resizeObserver?.disconnect();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.release('stopped'); this.style?.remove();
  }
  getStats() {
    return { ...this.metrics, state: this.state, error: this.error || null,
      panels: this.layers.size, renderer: this.renderer?.getStats() || null,
      note: 'CPU submission time and allocation estimates are not GPU timings or measured VRAM.' };
  }
  settings() {
    const style = getComputedStyle(document.body);
    const get = name => style.getPropertyValue(name).trim();
    return { profile: Number(get('--blur-profile')), source: get('--main-bg'),
      top: get('--bg-overlay-top') || 'transparent', bottom: get('--bg-overlay-bottom') || 'transparent',
      tint: get('--glass-background') || 'transparent',
      blur: clamp(parseFloat(get('--liquid-blur-val')) || 2.5, 0, 10),
      saturation: clamp(parseFloat(get('--liquid-saturation')) || 100, 0, 400) };
  }
  async load(source) {
    const generation = ++this.generation;
    this.source = source; this.state = 'loading';
    let objectUrl;
    try {
    const match = /^url\(\s*(['"]?)(.*?)\1\s*\)$/.exec(source);
    if (!match) throw new Error('Choose one static, sampleable wallpaper.');
    const url = new URL(match[2], location.href);
    if (!['https:', 'http:', 'vencord:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('Unsupported wallpaper source.');
    let imageSource = url.href;
    if (url.protocol === 'vencord:' && this.options.resolveLocalWallpaper) {
      const wallpaper = await this.options.resolveLocalWallpaper(url.href);
      if (!this.running || generation !== this.generation) return;
      objectUrl = URL.createObjectURL(new Blob([wallpaper.bytes], { type: wallpaper.mime }));
      imageSource = objectUrl;
    }
    const image = new Image(); image.crossOrigin = 'anonymous'; image.src = imageSource;
    await image.decode();
    if (!this.running || generation !== this.generation) return;
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Wallpaper dimensions exceed prototype limits.');
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const ctx = probe.getContext('2d'); ctx.drawImage(image, 0, 0, 1, 1); ctx.getImageData(0, 0, 1, 1);
    this.image = image; this.sceneKey = ''; this.state = 'ready'; this.schedule();
    } catch (error) {
      if (this.running && generation === this.generation) { this.error = String(error); this.state = 'fallback'; }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  check() {
    if (!this.running || document.hidden) return;
    this.metrics.checks++;
    const began = performance.now();
    try {
      const settings = this.settings();
      if (!this.options.enabled || settings.profile !== 1 || !settings.source || settings.source === 'none' || matchMedia('(forced-colors: active)').matches) {
        if (this.renderer || this.image || this.state !== 'suspended') this.release('suspended');
        return;
      }
      if (settings.source !== this.source) {
        this.release('loading');
        void this.load(settings.source);
        return;
      }
      if (!this.image || this.state === 'fallback' || this.state === 'context-lost') return;
      const selected = [...new Set((this.options.selectors || SELECTORS).map(selector => document.querySelector(selector)).filter(Boolean))].slice(0, 4);
      for (const [el, layer] of this.layers) if (!selected.includes(el) || !el.isConnected) this.detach(el, layer);
      if (!selected.length) { this.state = 'waiting-for-panels'; return; }
      const density = Math.min(devicePixelRatio || 1, QUALITY[this.options.quality] || 1,
        Math.sqrt(4_000_000 / Math.max(1, innerWidth * innerHeight)));
      const sceneKey = JSON.stringify([settings.source, settings.top, settings.bottom, settings.saturation, innerWidth, innerHeight, density]);
      if (sceneKey !== this.sceneKey) {
        this.scene ||= document.createElement('canvas');
        this.scene.width = Math.ceil(innerWidth * density); this.scene.height = Math.ceil(innerHeight * density);
        const ctx = this.scene.getContext('2d');
        const scale = Math.max(this.scene.width / this.image.naturalWidth, this.scene.height / this.image.naturalHeight);
        const w = this.image.naturalWidth * scale, h = this.image.naturalHeight * scale;
        ctx.filter = `saturate(${settings.saturation}%)`;
        ctx.drawImage(this.image, (this.scene.width-w)/2, (this.scene.height-h)/2, w, h);
        ctx.filter = 'none'; const gradient = ctx.createLinearGradient(0, 0, 0, this.scene.height);
        gradient.addColorStop(0, settings.top); gradient.addColorStop(1, settings.bottom);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, this.scene.width, this.scene.height);
        this.sceneKey = sceneKey; this.metrics.sceneBuilds++;
      }
      if (!this.renderer) {
        this.renderer = new GlassRenderer({ framebufferBudgetBytes: 64 * 1024 * 1024 });
        const renderer = this.renderer;
        renderer.canvas.addEventListener('webglcontextlost', event => {
          if (this.renderer !== renderer || !this.running) return;
          event.preventDefault(); this.state = 'context-lost';
          for (const [el, layer] of this.layers) this.detach(el, layer);
        });
        renderer.canvas.addEventListener('webglcontextrestored', () => {
          if (this.renderer !== renderer || !this.running) return;
          this.state = renderer.contextLost ? 'fallback' : 'ready';
          if (renderer.restoreError) this.error = String(renderer.restoreError);
          this.schedule();
        });
      }
      for (const el of selected) this.paint(el, settings, density);
      this.state = 'active'; this.error = null;
      if (performance.now() < (this.trackUntil || 0)) this.schedule();
    } catch (error) {
      this.release('fallback'); this.error = String(error);
      // Keep failed source so periodic checks do not repeatedly allocate a broken renderer.
      this.source = this.settings().source;
    } finally { this.metrics.lastCpuMs = performance.now() - began; }
  }
  paint(el, settings, dpr) {
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (box.width < 2 || box.height < 2 || box.bottom <= 0 || box.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none') {
      const previous = this.layers.get(el); if (previous) this.detach(el, previous); return;
    }
    // The first adapter supports untransformed panel owners only.
    if (style.transform !== 'none' || Math.abs(el.offsetWidth - box.width) > 2 || Math.abs(el.offsetHeight - box.height) > 2) {
      const previous = this.layers.get(el); if (previous) this.detach(el, previous); return;
    }
    // Discord's wrapper owns layout/hover expansion; the inner scrolling
    // member-list surface owns the theme's rounding. Keep output on the wrapper
    // so it never becomes scrolling content or changes overflow on either node.
    const isMembers = el.matches(MEMBERS_WRAP);
    const surface = isMembers ? el.querySelector(MEMBERS) || el : el;
    const surfaceRadius = getComputedStyle(surface).borderTopLeftRadius;
    // Hotori currently rounds member rows, not the list or its wrapper. The
    // added optical panel still needs the theme's 16px structural-panel default
    // when both computed radii are zero. Do not write it onto the scrolling DOM.
    const radiusValue = isMembers
      ? (parseFloat(surfaceRadius) > 0 ? surfaceRadius : parseFloat(style.borderTopLeftRadius) > 0 ? style.borderTopLeftRadius : '16px')
      : surfaceRadius;
    const radius = Math.min(box.width/2, box.height/2, radiusValue.endsWith('%') ? parseFloat(radiusValue)*Math.min(box.width,box.height)/100 : parseFloat(radiusValue) || 0);
    const key = JSON.stringify([this.sceneKey, box.x, box.y, box.width, box.height, radius, settings.tint, settings.blur, dpr]);
    let layer = this.layers.get(el);
    if (layer?.key === key && layer.canvas.parentNode === el) return;
    const width = Math.ceil((box.width + SHADOW_PAD*2)*dpr), height = Math.ceil((box.height + SHADOW_PAD*2)*dpr);
    if (width*height > 4_000_000) throw new Error('Panel exceeds prototype pixel budget.');
    // Wallpaper dimming and the selected tint already control darkness. Do not
    // stack the installer's fixed hero-panel darkening onto Discord's material.
    // A 60px bevel cannot flatten before the center of a 72px rail: opposing
    // normals meet in a visible refractive crease. Fit it to the short axis,
    // leaving a flat middle, and return continuously to the full bevel at 240px.
    const zRadius = Math.min(60, Math.min(box.width, box.height) / 4);
    const config = { ...DEFAULTS, blurAmount: .3*settings.blur/2.5, refraction: 1.2, chromAberration: .2, zRadius, brightness: 0, cornerRadius: radius };
    this.renderer.uploadAndBlur(this.scene, Math.round((box.left-SHADOW_PAD)*dpr), Math.round((box.top-SHADOW_PAD)*dpr), width, height, config.blurAmount);
    this.renderer.clear(); this.renderer.renderGlassPanel(config, box.width, box.height, dpr);
    if (!layer) {
      const canvas = document.createElement('canvas'); canvas.className = 'hotori-true-glass-output'; canvas.setAttribute('aria-hidden','true');
      layer = { canvas }; this.layers.set(el, layer); this.resizeObserver.observe(el);
    }
    const canvas = layer.canvas; canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.beginPath(); ctx.roundRect(SHADOW_PAD*dpr,SHADOW_PAD*dpr,box.width*dpr,box.height*dpr,radius*dpr); ctx.clip();
    ctx.drawImage(this.renderer.canvas,0,0,width,height,0,0,width,height);
    ctx.fillStyle = settings.tint; ctx.fillRect(0,0,width,height); ctx.restore();
    Object.assign(canvas.style, { left: `${-SHADOW_PAD-el.clientLeft}px`, top: `${-SHADOW_PAD-el.clientTop}px`, width: `${width/dpr}px`, height: `${height/dpr}px` });
    if (style.position === 'static') el.classList.add(POSITION);
    el.classList.add(HOST); if (canvas.parentNode !== el) el.prepend(canvas);
    layer.key = key; this.metrics.paints++;
  }
}
