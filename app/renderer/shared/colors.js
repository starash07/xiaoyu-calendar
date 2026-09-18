// 颜色工具：条上文字自动取深浅、W1 文字配色、对比度提示
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RCColors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const DARK_L = lum([17, 17, 17]);
  const isHex = s => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
  const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;

  function hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l * 100];
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
  }

  // 条上文字：白字、深字里挑对比度高的；深字用和条同色相的深色
  function barText(hex) {
    const rgb = hexRgb(hex), L = lum(rgb);
    if (contrast(L, 1) >= contrast(L, DARK_L)) return '#ffffff';
    const [h, s] = hsl(rgb);
    return `hsl(${Math.round(h)} ${Math.round(Math.min(s, 70))}% 15%)`;
  }

  // W1 文字配色：按所选字体颜色的亮度选透明度档位（需求 4.2）
  function textTokens(hex) {
    const rgb = hexRgb(hex), light = lum(rgb) > 0.4;
    const a = light ? [0.92, 0.58, 0.34, 0.10] : [0.86, 0.56, 0.32, 0.08];
    const c = al => `rgba(${rgb.join(',')},${al})`;
    return {
      fg: c(a[0]), fg2: c(a[1]), fg3: c(a[2]), rule: c(a[3]), hl: c(0.95),
      edge: light ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.45)',
    };
  }

  // 对比度提示：混合色 = 底板色 × 不透明度 + 壁纸平均色 × (1 − 不透明度)
  function panelContrast(textHex, panelHex, opacity, wallRgb) {
    const p = hexRgb(panelHex), t = hexRgb(textHex), w = wallRgb || [128, 128, 128];
    const eff = [0, 1, 2].map(i => opacity * p[i] + (1 - opacity) * w[i]);
    const ta = lum(t) > 0.4 ? 0.92 : 0.86;
    const txt = [0, 1, 2].map(i => ta * t[i] + (1 - ta) * eff[i]);
    return contrast(lum(txt), lum(eff));
  }

  const PRESETS = [
    ['薄荷青', '#5DCAA5'], ['天空蓝', '#85B7EB'], ['薰衣草紫', '#AFA9EC'], ['樱花粉', '#ED93B1'],
    ['珊瑚红', '#F0997B'], ['橘橙', '#EF9F27'], ['柠檬黄', '#FAC775'], ['草绿', '#97C459'],
  ];

  return { hexRgb, lum, contrast, isHex, rgba, barText, textTokens, panelContrast, PRESETS };
});
