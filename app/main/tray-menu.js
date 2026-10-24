const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const P = require('./paths');

const WIDTH = 228, HEIGHT = 241, INSET = 10, POINTER_GAP = 2;

class TrayMenu {
  constructor(actions, notify) {
    this.actions = actions;
    this.notify = notify;
    this.win = null;
    this.pending = false;
    this.ready = false;
    this.painted = false;
    this.disposed = false;
    this.onReady = event => {
      if (!this.owns(event.sender)) return;
      this.ready = true;
      this.refresh();
      this.present();
    };
    this.onClose = event => { if (this.owns(event.sender)) this.hide(); };
    this.onDisplayChange = () => this.hide();
    ipcMain.on('tray-menu:ready', this.onReady);
    ipcMain.on('tray-menu:close', this.onClose);
    ipcMain.handle('tray-menu:action', (event, action) => this.run(event.sender, action));
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, this.onDisplayChange);
  }

  owns(sender) { return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents; }

  create() {
    this.ready = false;
    this.painted = false;
    const win = this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, roundedCorners: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false, icon: P.ICON_PNG,
      webPreferences: { preload: path.join(P.ROOT, 'preload', 'tray-menu.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.once('ready-to-show', () => { if (this.win === win) { this.painted = true; this.present(); } });
    win.on('blur', () => this.hide());
    win.on('close', event => { if (!this.disposed) { event.preventDefault(); this.hide(); } });
    win.on('closed', () => { if (this.win === win) { this.win = null; this.ready = false; this.painted = false; this.pending = false; } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => this.fail(win));
    win.loadFile(path.join(P.RENDERER, 'tray', 'index.html')).catch(() => this.fail(win));
  }

  fail(win) {
    if (this.disposed || this.win !== win) return;
    this.hide();
    win.destroy();
    this.notify('菜单暂时无法打开，请重新右键托盘图标。');
  }

  open(point = screen.getCursorScreenPoint()) {
    if (this.disposed) return;
    if (this.win?.isVisible()) { this.hide(); return; }
    this.point = point;
    this.pending = true;
    if (!this.win || this.win.isDestroyed()) this.create();
    this.present();
  }

  present() {
    if (!this.pending || !this.ready || !this.painted || !this.win) return;
    // 按可见卡片贴近点击点；透明阴影不计入间距，任务栏也不额外推开菜单。
    const area = screen.getDisplayNearestPoint(this.point).bounds;
    const cardWidth = WIDTH - INSET * 2, cardHeight = HEIGHT - INSET * 2;
    let left = this.point.x + POINTER_GAP, top = this.point.y + POINTER_GAP;
    if (left + cardWidth > area.x + area.width) left = this.point.x - POINTER_GAP - cardWidth;
    if (top + cardHeight > area.y + area.height) top = this.point.y - POINTER_GAP - cardHeight;
    left = Math.max(area.x, Math.min(left, area.x + area.width - cardWidth));
    top = Math.max(area.y, Math.min(top, area.y + area.height - cardHeight));
    this.win.setBounds({ x: Math.round(left - INSET), y: Math.round(top - INSET), width: WIDTH, height: HEIGHT });
    this.refresh();
    this.pending = false;
    this.win.show();
    this.win.focus();
    this.win.webContents.send('tray-menu:open');
  }

  refresh() {
    if (this.ready && this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('tray-menu:state', { pinned: this.actions.isPinned() });
    }
  }

  hide() {
    this.pending = false;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  async run(sender, action) {
    if (!this.owns(sender) || !this.win.isVisible() || !['show', 'pin', 'settings', 'restart', 'quit'].includes(action)) return { ok: false };
    this.hide();
    try {
      let result;
      if (action === 'show') result = await this.actions.show();
      else if (action === 'settings') result = await this.actions.settings();
      else if (action === 'pin') result = await this.actions.setPinned(!this.actions.isPinned());
      else if (action === 'restart') setImmediate(() => this.actions.restart());
      else setImmediate(() => this.actions.quit());
      if (result?.ok === false) {
        this.notify(result.error || '操作未完成，请重试。');
        return result;
      }
      return { ok: true };
    } catch (_) {
      this.notify('操作未完成，请重试。');
      return { ok: false };
    }
  }

  destroy() {
    this.disposed = true;
    this.hide();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    ipcMain.removeListener('tray-menu:ready', this.onReady);
    ipcMain.removeListener('tray-menu:close', this.onClose);
    ipcMain.removeHandler('tray-menu:action');
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, this.onDisplayChange);
  }
}

module.exports = { TrayMenu };
