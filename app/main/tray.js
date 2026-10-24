// 系统托盘：左键唤出 / 收起主面板；右键显示与设置同风格的菜单。
const { Tray, nativeImage } = require('electron');
const { TrayMenu } = require('./tray-menu');
const P = require('./paths');

function createTray(h) {
  const trayIcon = nativeImage.createFromPath(P.TRAY_ICON_PNG).resize({ width: 32, height: 32, quality: 'best' });
  const tray = new Tray(trayIcon);
  const balloon = content => {
    if (!tray.isDestroyed()) tray.displayBalloon({ title: '小鱼日程表', content, iconType: 'info' });
  };
  const menu = new TrayMenu(h, balloon);
  tray.on('click', () => { menu.hide(); h.toggle(); });
  tray.on('right-click', () => menu.open());
  const refresh = () => {
    if (tray.isDestroyed()) return;
    tray.setToolTip(`小鱼日程表 · 今天有 ${h.todayCount()} 项日程`);
    menu.refresh();
  };
  refresh();
  return { tray, refresh, balloon, destroy: () => { menu.destroy(); tray.destroy(); } };
}

module.exports = { createTray };
