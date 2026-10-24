// 外观取值统一保存在 w1.appearance，兼容已有设置；日期、日程条和文字颜色供两个日历共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RCDesktopAppearance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 2;
  const DEFAULT = Object.freeze({
    panelColor: '#FFFFFF', panelOpacity: 14, blur: 14, textColor: '#315873',
    width: 420, dateFontSize: 17, barFontSize: 10, barHeight: 15, detailFontSize: 11,
    weekendColor: '#8A70D6', todayTone: 'mint',
  });
  const LIMITS = Object.freeze({
    panelOpacity: [0, 100, 1], width: [320, 600, 10], dateFontSize: [13, 22, 1],
    blur: [0, 40, 1], barFontSize: [7, 12, 0.5], barHeight: [6, 18, 1], detailFontSize: [9, 20, 1],
  });
  const GLASS_LEVELS = Object.freeze([
    { value: 0, label: '关闭' }, { value: 14, label: '轻磨砂' }, { value: 40, label: '柔雾' },
  ]);
  const TODAY_TONES = Object.freeze([
    { id: 'mint', label: '薄荷绿', fill: '#E3F2EC', ink: '#4E957F' },
    { id: 'blue', label: '浅蓝', fill: '#E5F1FB', ink: '#4684AD' },
    { id: 'violet', label: '淡紫', fill: '#EEE8FA', ink: '#8463B5' },
    { id: 'rose', label: '柔粉', fill: '#F9E7EF', ink: '#AD6080' },
    { id: 'apricot', label: '暖杏', fill: '#FBF0DB', ink: '#A9833B' },
  ].map(Object.freeze));
  const todayTone = id => TODAY_TONES.find(tone => tone.id === id) || TODAY_TONES[0];
  // 保留旧文件中的 blur 值，按范围映射原生效果；系统接口不提供像素半径。
  const glassLevel = value => Number(value) <= 0 ? 0 : Number(value) <= 20 ? 14 : 40;

  function normalize(value) {
    const saved = value && typeof value === 'object' ? value : {};
    const result = { ...DEFAULT };
    for (const key of ['panelColor', 'textColor', 'weekendColor']) {
      if (typeof saved[key] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[key])) result[key] = saved[key].toUpperCase();
    }
    result.todayTone = todayTone(saved.todayTone).id;
    for (const [key, [min, max, step]] of Object.entries(LIMITS)) {
      const n = saved[key] == null ? NaN : Number(saved[key]);
      if (Number.isFinite(n)) result[key] = Math.max(min, Math.min(max, Math.round(n / step) * step));
    }
    return result;
  }

  // 旧版未改过的黑底白字换成选定的玻璃配色；已经自定义的配色和尺寸继续保留。
  function migrate(value, version) {
    const saved = value && typeof value === 'object' ? { ...value } : {};
    if (!(version >= VERSION)) {
      const originalColors = String(saved.panelColor || '#000000').toUpperCase() === '#000000'
        && String(saved.textColor || '#FFFFFF').toUpperCase() === '#FFFFFF'
        && (saved.panelOpacity == null || Number(saved.panelOpacity) === 28);
      if (originalColors) {
        saved.panelColor = DEFAULT.panelColor;
        saved.textColor = DEFAULT.textColor;
        saved.panelOpacity = DEFAULT.panelOpacity;
      }
      if (Number(saved.barHeight) === 12) saved.barHeight = DEFAULT.barHeight;
    }
    return normalize(saved);
  }

  return { VERSION, DEFAULT, LIMITS, GLASS_LEVELS, TODAY_TONES, todayTone, glassLevel, normalize, migrate };
});
