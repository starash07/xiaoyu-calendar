// W1 桌面挂件：钉住时嵌进桌面壁纸层（WorkerW），只响应悬停；摆放中是普通置顶窗口，可以拖
const { BrowserWindow, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const W = require('./win32');
const P = require('./paths');

const MARGIN = 8;   // 页面四周的透明留白，摆放中的虚线框画在这里

// 壁纸的显示方式（填充 / 适应 / 拉伸 / 平铺 / 居中 / 跨区），用来把模糊背景对齐到真实壁纸
function wallpaperFit() {
  const read = name => {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', name], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/REG_SZ\s+(\S+)/);
      return m ? m[1] : '';
    } catch (_) { return ''; }
  };
  if (read('TileWallpaper') === '1') return 'tile';
  return { 10: 'fill', 6: 'fit', 2: 'stretch', 22: 'span', 0: 'center' }[read('WallpaperStyle')] || 'fill';
}

// 壁纸在这块屏幕上实际画在哪（屏幕坐标）
function wallRect(fit, S, iw, ih) {
  if (fit === 'stretch') return { x: S.x, y: S.y, w: S.width, h: S.height };
  if (fit === 'center') return { x: S.x + (S.width - iw) / 2, y: S.y + (S.height - ih) / 2, w: iw, h: ih };
  if (fit === 'tile') return { x: S.x, y: S.y, w: iw, h: ih };
  const k = fit === 'fit' ? Math.min(S.width / iw, S.height / ih) : Math.max(S.width / iw, S.height / ih);
  return { x: S.x + (S.width - iw * k) / 2, y: S.y + (S.height - ih * k) / 2, w: iw * k, h: ih * k };
}

class W1 {
  constructor(store, { balloon, onChange }) {
    this.store = store;
    this.balloon = balloon;
    this.onChange = onChange;
    this.wallAvg = null;
    this.win = null;
    this.hwnd = 0;
    this.embedded = false;
    this.degraded = false;
    this.workerw = 0;
    this.size = { w: 0, h: 0 };
    this.pos = null;
    this.lastPt = null;
    this.lastInside = false;
    this.wallKey = '';
    this.quitting = false;
  }

  get pinned() { return !!this.store.settings.w1.pinned; }

  defaultPos() {
    const wa = screen.getPrimaryDisplay().workArea;
    const w = this.store.settings.w1.appearance.width + MARGIN * 2;
    return { x: wa.x + wa.width - w - 32, y: wa.y + 32 };
  }

  create() {
    const s = this.store.settings.w1;
    this.pos = s.x != null && s.y != null ? { x: s.x, y: s.y } : this.defaultPos();
    this.size = { w: s.appearance.width + MARGIN * 2, h: 360 };
    this.ensureOnScreen(false);
    const win = this.win = new BrowserWindow({
      x: this.pos.x, y: this.pos.y, width: this.size.w, height: this.size.h,
      frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, show: false,
      focusable: false, alwaysOnTop: !this.pinned,
      webPreferences: { preload: P.PRELOAD, backgroundThrottling: false },
    });
    win.setMenu(null);
    this.hwnd = W.hwndOf(win);
    win.loadFile(path.join(P.RENDERER, 'w1', 'index.html'));
    win.once('ready-to-show', () => {
      win.showInactive();
      if (this.pinned) this.embed();
      this.sendInfo();
    });
    win.on('closed', () => {
      // 资源管理器重启时 WorkerW 会被销毁，挂件窗口跟着没了：等一会儿重建并重新嵌入
      this.win = null;
      this.embedded = false;
      if (!this.quitting) setTimeout(() => this.create(), 1500);
    });
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.poll(), 100);
    if (!this.healthTimer) this.healthTimer = setInterval(() => this.checkHealth(), 3000);
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, data);
  }

  // 摆放位置（屏幕坐标）换成 WorkerW 里的坐标；嵌入时直接用 Win32 定位，不走 Electron
  place() {
    if (!this.win) return;
    const b = { x: Math.round(this.pos.x), y: Math.round(this.pos.y), width: this.size.w, height: this.size.h };
    if (this.embedded) {
      const phys = screen.dipToScreenRect(null, b);
      const wr = W.windowRect(this.workerw);
      W.setWindowPos(this.hwnd, phys.x - wr.left, phys.y - wr.top, phys.width, phys.height, W.SWP.SHOWWINDOW);
    } else {
      this.win.setBounds(b);
      if (this.degraded) W.sendToBottom(this.hwnd);
    }
  }

  embed() {
    if (!this.win) return false;
    const ww = W.findWorkerW();
    if (ww) {
      this.win.setAlwaysOnTop(false);
      W.setParent(this.hwnd, ww);
      if (W.parentOf(this.hwnd) === ww) {
        this.workerw = ww;
        this.embedded = true;
        this.degraded = false;
        this.place();
        return true;
      }
    }
    this.degrade();
    return false;
  }

  // 嵌入失败：退回成置底的普通窗口，只提示一次
  degrade() {
    this.embedded = false;
    if (!this.degraded) {
      this.degraded = true;
      this.balloon('桌面嵌入失败，已切换为置底显示');
    }
    this.win.setAlwaysOnTop(false);
    this.place();
  }

  unembed() {
    if (this.embedded) W.setParent(this.hwnd, 0);
    this.embedded = false;
    this.degraded = false;
    this.win.setAlwaysOnTop(true);
    this.place();
  }

  // 页面报告内容大小：顶部位置不动，只改宽高（底边随内容伸缩）
  resize(w, h) {
    w = Math.max(120, Math.ceil(w));
    h = Math.max(60, Math.ceil(h));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.place();
  }

  // 钉住后收不到鼠标消息：每 100ms 读一次光标，光标下面确实是桌面时才把坐标发给页面做悬停
  poll() {
    if (!this.win || !this.embedded) return;
    const pt = W.cursorPos();
    if (this.lastPt && pt.x === this.lastPt.x && pt.y === this.lastPt.y) return;
    this.lastPt = pt;
    const r = W.windowRect(this.hwnd);
    const inside = pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom && W.isDesktopAt(pt, this.hwnd);
    if (inside) {
      const scale = screen.getDisplayNearestPoint(screen.screenToDipPoint(pt)).scaleFactor;
      this.send('w1:cursor', { x: (pt.x - r.left) / scale, y: (pt.y - r.top) / scale });
      this.lastInside = true;
    } else if (this.lastInside) {
      this.send('w1:cursor', { x: -1, y: -1 });
      this.lastInside = false;
    }
  }

  wallpaper() {
    const file = W.wallpaperPath();
    if (!file || !fs.existsSync(file)) return null;
    return { url: `${pathToFileURL(file).href}?v=${Math.round(fs.statSync(file).mtimeMs)}`, fit: wallpaperFit() };
  }

  sendInfo() {
    if (!this.pos) return;
    const display = screen.getDisplayMatching({ x: this.pos.x, y: this.pos.y, width: this.size.w, height: this.size.h });
    const wallpaper = this.wallpaper();
    this.wallKey = wallpaper ? wallpaper.url : '';
    this.send('w1:info', {
      loose: !this.pinned, embedded: this.embedded, degraded: this.degraded,
      pos: this.pos, margin: MARGIN, display: display.bounds, wallpaper,
    });
    this.updateWallAvg(display);
  }

  // 挂件底下那块壁纸的平均颜色：设置页算字体颜色对比度时用
  updateWallAvg(display) {
    clearTimeout(this.avgTimer);
    this.avgTimer = setTimeout(() => {
      const file = W.wallpaperPath();
      const img = file && fs.existsSync(file) ? nativeImage.createFromPath(file) : null;
      if (!img || img.isEmpty()) return;
      const { width: iw, height: ih } = img.getSize();
      const r = wallRect(wallpaperFit(), display.bounds, iw, ih);
      const px = this.pos.x + MARGIN, py = this.pos.y + MARGIN;
      const pw = Math.max(1, this.size.w - MARGIN * 2), ph = Math.max(1, this.size.h - MARGIN * 2);
      const x = Math.round(Math.max(0, Math.min(iw - 1, (px - r.x) * iw / r.w)));
      const y = Math.round(Math.max(0, Math.min(ih - 1, (py - r.y) * ih / r.h)));
      const width = Math.max(1, Math.min(iw - x, Math.round(pw * iw / r.w)));
      const height = Math.max(1, Math.min(ih - y, Math.round(ph * ih / r.h)));
      const bmp = img.crop({ x, y, width, height }).resize({ width: 16, height: 16 }).toBitmap();
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < bmp.length; i += 4) { bb += bmp[i]; gg += bmp[i + 1]; rr += bmp[i + 2]; }
      const n = bmp.length / 4;
      const rgb = [rr, gg, bb].map(v => Math.round(v / n));
      if (!this.wallAvg || rgb.some((v, i) => v !== this.wallAvg[i])) {
        this.wallAvg = rgb;
        this.onChange();
      }
    }, 400);
  }

  checkHealth() {
    if (!this.win) return;
    if (this.pinned) {
      const lost = this.embedded && (!W.isWindow(this.workerw) || W.parentOf(this.hwnd) !== this.workerw);
      if (lost || this.degraded) this.embed();
    }
    const wallpaper = this.wallpaper();
    if ((wallpaper ? wallpaper.url : '') !== this.wallKey) this.sendInfo();   // 换壁纸或幻灯片切换
    this.ensureOnScreen(true);
  }

  // 拔掉副屏、改分辨率后挂件跑到屏幕外：移回主显示器右上角
  ensureOnScreen(notify) {
    const r = { x: this.pos.x, y: this.pos.y, width: this.size.w || 400, height: this.size.h || 300 };
    const visible = screen.getAllDisplays().some(({ bounds: b }) =>
      r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y);
    if (visible) return;
    this.pos = this.defaultPos();
    if (!this.win) return;
    this.place();
    this.sendInfo();
    this.store.saveSettings({ w1: { x: this.pos.x, y: this.pos.y } });
    if (notify) this.balloon('桌面挂件原来的位置不在屏幕内，已移回主显示器');
  }

  // 摆放中拖动：按下后跟着光标走，松开左键时保存位置
  dragStart() {
    if (!this.win || this.pinned) return;
    const start = screen.getCursorScreenPoint();
    const origin = { ...this.pos };
    clearInterval(this.dragTimer);
    this.dragTimer = setInterval(() => {
      if (!W.leftButtonDown()) {
        clearInterval(this.dragTimer);
        this.dragTimer = null;
        this.store.saveSettings({ w1: { x: Math.round(this.pos.x), y: Math.round(this.pos.y) } });
        return;
      }
      const c = screen.getCursorScreenPoint();
      this.pos = { x: origin.x + c.x - start.x, y: origin.y + c.y - start.y };
      this.place();
      this.sendInfo();
    }, 16);
  }

  setPinned(pinned) {
    const res = this.store.saveSettings({ w1: { pinned, x: Math.round(this.pos.x), y: Math.round(this.pos.y) } });
    if (!res.ok) return res;
    if (pinned) this.embed(); else this.unembed();
    this.sendInfo();
    return res;
  }

  resetPosition() {
    this.pos = this.defaultPos();
    this.place();
    this.sendInfo();
    return this.store.saveSettings({ w1: { x: this.pos.x, y: this.pos.y } });
  }

  // 退出时先从桌面层拿出来再销毁，桌面上不留残影
  destroy() {
    this.quitting = true;
    clearInterval(this.pollTimer);
    clearInterval(this.healthTimer);
    clearInterval(this.dragTimer);
    if (!this.win) return;
    if (this.embedded) W.setParent(this.hwnd, 0);
    this.win.destroy();
  }
}

module.exports = { W1, MARGIN };
