// 所有运行时文件都放在当前项目的 app 目录下面，不依赖盘符或其他电脑的路径。
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const ICONS = path.join(ASSETS, 'icons');
const SELFTEST = process.argv.includes('--selftest');
const DATA = path.join(ROOT, SELFTEST ? '.data-selftest' : '.data');

module.exports = {
  ROOT,
  ASSETS,
  ICONS,
  ICON_PNG: path.join(ICONS, 'app-icon.png'),
  ICON_ICO: path.join(ICONS, 'app-icon.ico'),
  TRAY_ICON_PNG: path.join(ICONS, 'tray-icon.png'),
  SELFTEST,
  DATA,
  USERDATA: path.join(DATA, 'electron'),   // Electron 自己的缓存也锁在项目里
  TASKS: path.join(DATA, 'tasks.json'),
  SETTINGS: path.join(DATA, 'settings.json'),
  REMINDERS: path.join(DATA, 'reminders.json'),
  SHOTS: path.join(DATA, 'shots'),
  RENDERER: path.join(ROOT, 'renderer'),
  PRELOAD: path.join(ROOT, 'preload', 'preload.js'),
};
