"use strict";

// One GPU context for the whole UI. Glass is drawn back-to-front into a shared
// scene texture; native DOM text, controls and hit targets stay above each lens.
// Optical model: rounded cross-section, entry/exit refraction, dispersion and
// Fresnel reflection. No texture noise and no prerecorded highlight images.
(() => {
  const selector = '.glass, .dock-surface, .dock-symbol, .window-controls, .window-button, #home-status, .theme-version, .button, .category-tab, .submenu, .setting-row, .input, select';
  const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const gpu = document.createElement('canvas');
  const gl = gpu.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return; // Keep the compositor refraction fallback.
  const surfaces = new Map();
  const scene = document.createElement('canvas');
  const scene2d = scene.getContext('2d');
  const tile = document.createElement('canvas'), tile2d = tile.getContext('2d');
  const wallpaper = document.querySelector('.wallpaper');
  let frame = 0, ready = false, failed = false, sourceKey = '', sourceImage, pointer = [-1000, -1000];
  const vertex = `attribute vec2 position; varying vec2 uv;
    void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision highp float;
    uniform sampler2D backdrop, frostedBackdrop;
    uniform vec2 resolution, origin, size, pointer;
    uniform float radius, curvature, strength, frost, pressed, hover, selected;
    varying vec2 uv;
    float distanceToGlass(vec2 p) {
      vec2 q=abs(p)-size*.5+radius;
      return length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
    }
    float heightAt(vec2 p) {
      float d=clamp(-distanceToGlass(p),0.,curvature);
      return sqrt(max(0.,d*(2.*curvature-d)));
    }
    vec3 sampleScene(vec2 p, vec2 dispersion) {
      vec2 coord=(origin+p)/resolution;
      vec2 delta=dispersion/resolution;
      return vec3(texture2D(backdrop,coord+delta).r,
                  texture2D(backdrop,coord).g,
                  texture2D(backdrop,coord-delta).b);
    }
    void main(){
      vec2 point=uv*size;
      vec2 p=point-size*.5;
      float sdf=distanceToGlass(p);
      vec2 original=(origin+point)/resolution;
      if(sdf>0.){gl_FragColor=texture2D(backdrop,original);return;}
      // The normal spans the entire curved bevel rather than a painted rim.
      float stepSize=.65;
      vec2 gradient=vec2(heightAt(p+vec2(stepSize,0.))-heightAt(p-vec2(stepSize,0.)),
                         heightAt(p+vec2(0.,stepSize))-heightAt(p-vec2(0.,stepSize)))/(2.*stepSize);
      vec3 normal=normalize(vec3(-gradient,1.));
      float depth=heightAt(p)/curvature;
      // Both curved interfaces bend the ray, with a small interior lens zoom.
      vec2 bend=gradient*(1.-1./1.5)*(2.+depth*.5)*strength*30.;
      bend-=p/max(size*.5,vec2(1.))*strength*4.*smoothstep(0.,curvature,-sdf);
      bend*=1.-pressed*.22;
      vec2 dispersion=normal.xy*.65;
      vec2 samplePoint=point+bend;
      vec3 sharp=sampleScene(samplePoint,dispersion);
      vec2 frostedUV=(origin+samplePoint)/resolution;
      vec2 split=dispersion/resolution;
      vec3 soft=vec3(texture2D(frostedBackdrop,frostedUV+split).r,
                     texture2D(frostedBackdrop,frostedUV).g,
                     texture2D(frostedBackdrop,frostedUV-split).b);
      // Diffuse the interior, but keep the bevel's bent image relatively crisp.
      float edge=smoothstep(0.,max(3.,curvature*.55),-sdf);
      vec3 color=mix(sharp,soft,frost*(.4+.6*edge));
      // Curved surfaces reflect more at grazing angles (Schlick approximation).
      float fresnel=.04+.96*pow(1.-normal.z,5.);
      vec3 light=normalize(vec3(-.45,-.65,1.));
      vec3 interactive=normalize(vec3((pointer-origin-point)/max(size,vec2(1.)),1.8));
      float spec=pow(max(dot(normal,normalize(light+vec3(0.,0.,1.))),0.),80.);
      float glint=pow(max(dot(normal,normalize(interactive+vec3(0.,0.,1.))),0.),100.);
      float rim=exp(-pow((-sdf-.7)/.75,2.))*(.35+.65*max(0.,dot(normal.xy,normalize(vec2(-.5,-.8)))));
      color*=.97+depth*.035+hover*.006;
      color=mix(color,vec3(.93,.96,1.),fresnel*.22);
      color=mix(color,vec3(1.,.78,.71),selected*.085);
      color+=spec*.11+glint*hover*.02+rim*.09;
      float mask=smoothstep(0.,1.,-sdf);
      gl_FragColor=vec4(mix(texture2D(backdrop,original).rgb,color,mask),1.);
    }`;
  function compile(type, text) {
    const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const blurVertex = `attribute vec2 position; varying vec2 uv;
    void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const blurFragment = `precision highp float;
    uniform sampler2D source; uniform vec2 direction; varying vec2 uv;
    void main(){
      vec4 color=vec4(0.);float total=0.;
      for(int i=-4;i<=4;i++){
        float weight=exp(-float(i*i)*.125);
        color+=texture2D(source,uv+direction*float(i))*weight;total+=weight;
      }
      gl_FragColor=color/total;
    }`;
  let program, texture, blurProgram, blurTemporary, frostedTexture, blurFramebuffer, allocatedSize = '';
  const blurUniforms = {};
  const uniforms = {};
  function link(vertexSource, fragmentSource) {
    const result = gl.createProgram();
    gl.attachShader(result, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(result, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.bindAttribLocation(result, 0, 'position'); gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
    return result;
  }
  function makeTexture() {
    const result = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, result);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.LINEAR);
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
    return result;
  }
  function initialize() {
    program = link(vertex, fragment); blurProgram = link(blurVertex, blurFragment);
    gl.useProgram(program);
    const vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    texture = makeTexture(); blurTemporary = makeTexture(); frostedTexture = makeTexture();
    blurFramebuffer = gl.createFramebuffer(); allocatedSize = '';
    for (const name of ['backdrop','frostedBackdrop','resolution','origin','size','pointer','radius','curvature','strength','frost','pressed','hover','selected']) uniforms[name] = gl.getUniformLocation(program, name);
    for (const name of ['source','direction']) blurUniforms[name] = gl.getUniformLocation(blurProgram, name);
    gl.uniform1i(uniforms.backdrop, 0); gl.uniform1i(uniforms.frostedBackdrop, 1); ready = true;
  }
  function frostBackground(width, height) {
    gl.activeTexture(gl.TEXTURE0);
    if (allocatedSize !== `${width}/${height}`) {
      for (const target of [blurTemporary, frostedTexture]) {
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      allocatedSize = `${width}/${height}`;
    }
    // Two separable Gaussian passes create a smooth frost without grain. The
    // resulting texture is shared; nested controls don't multiply the blur.
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer); gl.viewport(0, 0, width, height);
    gl.useProgram(blurProgram); gl.uniform1i(blurUniforms.source, 0);
    for (const [input, output, dx, dy] of [[texture, blurTemporary, 3 / width, 0], [blurTemporary, frostedTexture, 0, 3 / height]]) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Frost framebuffer unavailable');
      gl.bindTexture(gl.TEXTURE_2D, input); gl.uniform2f(blurUniforms.direction, dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, frostedTexture);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  }
  function fallback() {
    failed = true;
    for (const [element] of surfaces) element.classList.remove('shader-glass');
    document.documentElement.dataset.glassRenderer = 'backdrop-refraction';
  }
  try { initialize(); } catch (error) { console.warn('Glass shader unavailable:', error); return; }
  gpu.addEventListener('webglcontextlost', event => { event.preventDefault(); ready = false; fallback(); });
  gpu.addEventListener('webglcontextrestored', () => { try { initialize(); failed = false; schedule(); } catch { fallback(); } });

  function schedule() { if (!frame && !failed && !document.hidden) frame = requestAnimationFrame(render); }
  function background() {
    const style = getComputedStyle(wallpaper);
    const url = style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) return false;
    if (sourceKey !== url) {
      sourceKey = url; sourceImage = new Image();
      sourceImage.onload = schedule; sourceImage.onerror = fallback; sourceImage.src = url;
    }
    if (!sourceImage.complete || !sourceImage.naturalWidth) return false;
    const box = wallpaper.getBoundingClientRect();
    const cover = Math.max(box.width / sourceImage.naturalWidth, box.height / sourceImage.naturalHeight);
    const w = sourceImage.naturalWidth * cover, h = sourceImage.naturalHeight * cover;
    // This mirrors the app's fixed, left-aligned cover wallpaper and its overlay.
    scene2d.drawImage(sourceImage, box.left, box.top + (box.height - h) / 2, w, h);
    const colors = style.backgroundImage.split('url(')[0].match(/rgba?\([^)]+\)/g);
    if (colors?.length >= 2) {
      const gradient = scene2d.createLinearGradient(0, box.top, 0, box.bottom);
      gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
      scene2d.fillStyle = gradient; scene2d.fillRect(0, 0, scene.width, scene.height);
    }
    return true;
  }
  const resize = new ResizeObserver(schedule);
  function layerFor(element) {
    let layer = surfaces.get(element);
    if (!layer || (!layer.image && layer.canvas.parentElement !== element)) {
      const canvas = document.createElement('canvas');
      canvas.className = 'glass-render-layer'; canvas.setAttribute('aria-hidden', 'true');
      const image = element.matches('input, select, textarea');
      layer = { canvas, context: canvas.getContext('2d'), image };
      surfaces.set(element, layer); resize.observe(element);
      if (!image) element.prepend(canvas);
    }
    return layer;
  }
  function clippedBox(element, box) {
    let left = Math.max(0, box.left), top = Math.max(0, box.top);
    let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
        const r = parent.getBoundingClientRect();
        left = Math.max(left, r.left); right = Math.min(right, r.right);
        top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
      }
    }
    return { left, top, right, bottom };
  }
  function render() {
    frame = 0;
    if (!ready || failed) return;
    if (reduced.matches) {
      for (const [element] of surfaces) element.classList.remove('shader-glass');
      return;
    }
    try {
      const width = Math.ceil(innerWidth), height = Math.ceil(innerHeight);
      if (gpu.width !== width || gpu.height !== height) {
        gpu.width = scene.width = width; gpu.height = scene.height = height;
      }
      scene2d.clearRect(0, 0, width, height);
      if (!background()) return;
      gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture);
      // Textures use DOM's top-left coordinates; the lens vertex shader maps
      // them onto the default framebuffer without flipping clipped surfaces.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      frostBackground(width, height);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform2f(uniforms.pointer, pointer[0], pointer[1]);
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest('.page')?.inert || !element.checkVisibility({ checkVisibilityCSS: true })) continue;
        const box = element.getBoundingClientRect(), clip = clippedBox(element, box);
        if (clip.right <= clip.left || clip.bottom <= clip.top || box.width < 2 || box.height < 2) continue;
        const layer = layerFor(element), style = getComputedStyle(element);
        const w = Math.round(box.width), h = Math.round(box.height);
        if (layer.canvas.width !== w || layer.canvas.height !== h) { layer.canvas.width = w; layer.canvas.height = h; }
        const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, box.width / 2, box.height / 2);
        const panel = element.matches('.glass, .dock-surface, .submenu');
        const hovered = element.matches(':hover') && !motion.matches;
        gl.viewport(Math.round(box.left), height - Math.round(box.bottom), w, h);
        gl.uniform2f(uniforms.origin, box.left, box.top);
        gl.uniform2f(uniforms.size, box.width, box.height);
        gl.uniform1f(uniforms.radius, radius);
        gl.uniform1f(uniforms.curvature, Math.max(2, Math.min(panel ? 40 : 24, Math.min(w, h) * .48)));
        gl.uniform1f(uniforms.strength, .69);
        gl.uniform1f(uniforms.frost, panel ? .95 : .8);
        gl.uniform1f(uniforms.hover, hovered ? 1 : 0);
        gl.uniform1f(uniforms.pressed, element.matches(':active') ? 1 : 0);
        gl.uniform1f(uniforms.selected, element.matches('[aria-selected="true"], [aria-pressed="true"], .primary') ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        layer.context.clearRect(0, 0, w, h);
        // The vertex shader uses DOM-oriented UVs, including partly offscreen
        // surfaces. Canvas clipping must not flip an offscreen top to the bottom.
        layer.context.drawImage(gpu, Math.round(box.left), Math.round(box.top), w, h, 0, 0, w, h);
        if (layer.image) element.style.setProperty('--shader-surface-image', `url("${layer.canvas.toDataURL()}")`);
        if (!element.classList.contains('shader-glass')) element.classList.add('shader-glass');
        // Upload only the changed, visible tile, rather than the whole window
        // for every control. Scroll clipping also applies to subsequent lenses.
        const x = Math.max(0, Math.ceil(clip.left)), y = Math.max(0, Math.ceil(clip.top));
        const cw = Math.floor(clip.right) - x, ch = Math.floor(clip.bottom) - y;
        if (cw > 0 && ch > 0) {
          tile.width = cw; tile.height = ch;
          tile2d.drawImage(layer.canvas, x - box.left, y - box.top, cw, ch, 0, 0, cw, ch);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, tile);
          gl.activeTexture(gl.TEXTURE1);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, tile);
          gl.activeTexture(gl.TEXTURE0);
        }
      }
      for (const [element] of surfaces) if (!element.isConnected) { resize.unobserve(element); surfaces.delete(element); }
      document.documentElement.dataset.glassRenderer = 'webgl-lens';
      if (document.getAnimations().some(animation => animation.playState === 'running')) schedule();
    } catch (error) { console.warn('Glass shader fallback:', error); fallback(); }
  }
  new MutationObserver(records => {
    if (records.some(record => !record.target.classList?.contains('glass-render-layer') &&
      !(record.type === 'attributes' && record.attributeName === 'style' && record.target.matches?.(selector)))) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'inert', 'data-page', 'style'] });
  for (const event of ['resize', 'scroll', 'transitionrun', 'transitionend', 'animationstart', 'animationend', 'toggle', 'close', 'input']) document.addEventListener(event, schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('pointermove', event => { if (!motion.matches) { pointer = [event.clientX, event.clientY]; schedule(); } }, { passive: true });
  for (const event of ['pointerdown', 'pointerup', 'pointerleave', 'visibilitychange']) document.addEventListener(event, schedule, true);
  document.addEventListener('hotori:glass-invalidate', schedule);
  reduced.addEventListener('change', schedule); schedule();
})();
