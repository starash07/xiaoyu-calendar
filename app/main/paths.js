// 开发版数据留在项目中；安装版使用用户目录，避免往只读的安装包内写数据。
const path = require('path');
const electronApp = process.versions.electron ? require('electron').app : null;

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const ICONS = path.join(ASSETS, 'icons');
const SELFTEST = process.argv.includes('--selftest');
const DATA = !SELFTEST && electronApp?.isPackaged
  ? path.join(electronApp.getPath('appData'), '鱼鱼日程')
  : path.join(ROOT, SELFTEST ? '.data-selftest' : '.data');

module.exports = {
  ROOT,
  ASSETS,
  ICONS,
  ICON_PNG: path.join(ICONS, 'app-icon.png'),
  ICON_ICO: path.join(ICONS, 'app-icon.ico'),
  TRAY_ICON_PNG: path.join(ICONS, 'tray-icon.png'),
  SELFTEST,
  DATA,
  USERDATA: path.join(DATA, 'electron'),
  TASKS: path.join(DATA, 'tasks.json'),
  SETTINGS: path.join(DATA, 'settings.json'),
  REMINDERS: path.join(DATA, 'reminders.json'),
  SHOTS: path.join(DATA, 'shots'),
  RENDERER: path.join(ROOT, 'renderer'),
  PRELOAD: path.join(ROOT, 'preload', 'preload.js'),
};
