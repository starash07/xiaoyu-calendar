// Windows 接口：挂靠桌面、光标位置、窗口层级。用 koffi 直接调 user32，不用编译原生模块。
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

koffi.struct('RC_POINT', { x: 'long', y: 'long' });
koffi.struct('RC_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
koffi.proto('bool __stdcall RC_EnumProc(intptr hwnd, intptr lParam)');
koffi.proto('void __stdcall RC_DesktopEvent(intptr hook, uint event, intptr hwnd, long object, long child, uint thread, uint time)');

const FindWindowW = user32.func('intptr __stdcall FindWindowW(str16 cls, str16 title)');
const FindWindowExW = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 title)');
const SendMessageTimeoutW = user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint msg, uintptr wParam, intptr lParam, uint flags, uint timeout, void *result)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(RC_EnumProc *cb, intptr lParam)');
const GetAncestor = user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint flags)');
const GetWindow = user32.func('intptr __stdcall GetWindow(intptr hwnd, uint cmd)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)');
const SetParent = user32.func('intptr __stdcall SetParent(intptr hwnd, intptr parent)');
const ScreenToClient = user32.func('bool __stdcall ScreenToClient(intptr hwnd, _Inout_ RC_POINT *point)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr hwnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)');
const GetWindowThreadProcessId = user32.func('uint __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint *process)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RC_RECT *rect)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ RC_POINT *pt)');
const WindowFromPoint = user32.func('intptr __stdcall WindowFromPoint(RC_POINT pt)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr hwnd, void *buf, int max)');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int key)');
const GetDoubleClickTime = user32.func('uint __stdcall GetDoubleClickTime()');
const SetWinEventHook = user32.func('intptr __stdcall SetWinEventHook(uint first, uint last, intptr module, RC_DesktopEvent *callback, uint process, uint thread, uint flags)');
const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(intptr hook)');

const SWP = { NOSIZE: 0x1, NOMOVE: 0x2, NOZORDER: 0x4, NOACTIVATE: 0x10, SHOWWINDOW: 0x40 };
const GA_PARENT = 1, GA_ROOT = 2, HWND_BOTTOM = 1;
const CHILD = 0x40000000, POPUP = 0x80000000;
const styleOf = h => Number(GetWindowLongPtrW(h, -16)) >>> 0;
const exStyleOf = h => Number(GetWindowLongPtrW(h, -20)) >>> 0;

const n = v => (typeof v === 'bigint' ? Number(v) : v) || 0;

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0));
}

function className(h) {
  const buf = Buffer.alloc(512);
  const len = GetClassNameW(h, buf, 256);
  return len > 0 ? buf.toString('utf16le', 0, len * 2) : '';
}

function processOf(h) {
  const id = [0];
  GetWindowThreadProcessId(h, id);
  return id[0];
}

// 先读取现存桌面；只有明确请求且缺少宿主时才发送创建消息。
// 鼠标轮询与健康检查不得持续向 Explorer 发送 0x052C。
function findDesktopLayers({ create = false } = {}) {
  const progman = n(FindWindowW('Progman', null));
  if (!progman) return null;
  const explorer = processOf(progman);
  if (!explorer) return null;
  const shellWindow = h => !!h && !!IsWindowVisible(h) && processOf(h) === explorer;
  const read = () => {
    let iconsHost = 0, iconView = 0;
    EnumWindows((top) => {
      if (!shellWindow(top) || !['Progman', 'WorkerW'].includes(className(top))) return true;
      const view = n(FindWindowExW(top, 0, 'SHELLDLL_DefView', null));
      if (!view || processOf(view) !== explorer) return true;
      iconsHost = n(top); iconView = view;
      return false;
    }, 0);
    if (!iconsHost || !iconView) return null;
    const findShellWorker = (parent, after) => {
      for (let i = 0; i < 128; i++) {
        after = n(FindWindowExW(parent, after, 'WorkerW', null));
        if (!after) break;
        if (shellWindow(after) && !FindWindowExW(after, 0, 'SHELLDLL_DefView', null)) return after;
      }
      return 0;
    };
    // 新式桌面：图标与壁纸在同一个 Progman 中，插在图标视图之后。
    const nested = iconsHost === progman ? findShellWorker(progman, iconView) : 0;
    if (nested) return {
      progman, explorer, icons: iconsHost, iconView, wallpaper: nested, host: progman, after: iconView, kind: 'nested',
    };
    // Win10：跳过隐藏的旧 WorkerW 和其他进程的同名窗口。
    // 只挂靠现存壁纸容器，不重排图标宿主或 Wallpaper Engine 的窗口。
    const wallpaper = findShellWorker(0, iconsHost);
    if (!wallpaper || rootOf(wallpaper) !== wallpaper) return null;
    return { progman, explorer, icons: iconsHost, iconView, wallpaper, host: wallpaper, after: 0, kind: 'separate' };
  };
  let layers = read();
  if (!layers && create) {
    SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 800, Buffer.alloc(8));
    layers = read();
  }
  return layers;
}

const findWorkerW = () => findDesktopLayers()?.wallpaper || 0;

const parentOf = h => n(GetAncestor(h, GA_PARENT));
const rootOf = h => n(GetAncestor(h, GA_ROOT));
const ownerOf = h => n(GetWindow(h, 4)); // GW_OWNER
const isWindow = h => !!h && !!IsWindow(h);

function setOwner(h, owner) {
  SetWindowLongPtrW(h, -8, owner); // GWLP_HWNDPARENT：顶层窗口的 owner，不是子窗口 parent。
  SetWindowPos(h, 0, 0, 0, 0, 0, 0x200 | 0x20 | SWP.NOMOVE | SWP.NOSIZE | SWP.NOZORDER | SWP.NOACTIVATE);
  return ownerOf(h) === owner;
}

const nextWindow = h => n(GetWindow(h, 2)); // GW_HWNDNEXT：下方一层。
const isDesktopChild = (h, layers) => !!layers && isWindow(h) && isWindow(layers.host)
  && isWindow(layers.iconView) && isWindow(layers.wallpaper)
  && parentOf(h) === layers.host && !!(styleOf(h) & CHILD);

function attachToDesktop(h, layers) {
  if (!layers || !isWindow(h) || !isWindow(layers.host) || !isWindow(layers.iconView)) return false;
  if (isDesktopChild(h, layers)) return true;
  const oldStyle = styleOf(h);
  SetWindowLongPtrW(h, -16, ((oldStyle | CHILD) & ~POPUP) >>> 0);
  SetParent(h, layers.host);
  const flags = 0x200 | 0x20 | SWP.NOMOVE | SWP.NOSIZE | SWP.NOACTIVATE;
  const ok = isDesktopChild(h, layers) && !!SetWindowPos(h, layers.after, 0, 0, 0, 0, flags);
  if (!ok) {
    SetParent(h, 0);
    SetWindowLongPtrW(h, -16, oldStyle);
    SetWindowPos(h, 0, 0, 0, 0, 0, flags | SWP.NOZORDER);
  }
  return ok;
}

function detachFromDesktop(h) {
  if (!isWindow(h)) return false;
  if (!(styleOf(h) & CHILD)) return true;
  SetParent(h, 0);
  SetWindowLongPtrW(h, -16, ((styleOf(h) & ~CHILD) | POPUP) >>> 0);
  SetWindowPos(h, 0, 0, 0, 0, 0, 0x200 | 0x20 | SWP.NOMOVE | SWP.NOSIZE | SWP.NOZORDER | SWP.NOACTIVATE);
  return !(styleOf(h) & CHILD) && ownerOf(h) === 0;
}

// rect 为物理屏幕坐标；子窗口必须换算到宿主坐标，不能交给 Electron 当作屏幕位置。
function positionDesktopChild(h, layers, rect) {
  if (!isDesktopChild(h, layers)) return false;
  const point = { x: Math.round(rect.x), y: Math.round(rect.y) };
  if (!ScreenToClient(layers.host, point)) return false;
  return !!SetWindowPos(h, 0, point.x, point.y, Math.round(rect.width), Math.round(rect.height),
    SWP.NOZORDER | SWP.NOACTIVATE);
}

// 父子关系正确并不代表绘制顺序正确：动态壁纸可能创建新的子窗口盖住挂件。
// 这里只检查关系；由桌面事件或低频健康检查决定是否修复，不放进鼠标轮询。
function desktopOrderIntact(h, layers) {
  if (!isDesktopChild(h, layers)) return false;
  let item = n(FindWindowExW(layers.host, layers.after || 0, null, null));
  for (let i = 0; item && i < 256; i++, item = nextWindow(item)) {
    if (item === h) return true;
    if (styleOf(item) & 0x10000000) return false;
  }
  return false;
}

function restoreDesktopOrder(h, layers) {
  if (!isDesktopChild(h, layers)) return false;
  if (desktopOrderIntact(h, layers)) return true;
  return !!SetWindowPos(h, layers.after || 0, 0, 0, 0, 0,
    0x200 | SWP.NOMOVE | SWP.NOSIZE | SWP.NOACTIVATE) && desktopOrderIntact(h, layers);
}

// 事件回调只通知上层延迟恢复；不能在 WinEvent 的调用栈里重新挂靠。
function watchDesktop(getLayers, changed) {
  const callback = koffi.register((_hook, event, hwnd, object, child) => {
    if (object !== 0 || child !== 0 || !hwnd) return;
    const h = n(hwnd), layers = getLayers();
    const tracked = layers && [layers.host, layers.icons, layers.iconView, layers.wallpaper, layers.progman].includes(h);
    if (tracked && [0x8001, 0x800f].includes(event)) changed('desktop-host-changed');
    else if (tracked && [0x8002, 0x8004].includes(event)) changed('desktop-order-changed');
    else if (layers && event === 0x8002 && parentOf(h) === layers.host) changed('desktop-child-shown');
    else if (event === 0x8002 && ['Progman', 'WorkerW'].includes(className(h))) changed('desktop-host-shown');
  }, 'RC_DesktopEvent *');
  const hooks = [SetWinEventHook(0x8001, 0x8004, 0, callback, 0, 0, 2),
    SetWinEventHook(0x800f, 0x800f, 0, callback, 0, 0, 2)].map(n).filter(Boolean);
  return () => { for (const hook of hooks) UnhookWinEvent(hook); koffi.unregister(callback); };
}

function windowRect(h) {
  const r = {};
  if (!GetWindowRect(h, r)) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function setWindowPos(h, x, y, w, hgt, flags) {
  return !!SetWindowPos(h, 0, Math.round(x), Math.round(y), Math.round(w), Math.round(hgt), flags | SWP.NOZORDER | SWP.NOACTIVATE);
}

// 嵌入失败时的降级：压到所有普通窗口下面
const sendToBottom = h => !!SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP.NOMOVE | SWP.NOSIZE | SWP.NOACTIVATE);

function cursorPos() {
  const p = {};
  GetCursorPos(p);
  return { x: p.x, y: p.y };
}

// 光标下面是不是桌面（或挂件自己）；是别的程序窗口就说明挂件被挡住了，不算悬停
const DESKTOP = new Set(['SysListView32', 'SHELLDLL_DefView', 'WorkerW', 'Progman']);
function isDesktopAt(pt, own) {
  const h = n(WindowFromPoint(pt));
  if (!h) return false;
  if (h === own || parentOf(h) === own) return true;
  const progman = n(FindWindowW('Progman', null));
  return !!progman && DESKTOP.has(className(h)) && processOf(h) === processOf(progman);
}

const leftButtonDown = () => (GetAsyncKeyState(0x01) & 0x8000) !== 0;

module.exports = {
  SWP, hwndOf, className, processOf, findDesktopLayers, findWorkerW, parentOf, rootOf, ownerOf, setOwner, nextWindow, styleOf, exStyleOf,
  attachToDesktop, detachFromDesktop, isDesktopChild, positionDesktopChild, desktopOrderIntact, restoreDesktopOrder, watchDesktop,
  isWindow, windowRect, setWindowPos, sendToBottom, cursorPos, isDesktopAt, leftButtonDown,
  doubleClickTime: () => GetDoubleClickTime(),
};
