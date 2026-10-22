// 设置单独显示在主面板所在屏幕中央；外侧透明，主面板保持原位。
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const P = require('./paths');

class SettingsWindow {
  constructor(panel, { onClose = () => {}, hidden = false } = {}) {
    this.panel = panel;
    this.onClose = onClose;
    this.hidden = hidden; // 隐藏检查不显示窗口或抢焦点。
    this.win = null;
    this.displayId = null;
    this.ready = false;
    this.timeout = null;
  }

  owns(sender) { return !!this.win && !this.win.isDestroyed() && sender === this.win.webContents; }

  send(channel, value) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, value);
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.send('settings:reopen');
      if (this.ready && !this.hidden) { this.win.show(); this.win.focus(); }
      return { ok: true };
    }
    this.panel.setSettingsOpen(true);
    try {
      if (!this.hidden) this.panel.show();
      const display = screen.getDisplayMatching(this.panel.win.getBounds());
      this.displayId = display.id;
      const win = this.win = new BrowserWindow({
        ...display.workArea, parent: this.panel.win, modal: false,
        frame: false, transparent: true, backgroundColor: '#00000000',
        hasShadow: false, roundedCorners: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
        webPreferences: { preload: P.PRELOAD, backgroundThrottling: false, offscreen: this.hidden },
      });
      win.setMenu(null);
      win.on('closed', () => {
        if (this.win !== win) return;
        clearTimeout(this.timeout);
        this.timeout = null;
        this.win = null;
        this.ready = false;
        // 独立于页面的输入锁；关闭、加载失败或渲染进程退出都必须释放。
        this.panel.setSettingsOpen(false);
        this.onClose();
      });
      win.webContents.on('render-process-gone', () => this.fail(win));
      this.timeout = setTimeout(() => this.fail(win), 10000);
      this.timeout.unref();
      win.loadFile(path.join(P.RENDERER, 'settings', 'index.html')).catch(() => this.fail(win));
      return { ok: true };
    } catch (_) {
      this.close();
      this.panel.setSettingsOpen(false);
      return { ok: false };
    }
  }

  markReady(sender) {
    if (!this.owns(sender)) return;
    clearTimeout(this.timeout);
    this.timeout = null;
    this.ready = true;
    if (!this.hidden) { this.win.show(); this.win.focus(); }
  }

  fail(win) {
    if (this.win !== win) return;
    this.close();
    this.panel.send('settings:error', '设置窗口未能打开，请重试。');
  }

  updateDisplay() {
    if (!this.win || this.win.isDestroyed()) return;
    const display = screen.getAllDisplays().find(d => d.id === this.displayId)
      || screen.getDisplayMatching(this.panel.win.getBounds());
    this.displayId = display.id;
    this.win.setBounds(display.workArea);
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { SettingsWindow };
