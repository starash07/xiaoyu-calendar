// 系统托盘：左键唤出 / 收起主面板；右键显示与设置同风格的菜单。
const { Tray, nativeImage } = require('electron');
const { TrayMenu } = require('./tray-menu');
const P = require('./paths');
const W = require('./win32');

function createTray(h) {
  const trayIcon = nativeImage.createFromPath(P.TRAY_ICON_PNG).resize({ width: 32, height: 32, quality: 'best' });
  const tray = new Tray(trayIcon);
  const balloon = content => {
    if (!tray.isDestroyed()) tray.displayBalloon({ title: '鱼鱼日程', content, iconType: 'info' });
  };
  const menu = new TrayMenu(h, balloon);
  let doubleClickUntil = 0;
  tray.on('click', () => {
    menu.hide();
    // Windows 双击后的第二次 mouse-up 可能再发出 click，不能把刚唤回的窗口收走。
    if (Date.now() < doubleClickUntil) { doubleClickUntil = 0; return; }
    h.toggle();
  });
  tray.on('double-click', () => {
    menu.hide();
    doubleClickUntil = Date.now() + W.doubleClickTime();
    h.show();
  });
  tray.on('right-click', () => menu.open());
  const refresh = () => {
    if (tray.isDestroyed()) return;
    tray.setToolTip(`鱼鱼日程 · 今天有 ${h.todayCount()} 项日程`);
    menu.refresh();
  };
  refresh();
  return { tray, refresh, balloon, destroy: () => { menu.destroy(); tray.destroy(); } };
}

module.exports = { createTray };
