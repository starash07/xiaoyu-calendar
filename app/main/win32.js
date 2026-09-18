// Windows 接口：嵌入桌面（WorkerW）、光标位置、窗口层级。用 koffi 直接调 user32，不用编译原生模块。
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

koffi.struct('RC_POINT', { x: 'long', y: 'long' });
koffi.struct('RC_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
koffi.proto('bool __stdcall RC_EnumProc(intptr hwnd, intptr lParam)');

const FindWindowW = user32.func('intptr __stdcall FindWindowW(str16 cls, str16 title)');
const FindWindowExW = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 title)');
const SendMessageTimeoutW = user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint msg, uintptr wParam, intptr lParam, uint flags, uint timeout, void *result)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(RC_EnumProc *cb, intptr lParam)');
const SetParent = user32.func('intptr __stdcall SetParent(intptr child, intptr parent)');
const GetAncestor = user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint flags)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr hwnd)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RC_RECT *rect)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ RC_POINT *pt)');
const WindowFromPoint = user32.func('intptr __stdcall WindowFromPoint(RC_POINT pt)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr hwnd, void *buf, int max)');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int key)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint action, uint param, void *buf, uint flags)');

const SWP = { NOSIZE: 0x1, NOMOVE: 0x2, NOZORDER: 0x4, NOACTIVATE: 0x10, SHOWWINDOW: 0x40 };
const GA_PARENT = 1, GA_ROOT = 2, HWND_BOTTOM = 1;

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

// 找壁纸所在的 WorkerW：先让 Progman 生成它，再找「装着桌面图标那个窗口」后面的 WorkerW
function findWorkerW() {
  const progman = n(FindWindowW('Progman', null));
  if (!progman) return 0;
  SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, Buffer.alloc(8));
  let iconsHost = 0;
  EnumWindows((top) => {
    if (n(FindWindowExW(top, 0, 'SHELLDLL_DefView', null))) iconsHost = n(top);
    return true;
  }, 0);
  let workerw = 0;
  if (iconsHost && iconsHost !== progman) workerw = n(FindWindowExW(0, iconsHost, 'WorkerW', null));
  // Windows 11 24H2 起，WorkerW 变成 Progman 的子窗口
  if (!workerw) workerw = n(FindWindowExW(progman, 0, 'WorkerW', null));
  return workerw;
}

const setParent = (child, parent) => n(SetParent(child, parent));
const parentOf = h => n(GetAncestor(h, GA_PARENT));
const isWindow = h => !!h && !!IsWindow(h);

function windowRect(h) {
  const r = {};
  GetWindowRect(h, r);
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
  return DESKTOP.has(className(h));
}

const leftButtonDown = () => (GetAsyncKeyState(0x01) & 0x8000) !== 0;

function wallpaperPath() {
  const buf = Buffer.alloc(1040);
  if (!SystemParametersInfoW(0x0073, 520, buf, 0)) return '';
  const s = buf.toString('utf16le');
  const end = s.indexOf('\0');
  return end >= 0 ? s.slice(0, end) : s;
}

module.exports = {
  SWP, hwndOf, className, findWorkerW, setParent, parentOf, isWindow, windowRect, setWindowPos,
  sendToBottom, cursorPos, isDesktopAt, leftButtonDown, wallpaperPath,
};
