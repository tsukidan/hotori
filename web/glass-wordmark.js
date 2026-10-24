"use strict";

// Letter-shaped glass in the existing renderer's context. Glyph distance fields
// supply the curved surface normals; the app's real backdrop and blur supply
// refraction and frost. Optical equations are adapted from the pinned MIT
// LiquidGlass shader; see web/vendor/liquidglass/NOTICE.md. Glyphs supply the
// surface geometry instead of its rounded rectangle.
(() => {
  const vertex = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() { v_uv = a_pos * .5 + .5; gl_Position = vec4(a_pos, 0., 1.); }
  `;
  const fragment = `
    precision highp float;
    uniform sampler2D u_background, u_blur, u_glyph;
    uniform vec2 u_size;
    uniform float u_dpr, u_span, u_refraction;
    varying vec2 v_uv;
    float distanceAt(vec2 p) {
      vec2 rg = texture2D(u_glyph, clamp(p / u_size, 0., 1.)).rg;
      return (dot(rg, vec2(65280., 255.)) / 65535. * 2. - 1.) * u_span;
    }
    float heightAt(vec2 p) {
      float radius = 4.5 * u_dpr;
      float edge = radius - clamp(distanceAt(p), 0., radius);
      return sqrt(max(0., radius * radius - edge * edge));
    }
    void main() {
      vec2 p = vec2(v_uv.x, 1. - v_uv.y) * u_size;
      float d = distanceAt(p);
      float mask = texture2D(u_glyph, p / u_size).b;
      float shadow = (1. - smoothstep(0., 6. * u_dpr, -distanceAt(p - vec2(0., 2. * u_dpr)))) * .14;
      if (mask < .001) { gl_FragColor = vec4(0., 0., 0., shadow); return; }
      float radius = 4.5 * u_dpr;
      float e = 2. * u_dpr;
      vec2 gradient = vec2(heightAt(p + vec2(e, 0.)) - heightAt(p - vec2(e, 0.)),
                           heightAt(p + vec2(0., e)) - heightAt(p - vec2(0., e))) / (2. * e);
      vec3 normal = normalize(vec3(-gradient, 1.));
      float thickness = heightAt(p) * 2.;
      float depth = smoothstep(0., radius, d);
      float edge = 1. - smoothstep(0., 3.5 * u_dpr, max(d, 0.));
      vec2 pxToUV = vec2(1., -1.) / u_size;
      // Reference biconvex optics: entry, traversal and exit refraction.
      float refractivePower = 1. - 1. / 1.5;
      float normalizedThickness = thickness / (radius * 2.);
      vec2 exitRay = gradient * refractivePower;
      vec2 entryRay = gradient * refractivePower;
      vec2 throughRay = entryRay * normalizedThickness * .5;
      vec2 displacement = (exitRay + entryRay + throughRay) * u_refraction * 30. * u_dpr;
      // Keep the letter's rays within its padded scene crop.
      displacement *= min(1., 12. * u_dpr / max(length(displacement), .001));
      vec2 uv = clamp(v_uv + displacement * pxToUV, vec2(.001), vec2(.999));
      float separation = .05 * 18. * (edge * .7 + .3) * 2. * u_dpr;
      vec2 dispersion = normal.xy * separation * pxToUV;
      vec3 sharp = vec3(texture2D(u_background, uv + dispersion).r,
                        texture2D(u_background, uv).g, texture2D(u_background, uv - dispersion).b);
      vec3 frost = vec3(texture2D(u_blur, uv + dispersion).r,
                        texture2D(u_blur, uv).g, texture2D(u_blur, uv - dispersion).b);
      vec3 color = mix(sharp, frost, 1. - edge * .15);
      color *= 1. + .06 * depth;
      float fresnel = pow(1. - abs(normal.z), 4.);
      // Reference multi-light Blinn-Phong terms: narrow highlights rather
      // than the previous broad diffuse glow over the entire glyph face.
      vec3 view = vec3(0., 0., 1.);
      vec3 key = normalize(vec3(.4, .7, 1.));
      vec3 fill = normalize(vec3(-.3, -.5, 1.));
      vec3 broad = normalize(vec3(.1, .3, 1.));
      vec3 grazing = normalize(vec3(0., .9, .4));
      float specular = pow(max(dot(normal, normalize(key + view)), 0.), 90.)
                     + pow(max(dot(normal, normalize(fill + view)), 0.), 50.) * .3
                     + pow(max(dot(normal, broad), 0.), 6.) * .1
                     + pow(max(dot(normal, normalize(grazing + view)), 0.), 120.) * .6;
      float sdf = -d;
      float stroke = smoothstep(-2.5 * u_dpr, -1.5 * u_dpr, sdf)
                   * (1. - smoothstep(-u_dpr, 0., sdf));
      stroke *= .4 + .6 * (1. - p.y / u_size.y);
      float rim = edge * .18 * .22;
      float innerGlow = (1. - smoothstep(0., 5. * u_dpr, max(d, 0.))) * .18 * .15;
      float reflection = (normal.y * .5 + .5) * fresnel * .08;
      color += vec3(specular * .35 + rim + innerGlow + stroke * .18 * .55 + reflection);
      color = mix(color, vec3(1.), fresnel * .2);
      float alpha = mask + shadow * (1. - mask);
      gl_FragColor = vec4(color * mask / max(alpha, .001), alpha);
    }
  `;

  // Exact separable Euclidean distance transform, computed only when the text
  // geometry changes. The GPU receives a 16-bit signed-distance glyph texture.
  function distanceField(alpha, width, height, inside) {
    const size = Math.max(width, height);
    const values = new Float64Array(size), output = new Float64Array(size);
    const sites = new Int32Array(size), cuts = new Float64Array(size + 1);
    const horizontal = new Float64Array(width * height), result = new Float64Array(width * height);
    function line(length) {
      let count = 0; sites[0] = 0; cuts[0] = -Infinity; cuts[1] = Infinity;
      for (let q = 1; q < length; q++) {
        let intersection;
        do {
          const site = sites[count];
          intersection = ((values[q] + q * q) - (values[site] + site * site)) / (2 * (q - site));
          if (intersection > cuts[count]) break;
          count--;
        } while (count >= 0);
        count++; sites[count] = q; cuts[count] = intersection; cuts[count + 1] = Infinity;
      }
      count = 0;
      for (let q = 0; q < length; q++) {
        while (cuts[count + 1] < q) count++;
        output[q] = (q - sites[count]) ** 2 + values[sites[count]];
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) values[x] = (alpha[(y * width + x) * 4 + 3] >= 128) === inside ? 0 : 1e12;
      line(width); horizontal.set(output.subarray(0, width), y * width);
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) values[y] = horizontal[y * width + x];
      line(height);
      for (let y = 0; y < height; y++) result[y * width + x] = output[y];
    }
    return result;
  }

  window.HotoriGlassWordmark = class {
    constructor(renderer) {
      this.renderer = renderer; this.cache = new Map(); this.refraction = .69;
      renderer.canvas.addEventListener('webglcontextrestored', () => { this.program = null; this.cache.clear(); });
    }
    invalidate() {
      for (const entry of this.cache.values()) this.renderer.gl.deleteTexture(entry.texture);
      this.cache.clear();
    }
    glyph(element, width, height, dpr, pad) {
      const text = element.getAttribute('aria-label') || 'Hotori';
      const style = getComputedStyle(element), family = style.fontFamily, weight = style.fontWeight;
      const key = `${width}/${height}/${dpr}/${text}/${family}/${weight}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const contentWidth = width - pad * 2, contentHeight = height - pad * 2;
      context.font = `${weight} ${contentHeight}px ${family}`;
      context.letterSpacing = `${-contentHeight * .055}px`;
      const metrics = context.measureText(text);
      const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
      const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const sx = contentWidth / inkWidth, sy = contentHeight * .88 / inkHeight;
      context.translate(pad, pad + contentHeight * .06);
      context.scale(sx, sy); context.fillStyle = '#fff';
      context.fillText(text, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
      const pixels = context.getImageData(0, 0, width, height).data;
      const toInside = distanceField(pixels, width, height, true), toOutside = distanceField(pixels, width, height, false);
      const span = 32 * dpr, encoded = new Uint8Array(pixels.length);
      const signed = new Float32Array(width * height), smooth = new Float32Array(width * height);
      for (let index = 0; index < width * height; index++) {
        const alpha = pixels[index * 4 + 3];
        let distance = alpha >= 128 ? Math.sqrt(toOutside[index]) - .5 : .5 - Math.sqrt(toInside[index]);
        if (alpha > 0 && alpha < 255) distance = alpha / 255 - .5;
        signed[index] = distance;
      }
      // Smooth the distance derivatives, not the text's alpha edge. This keeps
      // small curved glyphs from producing pixel-stepped specular highlights.
      const weights = [1, 4, 6, 4, 1];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let value = 0;
        for (let tap = -2; tap <= 2; tap++) value += signed[y * width + Math.max(0, Math.min(width - 1, x + tap))] * weights[tap + 2];
        smooth[y * width + x] = value / 16;
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let distance = 0;
        for (let tap = -2; tap <= 2; tap++) distance += smooth[Math.max(0, Math.min(height - 1, y + tap)) * width + x] * weights[tap + 2];
        signed[y * width + x] = distance / 16;
      }
      for (let index = 0; index < width * height; index++) {
        const value = Math.round((Math.max(-span, Math.min(span, signed[index])) / span * .5 + .5) * 65535);
        encoded[index * 4] = value >>> 8; encoded[index * 4 + 1] = value & 255;
        encoded[index * 4 + 2] = pixels[index * 4 + 3]; encoded[index * 4 + 3] = 255;
      }
      const gl = this.renderer.gl, texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, encoded);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      const entry = { texture, span }; this.cache.set(key, entry);
      if (this.cache.size > 4) {
        const oldest = this.cache.keys().next().value;
        gl.deleteTexture(this.cache.get(oldest).texture); this.cache.delete(oldest);
      }
      return entry;
    }
    render(element, width, height, dpr, pad) {
      const renderer = this.renderer, gl = renderer.gl;
      if (!this.program) {
        this.program = renderer._link(vertex, fragment);
        if (!this.program) throw new Error('Could not compile the glass wordmark shader.');
        this.uniforms = renderer._uloc(this.program, ['u_background', 'u_blur', 'u_glyph', 'u_size', 'u_dpr', 'u_span', 'u_refraction']);
      }
      const glyph = this.glyph(element, width, height, dpr, pad);
      renderer.clear(); gl.disable(gl.BLEND); gl.useProgram(this.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, renderer.canvas.height - height, width, height);
      for (const [unit, texture, uniform] of [[0, renderer.activeFBOs.bg.tex, 'u_background'], [1, renderer.activeFBOs.blurA.tex, 'u_blur'], [2, glyph.texture, 'u_glyph']]) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(this.uniforms[uniform], unit);
      }
      gl.uniform2f(this.uniforms.u_size, width, height); gl.uniform1f(this.uniforms.u_dpr, dpr); gl.uniform1f(this.uniforms.u_span, glyph.span); gl.uniform1f(this.uniforms.u_refraction, this.refraction);
      renderer._drawQuad(this.program, renderer.quadBuf); gl.activeTexture(gl.TEXTURE0);
    }
  };
})();
