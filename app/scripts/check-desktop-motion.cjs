// 隐藏的真实离屏网页与原生表面；只挂到自建隐藏宿主，不操作 Explorer、鼠标或真实日程。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { app, BrowserWindow, ipcMain } = require('electron');
const P = require('../main/paths');
const W = require('../main/win32');
const A = require('../renderer/shared/appearance');
const { W1, MARGIN } = require('../main/w1');
const runtime = require('../main/selftest-runtime');
assert.ok(P.SELFTEST);
runtime.install();
app.setPath('userData', path.join(P.DATA, 'desktop-motion-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseline = process.argv.includes('--record-baseline');
const checks = [], phases = [], errors = [];
let w1, host, finished = false, current = null;
async function until(test, label) {
  for (let n = 0; n < 100; n++) { if (await test()) return; await wait(30); }
  throw new Error('等待超时：' + label);
}
function finish(error) {
  if (finished) return;
  finished = true;
  w1?.destroy(); if (host && !host.isDestroyed()) host.destroy();
  const result = { passed: !error, baseline, visibleWindows: 0, realDesktopAccess: false, osMouseInput: false,
    realDataAccess: false, checks, phases, errors, error: error ? String(error.stack || error) : null };
  fs.mkdirSync(P.SHOTS, { recursive: true });
  fs.writeFileSync(path.join(P.SHOTS, baseline ? 'w1-motion-before.json' : 'w1-motion-result.json'), JSON.stringify(result, null, 2));
  runtime.log(JSON.stringify(result)); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Desktop motion check timed out')), 30000).unref();
app.whenReady().then(async () => {
  host = new BrowserWindow({ show: false, frame: false, focusable: false, skipTaskbar: true, width: 1800, height: 1800 });
  host.on('show', () => finish(new Error('测试宿主不能显示')));
  const hwnd = W.hwndOf(host), layers = { host: hwnd, icons: hwnd, iconView: hwnd, wallpaper: hwnd, after: 0, kind: 'separate' };
  const store = { settings: { w1: { pinned: true, x: 40, y: 40, appearance: { ...A.DEFAULT } } },
    tasks: [
      { id: 'short', title: '整理日程', startDate: '2026-10-22', endDate: '2026-10-24', color: '#A7D7C7', note: '短备注', done: false },
      { id: 'long', title: '项目安排', startDate: '2026-10-22', endDate: '2026-10-25', color: '#AFA9EC', note: Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行详情`).join('\n'), done: false },
    ], reminders: [], saveSettings() { return { ok: true }; } };
  const state = () => ({ settings: store.settings, tasks: store.tasks, reminders: [], today: '2026-10-23' });
  const native = { ...W, findDesktopLayers: () => layers, watchDesktop: () => () => {}, cursorPos: () => ({ x: -100000, y: -100000 }) };
  w1 = new W1(store, { native, hidden: true, balloon: message => errors.push(message), onChange: () => w1.send('state', state()) });
  ipcMain.handle('state:get', state);
  ipcMain.on('w1:ready', () => w1.sendInfo());
  ipcMain.on('w1:size', (_event, { w, h }) => { if (current) current.sizeReports++; w1.resize(w, h); });
  w1.create();
  w1.win.on('show', () => finish(new Error('测试页面不能显示')));
  w1.win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => w1.win.webContents.executeJavaScript(code);
  await until(() => w1.ready && w1.embedded && w1.surface.metrics.frames > 0, '离屏网页和原生表面');
  await js('document.fonts.ready.then(() => true)'); await wait(200);
  clearInterval(w1.pollTimer); clearInterval(w1.healthTimer);
  const base = { ...w1.size }, top = W.windowRect(w1.hwnd).top, attachments = w1.metrics.attachments;
  const barPoint = id => js(`(() => { const r = document.querySelector('.cal-bar[data-id="${id}"]').getBoundingClientRect(); return { x:r.left + 8, y:r.top + r.height / 2 }; })()`);
  const shortPoint = await barPoint('short'), longPoint = await barPoint('long');
  const paint = w1.surface.paint.bind(w1.surface);
  w1.surface.paint = image => {
    const start = performance.now(), accepted = paint(image), elapsed = performance.now() - start;
    if (current && accepted) {
      const { width, height } = image.getSize(), pixels = image.toBitmap(), x = Math.floor(width / 2);
      let bottom = height - 1;
      while (bottom >= 0 && pixels[(bottom * width + x) * 4 + 3] < 20) bottom--;
      current.frames.push({ at: Math.round(performance.now() - current.started), bottom, paintMs: +elapsed.toFixed(2) });
    }
    return accepted;
  };
  const measure = async (name, act) => {
    const before = { ...w1.surface.metrics, placements: w1.metrics.placements };
    current = { name, sizeReports: 0, frames: [], started: performance.now() };
    await act(); await wait(400);
    const sample = current; current = null;
    const after = w1.surface.metrics;
    const result = { name, fps: w1.win.webContents.getFrameRate(), sizeReports: sample.sizeReports,
      placements: w1.metrics.placements - before.placements, buffers: after.buffers - before.buffers,
      staleFrames: after.staleFrames - before.staleFrames, acceptedFrames: sample.frames.length,
      distinctBottoms: new Set(sample.frames.map(frame => frame.bottom)).size,
      frameTimes: sample.frames.map(frame => frame.at), bottoms: sample.frames.map(frame => frame.bottom),
      maxPaintMs: Math.max(0, ...sample.frames.map(frame => frame.paintMs)),
      height: w1.size.h, panelHeight: await js('document.getElementById("panel").getBoundingClientRect().height') };
    phases.push(result);
    assert.equal(W.windowRect(w1.hwnd).top, top);
    assert.ok(Math.abs(result.height - result.panelHeight - MARGIN * 2) <= 1, '动画结束后恢复内容高度');
    return result;
  };
  const opened = await measure('open', async () => w1.send('w1:cursor', shortPoint));
  assert.ok(opened.height > base.h + 30);
  const closed = await measure('close', async () => w1.send('w1:cursor', { x: -1, y: -1 }));
  assert.equal(closed.height, base.h);
  await measure('reverse-and-switch', async () => {
    w1.send('w1:cursor', shortPoint); await wait(70);
    w1.send('w1:cursor', { x: -1, y: -1 }); await wait(40);
    w1.send('w1:cursor', longPoint);
  });
  assert.match(await js('document.getElementById("detail").textContent'), /第 8 行详情/);
  await measure('close-long', async () => w1.send('w1:cursor', { x: -1, y: -1 }));
  assert.equal(w1.size.h, base.h);
  await measure('cancel-before-reveal', async () => {
    w1.send('w1:cursor', shortPoint);
    w1.send('w1:cursor', { x: -1, y: -1 });
  });
  assert.equal(w1.size.h, base.h);
  assert.equal(await js('document.getElementById("details").classList.contains("show")'), false, '快速移开后不应重新展开详情');
  assert.equal(w1.metrics.attachments, attachments);
  assert.equal(w1.surface.metrics.failures, 0);
  assert.equal(w1.win.isVisible(), false); assert.equal(w1.surface.isVisible(), false);
  assert.deepEqual(errors, []);
  checks.push('展开与收起恢复内容高度；长备注、快速反向、换条和展开前取消正常，顶部位置和宿主关系保持稳定');
  if (!baseline) {
    for (const phase of [opened, closed]) {
      assert.ok(phase.placements <= 2, '动画中不应逐帧调整原生窗口：' + JSON.stringify(phase));
      assert.ok(phase.buffers <= 2, '动画中不应逐帧重新分配画布');
      assert.ok(phase.distinctBottoms >= 5, '应有连续可见的中间帧：' + JSON.stringify(phase));
    }
    checks.push('展开与收起至多两次窗口尺寸 / 画布更新，仍呈现连续的卡片底边动画');
  }
  finish();
}).catch(finish);
