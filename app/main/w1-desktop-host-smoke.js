// 真实桌面短测：先显示 4 秒独立挂件，再钉住 16 秒，自动退出。
// “显示桌面”由用户操作；结构结果不能代替用户对实际画面的确认。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, screen } = require('electron');
const koffi = require('koffi');
const P = require('./paths');
const W = require('./win32');
const A = require('../renderer/shared/appearance');
const D = require('../renderer/shared/dates');
const { Store } = require('./store');
const { W1 } = require('./w1');

function run() {
  assert.ok(P.SELFTEST && process.argv.includes('--desktop-host-smoke'));
  const started = Date.now(), samples = [], messages = [];
  let phase = 'placement', pinResult = null, pinTimer = null, observedReady = false;
  const foreground = koffi.load('user32.dll').func('intptr __stdcall GetForegroundWindow()');
  const store = new Store(), wa = screen.getPrimaryDisplay().workArea;
  store.saveSettings({ w1: { pinned: false, x: wa.x + 36, y: wa.y + 55, appearance: A.DEFAULT } });
  const today = D.today(), now = new Date().toISOString();
  store.tasks = [
    { id: 'host-main', title: '悬停检查：本周计划', startDate: D.addDays(today, -1), endDate: D.addDays(today, 2), color: '#A7D7C7',
      note: '鼠标移开后收回。测试结束后自动关闭。', done: false, pinned: false, remind: null, createdAt: now, updatedAt: now },
    { id: 'host-other', title: '桌面挂靠短测', startDate: today, endDate: D.addDays(today, 1), color: '#B7DCEF',
      note: '图标应在卡片上方保持清晰。', done: false, pinned: false, remind: null, createdAt: now, updatedAt: now },
  ];
  store.reminders = { items: [], lastRefreshDate: today };
  const state = () => ({ ...store.snapshot(), w1: { pinned: w1.pinned, embedded: w1.embedded, degraded: w1.degraded, glass: w1.glass.status } });
  const broadcast = () => { w1.applyGlass(); w1.send('state', state()); };
  const w1 = new W1(store, { balloon: message => messages.push(message), onChange: broadcast });
  const { ipcMain } = require('electron');
  ipcMain.handle('state:get', state);
  ipcMain.handle('w1:pin', (_e, value) => w1.setPinned(value));
  ipcMain.on('w1:ready', () => w1.sendInfo());
  ipcMain.on('w1:size', (e, { w, h }) => { if (e.sender === w1.win?.webContents) w1.resize(w, h); });
  ipcMain.on('w1:drag', () => w1.dragStart());
  w1.create();
  const finish = () => {
    clearInterval(timer); clearTimeout(pinTimer); clearTimeout(watchdog);
    const pinnedSamples = samples.filter(s => s.phase === 'desktop');
    const structuralPass = pinResult?.ok === true && pinnedSamples.length > 10
      && pinnedSamples.every(s => s.child && s.childOrder && s.visible && s.frames > 0 && !s.drawError) && !w1.degraded;
    const result = { structuralPass, visualPass: null, elapsedMs: Date.now() - started,
      desktopForegroundObserved: pinnedSamples.some(s => ['Progman', 'WorkerW', 'SHELLDLL_DefView'].includes(s.foreground)),
      pinResult, glass: w1.glass.status, messages, samples,
      visualResult: '等待用户确认实际显示、图标遮挡及闪烁；前台变成桌面不等于已验证右下角显示桌面按钮' };
    fs.mkdirSync(P.SHOTS, { recursive: true });
    fs.writeFileSync(path.join(P.SHOTS, 'w1-desktop-host-result.json'), JSON.stringify(result, null, 2));
    require('./selftest-runtime').log(JSON.stringify({ ...result, samples: samples.length, final: samples.at(-1) }));
    w1.destroy();
    app.exit(structuralPass ? 0 : 1);
  };
  const timer = setInterval(() => {
    if (!w1.ready || !w1.win || w1.win.isDestroyed()) return;
    if (!observedReady && w1.surface?.metrics.frames) {
      observedReady = true;
      pinTimer = setTimeout(() => {
        pinResult = w1.setPinned(true);
        phase = 'desktop';
        pinTimer = setTimeout(finish, 16000);
      }, 4000);
    }
    samples.push({ ms: Date.now() - started, phase, child: W.isDesktopChild(w1.hwnd, w1.desktopLayers),
      childOrder: W.desktopOrderIntact(w1.hwnd, w1.desktopLayers),
      visible: w1.surface?.isVisible(), rendererVisible: w1.win.isVisible(), frames: w1.surface?.metrics.frames,
      drawError: w1.surface?.lastError, foreground: W.className(Number(foreground())),
      rect: W.windowRect(w1.hwnd), ...w1.metrics });
  }, 250);
  const watchdog = setTimeout(finish, 25000);
}

module.exports = { run };
