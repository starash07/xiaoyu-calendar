// 网页在隐藏的离屏窗口绘制；这个原生分层窗口只负责显示 BGRA 帧。
// 不把 Chromium 窗口改成 WS_CHILD，避免依赖其跨进程重新挂靠后的合成状态。
const koffi = require('koffi');
const W = require('./win32');
const u = koffi.load('user32.dll'), g = koffi.load('gdi32.dll'), k = koffi.load('kernel32.dll');
koffi.proto('intptr __stdcall RC_SurfaceProc(intptr hwnd, uint msg, uintptr wparam, intptr lparam)');
const WindowClass = koffi.struct('RC_SurfaceClass', {
  size: 'uint', style: 'uint', proc: 'RC_SurfaceProc *', classExtra: 'int', windowExtra: 'int',
  instance: 'intptr', icon: 'intptr', cursor: 'intptr', background: 'intptr', menu: 'str16', name: 'str16', smallIcon: 'intptr',
});
koffi.struct('RC_SurfaceSize', { width: 'long', height: 'long' });
koffi.struct('RC_SurfaceBlend', { op: 'uint8', flags: 'uint8', alpha: 'uint8', format: 'uint8' });
koffi.struct('RC_SurfaceTrackMouse', { size: 'uint', flags: 'uint', hwnd: 'intptr', hoverTime: 'uint' });
const register = u.func('uint16 __stdcall RegisterClassExW(RC_SurfaceClass *info)');
const create = u.func('intptr __stdcall CreateWindowExW(uint ex, str16 cls, str16 title, uint style, int x, int y, int width, int height, intptr parent, intptr menu, intptr instance, void *param)');
const destroy = u.func('bool __stdcall DestroyWindow(intptr hwnd)');
const defProc = u.func('intptr __stdcall DefWindowProcW(intptr hwnd, uint msg, uintptr wparam, intptr lparam)');
const show = u.func('bool __stdcall ShowWindow(intptr hwnd, int command)');
const visible = u.func('bool __stdcall IsWindowVisible(intptr hwnd)');
const position = u.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int width, int height, uint flags)');
const getLong = u.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const setLong = u.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)');
const capture = u.func('intptr __stdcall SetCapture(intptr hwnd)');
const releaseCapture = u.func('bool __stdcall ReleaseCapture()');
const trackMouse = u.func('bool __stdcall TrackMouseEvent(RC_SurfaceTrackMouse *track)');
const screenToClient = u.func('bool __stdcall ScreenToClient(intptr hwnd, _Inout_ RC_POINT *point)');
const update = u.func('bool __stdcall UpdateLayeredWindow(intptr hwnd, intptr screen, RC_POINT *dst, RC_SurfaceSize *size, intptr src, RC_POINT *origin, uint key, RC_SurfaceBlend *blend, uint flags)');
const getDC = u.func('intptr __stdcall GetDC(intptr hwnd)');
const releaseDC = u.func('int __stdcall ReleaseDC(intptr hwnd, intptr dc)');
const createDC = g.func('intptr __stdcall CreateCompatibleDC(intptr dc)');
const deleteDC = g.func('bool __stdcall DeleteDC(intptr dc)');
const createDIB = g.func('intptr __stdcall CreateDIBSection(intptr dc, void *info, uint usage, _Out_ void **pixels, intptr section, uint offset)');
const select = g.func('intptr __stdcall SelectObject(intptr dc, intptr object)');
const deleteObject = g.func('bool __stdcall DeleteObject(intptr object)');
const moduleHandle = k.func('intptr __stdcall GetModuleHandleW(str16 name)');
const lastError = k.func('uint __stdcall GetLastError()');

const instances = new Map();
const className = 'XiaoyuCalendarDesktopSurface';
const instance = moduleHandle(null);
let registered = false, windowProc;
const n = value => Number(value) || 0;
const signedWord = value => (value << 16) >> 16;

function ensureClass() {
  if (registered) return;
  windowProc = koffi.register((hwnd, msg, wp, lp) => {
    const surface = instances.get(n(hwnd));
    if (surface) {
      if (msg === 0x21) return 3; // MA_NOACTIVATE
      if (msg === 0x14) return 1; // 背景随整帧提交，禁止擦除导致的闪白。
      if (msg === 0x84 && surface.clickThrough) return -1; // HTTRANSPARENT
      if ([0x200, 0x201, 0x202].includes(msg) && !surface.clickThrough) {
        const bits = Number(lp), x = signedWord(bits & 0xffff) / surface.scale, y = signedWord((bits >>> 16) & 0xffff) / surface.scale;
        if (msg === 0x200 && !surface.trackingMouse) {
          surface.trackingMouse = !!trackMouse({
            size: koffi.sizeof('RC_SurfaceTrackMouse'), flags: 2, hwnd, hoverTime: 0,
          });
        }
        if (msg === 0x201) capture(hwnd);
        if (msg === 0x202) releaseCapture();
        const input = { type: msg === 0x200 ? 'mouseMove' : msg === 0x201 ? 'mouseDown' : 'mouseUp',
          x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
        surface.input(input);
        return 0;
      }
      if (msg === 0x2a3) { // WM_MOUSELEAVE
        surface.trackingMouse = false;
        surface.input({ type: 'mouseLeave', x: -1, y: -1 });
        return 0;
      }
      if (msg === 0x20a && !surface.clickThrough) { // WM_MOUSEWHEEL
        const bits = Number(lp), point = { x: signedWord(bits & 0xffff), y: signedWord((bits >>> 16) & 0xffff) };
        if (screenToClient(hwnd, point)) surface.input({
          type: 'mouseWheel', x: Math.round(point.x / surface.scale), y: Math.round(point.y / surface.scale),
          deltaX: 0, deltaY: signedWord((Number(wp) >>> 16) & 0xffff), canScroll: true,
        });
        return 0;
      }
      if (msg === 0x82) { // WM_NCDESTROY：父窗口销毁时原生表面也会被系统销毁。
        instances.delete(n(hwnd));
        surface.hwnd = 0;
        if (!surface.closing) setImmediate(() => surface.onLost?.());
      }
    }
    return defProc(hwnd, msg, wp, lp);
  }, 'RC_SurfaceProc *');
  const atom = register({ size: koffi.sizeof(WindowClass), style: 0, proc: windowProc, classExtra: 0, windowExtra: 0,
    instance, icon: 0, cursor: 0, background: 0, menu: null, name: className, smallIcon: 0 });
  if (!atom) throw new Error(`桌面显示窗口注册失败：${lastError()}`);
  registered = true;
}

class DesktopSurface {
  constructor({ onInput, onLost, onError } = {}) {
    ensureClass();
    this.onInput = onInput; this.onLost = onLost; this.onError = onError;
    this.clickThrough = true; this.scale = 1;
    this.metrics = { frames: 0, buffers: 0, failures: 0, staleFrames: 0 };
    this.hwnd = n(create(0x080800a0, className, '小鱼日程表 · 桌面', 0x80000000, 0, 0, 1, 1, 0, 0, instance, null));
    if (!this.hwnd) throw new Error(`桌面显示窗口创建失败：${lastError()}`);
    instances.set(this.hwnd, this);
  }

  input(event) {
    setImmediate(() => {
      if (this.hwnd && !this.closing && !this.clickThrough) this.onInput?.(event);
    });
  }

  setClickThrough(enabled) {
    this.clickThrough = !!enabled;
    const ex = Number(getLong(this.hwnd, -20)) >>> 0;
    const next = enabled ? (ex | 0x20) >>> 0 : (ex & ~0x20) >>> 0;
    if (next !== ex) setLong(this.hwnd, -20, next);
  }

  setTopmost(enabled) {
    if (!!(W.exStyleOf(this.hwnd) & 8) === !!enabled) return true;
    return !!position(this.hwnd, enabled ? -1 : -2, 0, 0, 0, 0, W.SWP.NOMOVE | W.SWP.NOSIZE | W.SWP.NOACTIVATE);
  }

  position(rect) {
    return !!position(this.hwnd, 0, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height),
      W.SWP.NOZORDER | W.SWP.NOACTIVATE);
  }

  // 只根据自己的可见位调用一次 ShowWindow；父窗口隐藏时不反复 show。
  show() { if (this.hwnd && this.metrics.frames && !(W.styleOf(this.hwnd) & 0x10000000)) show(this.hwnd, 8); }
  hide() { if (this.hwnd && (W.styleOf(this.hwnd) & 0x10000000)) show(this.hwnd, 0); }
  isVisible() { return !!this.hwnd && !!visible(this.hwnd); }

  freeBuffer() {
    if (this.dc && this.original) select(this.dc, this.original);
    if (this.bitmap) deleteObject(this.bitmap);
    if (this.dc) deleteDC(this.dc);
    this.dc = 0; this.bitmap = 0; this.pixels = null; this.original = 0;
  }

  paint(image) {
    if (!this.hwnd || image.isEmpty()) return false;
    try { return this.paintFrame(image); }
    catch (error) {
      this.metrics.failures++;
      this.lastError = String(error.message || error);
      this.onError?.(this.lastError);
      return false;
    }
  }

  paintFrame(image) {
    const size = image.getSize();
    const matches = expected => expected && size.width === expected.width && size.height === expected.height;
    const matchesRounded = expected => expected
      && Math.abs(size.width - expected.width) <= 1 && Math.abs(size.height - expected.height) <= 1;
    // 窗口已经增高而旧尺寸的帧晚到时，不让 UpdateLayeredWindow 把底边又拉回去。
    // 125% 等非整数缩放经过窗口尺寸往返换算，会相差一个逻辑像素。
    if (this.expectedSize && !matchesRounded(this.expectedSize) && !matchesRounded(this.viewportSize)) {
      this.metrics.staleFrames++;
      return false;
    }
    // OSR 位图可能仍以逻辑尺寸输出；Win32 分层窗口需要实际屏幕像素。
    const frame = this.expectedSize && !matches(this.expectedSize)
      ? image.resize({ ...this.expectedSize, quality: 'best' }) : image;
    const { width, height } = frame.getSize(), raw = frame.toBitmap();
    if (!width || !height || raw.length !== width * height * 4) return false;
    if (!this.dc || width !== this.width || height !== this.height) {
      this.freeBuffer();
      const dc = getDC(0);
      try {
        this.dc = n(createDC(dc));
        const header = Buffer.alloc(40), pixels = [null];
        header.writeUInt32LE(40); header.writeInt32LE(width, 4); header.writeInt32LE(-height, 8);
        header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
        this.bitmap = n(createDIB(dc, header, 0, pixels, 0, 0));
        this.pixels = pixels[0];
        if (!this.dc || !this.bitmap || !this.pixels) throw new Error(`桌面画布分配失败：${lastError()}`);
        this.original = select(this.dc, this.bitmap);
        this.width = width; this.height = height;
        this.metrics.buffers++;
      } catch (error) { this.freeBuffer(); throw error; }
      finally { if (dc) releaseDC(0, dc); }
    }
    koffi.encode(this.pixels, 'uint8', raw, raw.length);
    const ok = !!update(this.hwnd, 0, null, { width, height }, this.dc, { x: 0, y: 0 }, 0,
      { op: 0, flags: 0, alpha: 255, format: 1 }, 2);
    if (!ok) throw new Error(`桌面帧提交失败：${lastError()}`);
    this.metrics.frames++;
    this.lastError = 0;
    return true;
  }

  destroy() {
    this.closing = true;
    if (this.hwnd) destroy(this.hwnd);
    this.hwnd = 0;
    this.freeBuffer();
  }
}

module.exports = { DesktopSurface };
