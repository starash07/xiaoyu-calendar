// W2 下拉窗：不透明、可拖。拖到屏幕顶 / 左 / 右边缘 20px 内松开就吸附；
// 吸附后鼠标离开 500ms 收起，只在边缘露出 3px，鼠标碰到就滑出。底边和两块屏幕相接的边不吸附。
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const W = require('./win32');
const P = require('./paths');

const SNAP = 20, STRIP = 3, LEAVE_MS = 500;
const MIN_HEIGHT = 160;
const easeOut = k => 1 - Math.pow(1 - k, 3);   // 滑出：先快后慢
const easeIn = k => k * k * k;                 // 收起：先慢后快

class W2 {
  constructor(store) {
    this.store = store;
    this.win = null;
    this.dock = null;
    this.dockDisplayId = null;
    this.collapsed = false;
    this.blocked = false;     // 页面告诉我们：新建中 / 有弹窗 / 在设置页 / 输入框有焦点，这时不自动收起
    this.dragging = false;
    this.anim = null;
    this.leaveSince = 0;
    this.quitting = false;
    this.contentHeight = null;
    this.maxHeight = null;
    this.settingBounds = false;
    this.managedBounds = null;
  }

  create(firstRun) {
    const s = this.store.settings.w2;
    const b = this.initialBounds(s);
    this.dock = s.dock || null;
    if (this.dock) this.dockDisplayId = screen.getDisplayMatching(b).id;
    const win = this.win = new BrowserWindow({
      ...b, minWidth: 380, minHeight: MIN_HEIGHT, frame: false, transparent: true, hasShadow: true, resizable: true, skipTaskbar: true, show: false,
      alwaysOnTop: !!this.dock, backgroundColor: '#00000000',
      webPreferences: { preload: P.PRELOAD, backgroundThrottling: false },
    });
    win.setMenu(null);
    win.loadFile(path.join(P.RENDERER, 'w2', 'index.html'));
    win.once('ready-to-show', () => {
      if (firstRun) { win.show(); return; }                 // 第一次启动：屏幕中央浮动显示
      if (this.dock) {                                     // 上次吸附着：启动后收在边上
        this.collapsed = true;
        this.setBounds(this.dockBounds(true));
        win.showInactive();
      }                                                    // 上次是浮动：先隐藏，从托盘唤出
    });
    win.on('close', e => { if (!this.quitting) { e.preventDefault(); this.hide(); } });
    win.on('moved', () => { if (!this.isManagedChange()) this.afterMove(); });
    win.on('resized', () => {
      if (this.isManagedChange()) return;
      this.updateLayoutLimit();
      this.resizeToContent();
      this.saveBounds();
    });
    this.pollTimer = setInterval(() => this.poll(), 100);
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, data);
  }

  // 程序调整高度不能触发保存和全量重绘，否则悬停动画会被自己的 resize 打断。
  setBounds(bounds) {
    this.settingBounds = true;
    try {
      this.win.setBounds(bounds);
      this.managedBounds = this.win.getBounds();
    } finally { this.settingBounds = false; }
  }

  isManagedChange() {
    if (this.settingBounds) return true;
    const b = this.win.getBounds(), m = this.managedBounds;
    return m && ['x', 'y', 'width', 'height'].every(k => b[k] === m[k]);
  }

  updateLayoutLimit(force = false) {
    if (!this.win || this.win.isDestroyed()) return;
    const b = this.win.getBounds();
    const wa = this.dock ? this.dockArea() : screen.getDisplayMatching(b).workArea;
    const top = this.dock === 'top' ? wa.y : Math.max(wa.y, b.y);
    const maxHeight = Math.max(MIN_HEIGHT, wa.y + wa.height - top);
    if (force || maxHeight !== this.maxHeight) {
      this.maxHeight = maxHeight;
      this.send('w2:layout', { maxHeight });
    }
    this.resizeToContent();
  }

  resizeToContent(height = this.contentHeight) {
    if (!Number.isFinite(height) || height <= 0 || !this.win || this.win.isDestroyed()) return;
    this.contentHeight = Math.ceil(height);
    // 滑出/收起先完成位置动画，再应用期间最新的内容高度。
    if (this.anim || this.dragging) return;
    const b = this.win.getBounds();
    const h = Math.max(MIN_HEIGHT, Math.min(this.contentHeight, this.maxHeight || 1000));
    const y = this.dock === 'top' && this.collapsed ? this.dockArea().y - h + STRIP : b.y;
    if (b.height !== h || b.y !== y) this.setBounds({ ...b, height: h, y });
  }

  initialBounds(s) {
    const w = s.width || 480, h = s.height || 720;
    if (s.x != null && s.y != null) {
      const b = { x: s.x, y: s.y, width: w, height: h };
      const onScreen = screen.getAllDisplays().some(({ bounds: d }) => b.x < d.x + d.width && b.x + w > d.x && b.y < d.y + d.height && b.y + h > d.y);
      if (onScreen) return b;
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h };
  }

  // 这块屏幕的哪几条边是「外侧」：和别的屏幕相接的边不吸附，免得鼠标跨屏时误触发
  outerEdges(d) {
    const b = d.bounds;
    const others = screen.getAllDisplays().filter(o => o.id !== d.id).map(o => o.bounds);
    const hOverlap = o => o.x < b.x + b.width && o.x + o.width > b.x;
    const vOverlap = o => o.y < b.y + b.height && o.y + o.height > b.y;
    return {
      top: !others.some(o => o.y + o.height === b.y && hOverlap(o)),
      left: !others.some(o => o.x + o.width === b.x && vOverlap(o)),
      right: !others.some(o => o.x === b.x + b.width && vOverlap(o)),
    };
  }

  detectDock(b) {
    const d = screen.getDisplayMatching(b), wa = d.workArea, outer = this.outerEdges(d);
    const near = [
      outer.top && ['top', Math.abs(b.y - wa.y)],
      outer.left && ['left', Math.abs(b.x - wa.x)],
      outer.right && ['right', Math.abs(b.x + b.width - (wa.x + wa.width))],
    ].filter(c => c && c[1] <= SNAP).sort((p, q) => p[1] - q[1]);
    return near.length ? { edge: near[0][0], displayId: d.id } : null;
  }

  dockArea() {
    const d = screen.getAllDisplays().find(o => o.id === this.dockDisplayId) || screen.getPrimaryDisplay();
    return d.workArea;   // 以工作区为准，不压住任务栏
  }

  dockBounds(collapsed) {
    const b = this.win.getBounds(), wa = this.dockArea();
    const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width);
    const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
    if (this.dock === 'top') return { x, y: collapsed ? wa.y - b.height + STRIP : wa.y, width: b.width, height: b.height };
    if (this.dock === 'left') return { x: collapsed ? wa.x - b.width + STRIP : wa.x, y, width: b.width, height: b.height };
    return { x: collapsed ? wa.x + wa.width - STRIP : wa.x + wa.width - b.width, y, width: b.width, height: b.height };
  }

  animate(target, ms, ease) {
    clearInterval(this.anim);
    const from = this.win.getBounds(), t0 = Date.now();
    this.anim = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms), e = ease(k);
      this.setBounds({
        x: Math.round(from.x + (target.x - from.x) * e), y: Math.round(from.y + (target.y - from.y) * e),
        width: from.width, height: from.height,
      });
      if (k >= 1) { clearInterval(this.anim); this.anim = null; this.resizeToContent(); }
    }, 10);
  }

  collapse() {
    if (!this.dock || this.collapsed) return;
    this.collapsed = true;
    this.leaveSince = 0;
    this.animate(this.dockBounds(true), 150, easeIn);
  }

  expand() {
    if (!this.dock || !this.collapsed) return;
    this.collapsed = false;
    if (!this.win.isVisible()) this.win.showInactive();
    this.animate(this.dockBounds(false), 180, easeOut);
  }

  poll() {
    if (!this.win || !this.dock || this.anim || this.dragging) return;
    const c = screen.getCursorScreenPoint(), b = this.win.getBounds();
    const inside = c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;
    if (this.collapsed) { if (inside && this.win.isVisible()) this.expand(); return; }
    if (inside || this.blocked || W.leftButtonDown()) { this.leaveSince = 0; return; }
    if (!this.leaveSince) this.leaveSince = Date.now();
    else if (Date.now() - this.leaveSince >= LEAVE_MS) this.collapse();
  }

  // 用户拖完窗口：靠近外侧边缘就吸附，拖离边缘就取消吸附
  afterMove() {
    if (!this.win || this.anim || this.collapsed) return;
    const b = this.win.getBounds();
    const hit = this.detectDock(b);
    if (hit) {
      this.dock = hit.edge;
      this.dockDisplayId = hit.displayId;
      this.win.setAlwaysOnTop(true);
      this.setBounds(this.dockBounds(false));
    } else if (this.dock) {
      this.dock = null;
      this.win.setAlwaysOnTop(false);   // 浮动时不置顶（待确认），可以被其他窗口遮挡
    }
    this.updateLayoutLimit();
    this.saveBounds();
  }

  saveBounds() {
    if (!this.win || this.collapsed || this.anim) return;
    const b = this.win.getBounds();
    this.store.saveSettings({ w2: { dock: this.dock, x: b.x, y: b.y, width: b.width, height: b.height } });
  }

  // 日历区域按住拖动：由页面判断移动超过 4px 后才调用
  dragStart() {
    if (!this.win || this.collapsed) return;
    const start = screen.getCursorScreenPoint(), b0 = this.win.getBounds();
    this.dragging = true;
    clearInterval(this.dragTimer);
    this.dragTimer = setInterval(() => {
      if (!W.leftButtonDown()) {
        clearInterval(this.dragTimer);
        this.dragTimer = null;
        this.dragging = false;
        this.afterMove();
        return;
      }
      const c = screen.getCursorScreenPoint();
      this.setBounds({ x: b0.x + c.x - start.x, y: b0.y + c.y - start.y, width: b0.width, height: b0.height });
    }, 16);
  }

  isShown() { return !!this.win && this.win.isVisible() && !this.collapsed; }

  show() {
    if (!this.win) return;
    this.updateLayoutLimit(true);
    if (this.dock) { if (!this.win.isVisible()) this.win.showInactive(); this.expand(); }
    else this.win.show();
    this.win.focus();
  }

  // 用户主动隐藏 / 收起：关掉填写弹窗，放弃没保存的内容
  hide() {
    if (!this.win) return;
    this.send('w2:cmd', { type: 'discard' });
    if (this.dock) this.collapse(); else this.win.hide();
  }

  toggle() { if (this.isShown()) this.hide(); else this.show(); }

  command(cmd) { this.show(); this.send('w2:cmd', cmd); }

  destroy() {
    this.quitting = true;
    clearInterval(this.pollTimer);
    clearInterval(this.dragTimer);
    clearInterval(this.anim);
    if (this.win) this.win.destroy();
  }
}

module.exports = { W2 };
