// 入口：单实例、运行数据锁在项目目录里、创建两个窗口和托盘、每天 0 点刷新提醒
const { app, ipcMain, powerMonitor, screen } = require('electron');
const P = require('./paths');

app.setPath('userData', P.USERDATA);
app.setPath('sessionData', P.USERDATA);
// 挂件在桌面层，总是被别的窗口盖着；别让 Chromium 因为“被遮挡”就停止绘制
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.setAppUserModelId('local.richeng.guajian');

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start);

function start() {
  const { Store } = require('./store');
  const { W1 } = require('./w1');
  const { W2 } = require('./w2');
  const { createTray } = require('./tray');
  const D = require('../renderer/shared/dates');

  const store = new Store();
  const firstRun = store.firstRun;
  let tray = null;

  const w1 = new W1(store, { balloon: msg => tray && tray.balloon(msg), onChange: () => broadcast() });
  const w2 = new W2(store);

  const state = () => ({
    ...store.snapshot(),
    w1: { pinned: !!store.settings.w1.pinned, embedded: w1.embedded, degraded: w1.degraded, wallAvg: w1.wallAvg },
  });
  const broadcast = () => {
    const s = state();
    w1.send('state', s);
    w2.send('state', s);
    if (tray) tray.refresh();
  };
  store.onChange(broadcast);

  const todayCount = () => {
    const day = D.today();
    return store.tasks.filter(t => !t.done && t.startDate <= day && t.endDate >= day).length;
  };
  const setAutoStart = on => {
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [P.ROOT] });
    return store.saveSettings({ general: { autoStart: on } });
  };

  tray = createTray({
    toggle: () => w2.toggle(),
    newTask: () => w2.command({ type: 'new' }),
    settings: () => w2.command({ type: 'settings' }),
    isPinned: () => !!store.settings.w1.pinned,
    setPinned: on => { w1.setPinned(on); broadcast(); },
    todayCount,
    autoStart: () => !!store.settings.general.autoStart,
    setAutoStart,
    loadSamples: () => store.loadSamples(),
    quit: () => app.quit(),
  });

  w1.create();
  w2.create(firstRun);
  if (firstRun) store.saveSettings({});   // 写出默认设置，下次启动就不算第一次了

  if (store.recovered.length) {
    const [what, how] = store.recovered[0];
    tray.balloon(how === 'bak' ? `${what}文件损坏，已从备份恢复`
      : `${what}文件损坏且备份不可用，已用空白数据启动，损坏的文件已保留`);
  }

  // —— 页面和主进程之间的通道 ——
  ipcMain.handle('state:get', () => state());
  ipcMain.on('w1:ready', () => w1.sendInfo());
  ipcMain.on('w1:size', (e, { w, h }) => w1.resize(w, h));
  ipcMain.on('w1:drag', () => w1.dragStart());
  ipcMain.handle('w1:pin', (e, pinned) => { const r = w1.setPinned(!!pinned); broadcast(); return r; });
  ipcMain.handle('w1:reset', () => w1.resetPosition());
  ipcMain.on('w2:drag', () => w2.dragStart());
  ipcMain.on('w2:block', (e, blocked) => { w2.blocked = !!blocked; });
  ipcMain.on('w2:hide', () => w2.hide());
  ipcMain.handle('task:create', (e, t) => store.createTask(t));
  ipcMain.handle('task:update', (e, id, patch) => store.updateTask(id, patch));
  ipcMain.handle('task:delete', (e, id) => store.deleteTask(id));
  ipcMain.handle('reminder:confirm', (e, id) => store.confirmReminder(id));
  ipcMain.handle('settings:save', (e, patch) => store.saveSettings(patch));
  ipcMain.on('appearance:preview', (e, ap) => w1.send('w1:preview', ap));
  ipcMain.handle('autostart:set', (e, on) => setAutoStart(!!on));

  // —— 提醒：每次启动检查一遍；每天 0 点刷新；睡眠唤醒后补做；每分钟兜底检查日期有没有变 ——
  store.refreshReminders();
  const check = () => { if (store.reminders.lastRefreshDate !== D.today()) store.refreshReminders(); };
  let midnight = null;
  const arm = () => {
    clearTimeout(midnight);
    const n = new Date();
    midnight = setTimeout(() => { check(); arm(); }, new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1) - n);
  };
  arm();
  powerMonitor.on('resume', () => { check(); arm(); });
  setInterval(check, 60 * 1000);

  // —— 屏幕变化：挂件跑到屏幕外就移回主显示器 ——
  screen.on('display-removed', () => w1.ensureOnScreen(true));
  screen.on('display-metrics-changed', () => { w1.ensureOnScreen(true); w1.place(); w1.sendInfo(); });
  screen.on('display-added', () => w1.sendInfo());

  app.on('second-instance', () => w2.show());   // 重复启动：唤出已经在运行的下拉窗
  app.on('window-all-closed', () => { /* 常驻托盘，不因为窗口都关了就退出 */ });
  app.on('before-quit', () => { w1.destroy(); w2.destroy(); });

  if (P.SELFTEST) require('./selftest').run({ store, w1, w2, broadcast });
}
