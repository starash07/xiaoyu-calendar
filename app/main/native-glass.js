// Windows 10/11 的真实窗口磨砂。只处理本程序窗口，不读取或复制桌面壁纸。
const koffi = require('koffi');
const A = require('../renderer/shared/appearance');

let api = null;
try {
  const user32 = koffi.load('user32.dll'), gdi32 = koffi.load('gdi32.dll'), dwmapi = koffi.load('dwmapi.dll');
  const accent = koffi.struct('RC_GLASS_ACCENT', { state: 'int', flags: 'uint', color: 'uint', animation: 'int' });
  koffi.struct('RC_GLASS_ATTRIBUTE', { attribute: 'int', data: koffi.pointer(accent), size: 'size_t' });
  api = {
    accent: user32.func('int __stdcall SetWindowCompositionAttribute(intptr hwnd, RC_GLASS_ATTRIBUTE *data)'),
    round: gdi32.func('intptr __stdcall CreateRoundRectRgn(int l, int t, int r, int b, int w, int h)'),
    region: user32.func('int __stdcall SetWindowRgn(intptr hwnd, intptr region, int redraw)'),
    destroy: gdi32.func('int __stdcall DeleteObject(intptr object)'),
    attribute: dwmapi.func('long __stdcall DwmSetWindowAttribute(intptr hwnd, uint attr, int *value, uint size)'),
  };
} catch (_) { /* 系统不支持时保持真实透明，不回退到壁纸图片。 */ }

class NativeGlass {
  constructor() {
    this.metrics = { regionUpdates: 0, materialUpdates: 0 };
    this.reset();
  }

  reset() {
    this.modeKey = ''; this.regionKey = ''; this.peekKey = '';
    this.status = { mode: 'none', available: !!api };
  }

  clearMaterial(hwnd) {
    if (!api || !hwnd || !this.modeKey || this.status.mode === 'none') return;
    try {
      api.accent(hwnd, { attribute: 19, data: { state: 0, flags: 0, color: 0, animation: 0 }, size: 16 });
      this.metrics.materialUpdates++;
    } catch (_) { /* 窗口可能已经被宿主销毁。 */ }
    this.modeKey = '';
    this.status = { mode: 'none', available: !!api };
  }

  update({ hwnd, width, height, scale, margin, blur, pinned = false, desktopChild = false, surface = false, force = false }) {
    const level = A.glassLevel(blur), mode = level === 0 ? 'none' : level === 14 ? 'light' : 'soft';
    if (!api || !hwnd) return this.status = { mode: 'none', available: false };
    const modeKey = `${hwnd}/${mode}/${desktopChild}`;
    // 原生表面直接提交网页的透明像素，圆角由这一帧的 alpha 统一决定。
    // 旧 Accent 材质不能混入该表面的提交路径；真实磨砂后端尚待接入。
    if (surface) return this.status = mode === 'none' ? { mode: 'none', available: true }
      : { mode: 'none', available: false, reason: 'desktop-surface' };
    // Aero Peek 与真正的显示桌面分开处理；本属性避免鼠标停在桌面按钮时玻璃被淡出。
    const peekKey = `${hwnd}/${pinned}/${desktopChild}`;
    if (!desktopChild && (force || peekKey !== this.peekKey)) {
      api.attribute(hwnd, 12, [pinned ? 1 : 0], 4); // DWMWA_EXCLUDED_FROM_PEEK
      this.peekKey = peekKey;
    }
    const regionKey = `${hwnd}/${width}/${height}/${scale}/${margin}`;
    const regionChanged = force || regionKey !== this.regionKey;
    if (regionChanged) {
      // 限制窗口内容形状。Win10 Accent 仍可能在区域外合成，不能据此认定磨砂圆角通过。
      const px = n => Math.round(n * scale);
      const region = api.round(px(margin), px(margin), px(width - margin) + 1,
        px(height - margin) + 1, px(30), px(30));
      if (region) {
        if (api.region(hwnd, region, 0)) { this.regionKey = regionKey; this.metrics.regionUpdates++; }
        else api.destroy(region); // 成功后区域归系统所有，失败才自行释放。
      }
    }
    // 尺寸变化只更新裁剪，不重复启用材质。桌面子窗口不支持旧的 Accent
    // 接口，必须明确报告不可用，不能再次退回顶层窗口来换取磨砂。
    if (desktopChild) {
      this.modeKey = modeKey;
      return this.status = mode === 'none' ? { mode: 'none', available: true }
        : { mode: 'none', available: false, reason: 'desktop-child' };
    }
    if (force || modeKey !== this.modeKey) {
      let ok = false;
      try {
        ok = !!api.accent(hwnd, { attribute: 19, data: {
          state: mode === 'none' ? 0 : mode === 'light' ? 3 : 4,
          flags: 2, color: 0x01ffffff, animation: 0,
        }, size: 16 });
        this.metrics.materialUpdates++;
      } catch (_) { /* 调用失败仍保留页面自身的透明颜色层。 */ }
      this.modeKey = modeKey;
      this.status = { mode: ok ? mode : 'none', available: ok };
    }
    return this.status;
  }
}

module.exports = { NativeGlass };
