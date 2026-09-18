// 所有运行时文件都放在项目目录 E:\日程\app 下面，不写到系统的 AppData 里
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');
const DATA = path.join(ROOT, SELFTEST ? '.data-selftest' : '.data');

module.exports = {
  ROOT,
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
