"use strict";

// Sample the same decoded, origin-clean wallpaper used by the app. A weighted
// hue histogram favors dominant, usable colors over near-black/white pixels.
(() => {
  let generation = 0, defaultImage;
  const neutral = [184, 196, 210];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function sample(image) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const bins = Array.from({ length: 36 }, () => ({ weight: 0, x: 0, y: 0, saturation: 0, lightness: 0 }));
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
      const lightness = (high + low) / 2;
      if (delta < .06 || lightness < .06 || lightness > .94) continue;
      const saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (saturation < .15) continue;
      let hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
      const weight = saturation ** 1.5 * (.35 + .65 * (1 - Math.abs(lightness - .5) * 2));
      const bin = bins[Math.floor(hue / 10)], angle = hue * Math.PI / 180;
      bin.weight += weight; bin.x += Math.cos(angle) * weight; bin.y += Math.sin(angle) * weight;
      bin.saturation += saturation * weight; bin.lightness += lightness * weight;
    }
    let peak = 0;
    for (let i = 1; i < bins.length; i++) if (bins[i].weight > bins[peak].weight) peak = i;
    if (bins[peak].weight < .01) return neutral;
    const total = { weight: 0, x: 0, y: 0, saturation: 0, lightness: 0 };
    for (const index of [(peak + 35) % 36, peak, (peak + 1) % 36]) for (const key of Object.keys(total)) total[key] += bins[index][key];
    const hue = ((Math.atan2(total.y, total.x) / (2 * Math.PI)) + 1) % 1;
    const saturation = clamp(total.saturation / total.weight, .45, .8);
    const lightness = clamp(total.lightness / total.weight, .50, .62);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const h = hue * 6, x = chroma * (1 - Math.abs(h % 2 - 1)), m = lightness - chroma / 2;
    const rgb = h < 1 ? [chroma,x,0] : h < 2 ? [x,chroma,0] : h < 3 ? [0,chroma,x] : h < 4 ? [0,x,chroma] : h < 5 ? [x,0,chroma] : [chroma,0,x];
    return rgb.map(value => Math.round((value + m) * 255));
  }
  function apply(rgb) {
    document.documentElement.style.setProperty('--accent', `rgb(${rgb.join(' ')})`);
    document.dispatchEvent(new Event('hotori:glass-invalidate'));
  }
  function fromImage(image) {
    generation++;
    try { apply(sample(image)); } catch { apply(neutral); }
  }
  async function useDefault() {
    const request = ++generation;
    if (!defaultImage) defaultImage = (async () => {
      const image = new Image(); image.src = 'assets/background.jpeg'; await image.decode(); return image;
    })();
    try { const image = await defaultImage; if (request === generation) apply(sample(image)); }
    catch { if (request === generation) apply(neutral); }
  }
  window.HotoriAccent = { fromImage, useDefault };
  useDefault();
})();
