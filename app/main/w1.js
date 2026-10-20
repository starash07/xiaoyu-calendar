// W1：隐藏网页负责排版，原生透明窗口负责显示；桌面检查与悬停互不触发。
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const W = require('./win32');
const P = require('./paths');
const A = require('../renderer/shared/appearance');
const { NativeGlass } = require('./native-glass');
const { DesktopSurface } = require('./desktop-surface');

const MARGIN = 8;   // 页面四周的透明留白

class W1 {
  constructor(store, { balloon, onChange, native = W, hidden = false }) {
    if ((native !== W || hidden) && !P.SELFTEST) throw new Error('测试宿主只能用于独立自测');
    this.native = native;
    this.hidden = hidden;
    this.store = store;
    this.balloon = balloon;
    this.onChange = onChange;
    this.glass = new NativeGlass();
    this.appearancePreview = null;
    this.win = null;
    this.surface = null;
    this.hwnd = 0;
    this.embedded = false;
    this.degraded = false;
    this.desktopLayers = null;
    this.size = { w: 0, h: 0 };
    this.pos = null;
    this.lastPt = null;
    this.lastInside = false;
    this.quitting = false;
    this.ready = false;
    this.retryDelay = 1000;
    this.metrics = { attachAttempts: 0, attachments: 0, placements: 0, cursorChecks: 0, recoveries: 0, orderRepairs: 0 };
  }

  get pinned() { return this.transitionPinned ?? !!this.store.settings.w1.pinned; }

  defaultPos() {
    const wa = screen.getPrimaryDisplay().workArea;
    const w = this.store.settings.w1.appearance.width + MARGIN * 2;
    return { x: wa.x + wa.width - w - 32, y: wa.y + 32 };
  }

  create() {
    if (this.quitting || this.win) return;
    const s = this.store.settings.w1;
    this.pos = s.x != null && s.y != null ? { x: s.x, y: s.y } : this.defaultPos();
    this.size = { w: s.appearance.width + MARGIN * 2, h: 360 };
    this.ensureOnScreen(false);
    this.createSurface();
    const win = this.win = new BrowserWindow({
      x: this.pos.x, y: this.pos.y, width: this.size.w, height: this.size.h,
      frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, thickFrame: false, show: false,
      focusable: false,
      webPreferences: { preload: P.PRELOAD, backgroundThrottling: false, offscreen: true },
    });
    win.setMenu(null);
    win.webContents.setFrameRate(30);
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (this.quitting || this.win !== win) return;
      this.lastFrame = image;
      if (this.surface?.paint(image) && this.ready && !this.hidden) this.surface.show();
    });
    win.loadFile(path.join(P.RENDERER, 'w1', 'index.html'));
    win.once('ready-to-show', () => {
      if (this.win !== win || this.quitting) return;
      this.ready = true;
      if (this.pinned) this.embed(true);
      else this.unembed();
      if (!this.hidden) this.surface.show();
      this.applyGlass();
      this.onChange();
      this.sendInfo();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.ready = false;
      this.embedded = false;
      this.desktopLayers = null;
      this.surface?.destroy();
      this.surface = null;
      this.lastFrame = null;
      this.glass.reset();
      clearTimeout(this.recoverTimer);
      // Explorer 销毁父窗口时也会销毁子窗口；重建时重新读取设置和桌面宿主。
      if (!this.quitting) this.recreateTimer = setTimeout(() => this.create(), 1500);
    });
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.poll(), 100);
    if (!this.healthTimer) this.healthTimer = setInterval(() => this.checkHealth(), 3000);
    if (!this.stopWatching) this.stopWatching = this.native.watchDesktop(
      () => this.desktopLayers, reason => this.scheduleRecovery(reason));
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, data);
  }

  createSurface() {
    this.surface?.destroy();
    this.surface = new DesktopSurface({
      onInput: input => {
        if (this.win && !this.win.isDestroyed() && !this.pinned) this.win.webContents.sendInputEvent(input);
      },
      onLost: () => {
        if (this.quitting) return;
        this.embedded = false;
        this.desktopLayers = null;
        this.scheduleRecovery('surface-destroyed');
      },
      onError: error => {
        if (this.surfaceError === error) return;
        this.surfaceError = error;
        this.balloon('桌面日历暂时没有画出来，请在设置中解锁后重新钉住');
      },
    });
    this.hwnd = this.surface.hwnd;
    this.surface.setClickThrough(this.pinned);
    this.metrics.surfaces = (this.metrics.surfaces || 0) + 1;
    this.glass.reset();
  }

  bounds() {
    return { x: Math.round(this.pos.x), y: Math.round(this.pos.y), width: this.size.w, height: this.size.h };
  }

  // 位置设置保存在 DIP 屏幕坐标；嵌入后改用物理坐标定位到父窗口客户区。
  place() {
    if (!this.win || this.win.isDestroyed()) return false;
    const b = this.bounds();
    this.win.setBounds(b); // 仅更新隐藏网页的视口。
    const physical = screen.dipToScreenRect(null, b);
    this.surface.scale = screen.getDisplayNearestPoint(this.pos).scaleFactor;
    this.surface.expectedSize = { width: physical.width, height: physical.height };
    this.surface.viewportSize = { width: b.width, height: b.height };
    if (this.embedded) {
      if (!this.native.positionDesktopChild(this.hwnd, this.desktopLayers, physical)) {
        this.scheduleRecovery('parent-lost');
        return false;
      }
    } else if (!this.surface.position(physical)) return false;
    this.metrics.placements++;
    if (this.lastFrame) this.surface.paint(this.lastFrame);
    this.applyGlass();
    return true;
  }

  embed(createHost = false) {
    if (!this.win || !this.ready) return false;
    if (!this.surface?.hwnd || !this.native.isWindow(this.hwnd)) this.createSurface();
    if (this.embedded && this.native.isDesktopChild(this.hwnd, this.desktopLayers)) return true;
    this.metrics.attachAttempts++;
    const layers = this.native.findDesktopLayers({ create: createHost });
    if (layers) {
      this.surface.setTopmost(false);
      this.surface.setClickThrough(true);
      this.glass.clearMaterial(this.hwnd);
      if (this.native.attachToDesktop(this.hwnd, layers)) {
        this.desktopLayers = layers;
        this.embedded = true;
        this.degraded = false;
        this.metrics.attachments++;
        this.retryDelay = 1000;
        this.lastPt = null;
        this.lastInside = false;
        if (!this.place()) {
          this.degrade();
          return false;
        }
        if (!this.hidden) this.surface.show();
        return true;
      }
    }
    this.degrade();
    return false;
  }

  // 挂靠失败：退回成置底的普通窗口，只提示一次。
  degrade() {
    this.embedded = false;
    this.desktopLayers = null;
    this.native.detachFromDesktop(this.hwnd);
    this.surface.setClickThrough(true);
    if (!this.degraded) {
      this.degraded = true;
      this.balloon('桌面挂靠失败，已切换为置底显示');
    }
    this.surface.setTopmost(false);
    if (!this.place()) return false;
    this.native.sendToBottom(this.hwnd);
    this.scheduleRecovery('attach-failed', this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  unembed() {
    clearTimeout(this.recoverTimer);
    this.recoverTimer = null;
    if (!this.native.detachFromDesktop(this.hwnd)) return false;
    this.embedded = false;
    this.degraded = false;
    this.desktopLayers = null;
    this.surface.setClickThrough(false);
    if (!this.place()) return false;
    // 先解除桌面挂靠并重新定位，再恢复摆放时的置顶。
    this.surface.setTopmost(true);
    this.applyGlass();
    return true;
  }

  // 页面报告内容大小：顶部位置不动，只改宽高（底边随内容伸缩）
  resize(w, h) {
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    w = Math.max(120, Math.ceil(w));
    h = Math.max(60, Math.ceil(h));
    if (w === this.size.w && h === this.size.h) return;
    const widthChanged = w !== this.size.w;
    this.size = { w, h };
    this.place();
    if (widthChanged) {
      this.lastPt = null;
      this.sendInfo();
    }
  }

  // 钉住时鼠标点击穿透；仅当光标下面确实是桌面时，才把坐标发给页面做悬停。
  poll() {
    if (!this.win || !this.ready || !this.pinned) return;
    this.metrics.cursorChecks++;
    const pt = this.native.cursorPos();
    const moved = !this.lastPt || pt.x !== this.lastPt.x || pt.y !== this.lastPt.y;
    this.lastPt = pt;
    const r = this.native.windowRect(this.hwnd);
    const inside = !!r && pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom && this.native.isDesktopAt(pt, this.hwnd);
    // 鼠标静止时也检查遮挡，切到工作窗口后应收起原来的详情。
    if (!moved && inside === this.lastInside) return;
    if (inside) {
      const scale = screen.getDisplayNearestPoint(this.pos).scaleFactor;
      this.send('w1:cursor', { x: (pt.x - r.left) / scale, y: (pt.y - r.top) / scale });
      this.lastInside = true;
    } else if (this.lastInside) {
      this.send('w1:cursor', { x: -1, y: -1 });
      this.lastInside = false;
    }
  }

  applyGlass(force = false) {
    if (!this.win || this.win.isDestroyed() || this.quitting) return;
    const ap = A.normalize({ ...this.store.settings.w1.appearance, ...this.appearancePreview });
    const display = screen.getDisplayNearestPoint({ x: Math.round(this.pos.x + this.size.w / 2), y: Math.round(this.pos.y + MARGIN) });
    this.hwnd = this.surface?.hwnd || 0;
    this.glass.update({ hwnd: this.hwnd, width: this.size.w, height: this.size.h,
      scale: display.scaleFactor, margin: MARGIN, blur: ap.blur, pinned: this.pinned, desktopChild: this.embedded, surface: true, force });
  }

  previewAppearance(ap) {
    this.appearancePreview = ap;
    this.applyGlass();
    this.send('w1:preview', ap);
  }

  sendInfo() {
    if (!this.pos) return;
    this.send('w1:info', {
      loose: !this.pinned, embedded: this.embedded, degraded: this.degraded, dragging: !!this.dragTimer,
      pos: this.pos, margin: MARGIN,
    });
  }

  scheduleRecovery(reason, delay = 250) {
    if (this.quitting || !this.pinned || this.recoverTimer) return;
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      if (!this.win || !this.ready || this.quitting || !this.pinned) return;
      // 有效关系只核对绘制顺序；静态桌面不会触发重复 SetParent / SetWindowPos。
      if (this.embedded && this.native.isDesktopChild(this.hwnd, this.desktopLayers)) {
        if (!this.native.desktopOrderIntact(this.hwnd, this.desktopLayers)
          && this.native.restoreDesktopOrder(this.hwnd, this.desktopLayers)) this.metrics.orderRepairs++;
        return;
      }
      this.metrics.recoveries++;
      this.lastRecoveryReason = reason;
      this.embedded = false;
      this.embed();
      this.sendInfo();
      this.onChange();
    }, delay);
  }

  checkHealth() {
    if (!this.win || !this.ready) return;
    if (this.pinned && (!this.embedded || !this.native.desktopOrderIntact(this.hwnd, this.desktopLayers))) this.scheduleRecovery('health-check');
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
      if (!this.native.leftButtonDown()) {
        clearInterval(this.dragTimer);
        this.dragTimer = null;
        const res = this.store.saveSettings({ w1: { x: Math.round(this.pos.x), y: Math.round(this.pos.y) } });
        this.sendInfo();
        if (!res.ok) this.balloon('挂件位置保存失败，请重新摆放后再试');
        return;
      }
      const c = screen.getCursorScreenPoint();
      this.pos = { x: origin.x + c.x - start.x, y: origin.y + c.y - start.y };
      this.place();
      this.sendInfo();
    }, 16);
    this.sendInfo();
  }

  setPinned(pinned) {
    if (pinned === this.pinned && (!this.ready || (pinned ? this.embedded : !this.embedded))) return { ok: true };
    const previous = this.pinned;
    clearInterval(this.dragTimer);
    this.dragTimer = null;
    const apply = value => {
      this.transitionPinned = value;
      return !this.ready || (value ? this.embed(true) : this.unembed());
    };
    let res;
    try {
      if (!apply(pinned)) {
        apply(previous);
        res = { ok: false, error: pinned ? '暂时无法钉到桌面，请稍后重试' : '暂时无法解锁，请稍后重试' };
      } else {
        res = this.store.saveSettings({ w1: { pinned, x: Math.round(this.pos.x), y: Math.round(this.pos.y) } });
        if (!res.ok) apply(previous);
      }
    } finally {
      this.transitionPinned = undefined;
    }
    this.sendInfo();
    this.onChange();
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
    clearTimeout(this.recoverTimer);
    clearTimeout(this.recreateTimer);
    this.stopWatching?.();
    this.stopWatching = null;
    this.lastFrame = null;
    this.surface?.destroy();
    this.surface = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { W1, MARGIN };
