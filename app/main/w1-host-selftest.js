// 完全隐藏的集成检查。桌面宿主由自己的窗口模拟，不读取或改动 Explorer 的窗口关系。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const P = require('./paths');
const W = require('./win32');
const A = require('../renderer/shared/appearance');
const D = require('../renderer/shared/dates');
const { W1, MARGIN } = require('./w1');
const { DesktopSurface } = require('./desktop-surface');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(test, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await test()) return; await wait(30); }
  throw new Error(`等待超时：${label}`);
}

async function run() {
  assert.ok(P.SELFTEST && process.argv.includes('--desktop-headless'));
  const log = [], owned = [], started = Date.now();
  let w1, failed = false, hookCallback, layers, testSurface, failSave = false, missingHost = false;
  const note = (name, value) => log.push({ name, value });
  const watchdog = setTimeout(() => { note('失败', '隐藏检查超过 25 秒'); finish(1); }, 25000);
  function finish(code) {
    clearTimeout(watchdog);
    w1?.destroy();
    testSurface?.destroy();
    for (const win of owned) if (!win.isDestroyed()) win.destroy();
    fs.mkdirSync(P.SHOTS, { recursive: true });
    fs.writeFileSync(path.join(P.SHOTS, 'w1-host-result.json'), JSON.stringify({
      passed: code === 0, elapsedMs: Date.now() - started, visibleWindows: 0, realDesktopAccess: false, log,
    }, null, 2));
    require('./selftest-runtime').log(JSON.stringify({ passed: code === 0, log }));
    app.exit(code);
  }
  function host() {
    const win = new BrowserWindow({ show: false, x: -6000, y: -6000, width: 1800, height: 1800,
      frame: false, focusable: false, skipTaskbar: true, thickFrame: false });
    owned.push(win);
    return W.hwndOf(win);
  }
  try {
    const icons = host(), iconView = host(), wallpaper = host();
    layers = { host: wallpaper, icons, iconView, wallpaper, after: 0, kind: 'separate' };
    const today = D.today(), now = new Date().toISOString();
    const task = (id, start, end) => ({ id, title: id, startDate: D.addDays(today, start), endDate: D.addDays(today, end),
      color: '#A7D7C7', note: '第一行详情\n第二行详情，用于检查自然高度。', done: false, pinned: false, remind: null,
      createdAt: now, updatedAt: now });
    const store = {
      settings: { w1: { pinned: true, x: 40, y: 40, appearance: { ...A.DEFAULT } } },
      tasks: [task('hidden-main', -1, 2), task('hidden-other', 0, 1)],
      reminders: [],
      saveSettings(patch) {
        if (failSave) return { ok: false, error: '模拟保存失败' };
        const next = patch.w1 || {};
        this.settings.w1 = { ...this.settings.w1, ...next, appearance: { ...this.settings.w1.appearance, ...next.appearance } };
        return { ok: true };
      },
    };
    const state = () => ({ settings: store.settings, tasks: store.tasks, reminders: store.reminders, today,
      w1: { pinned: w1.pinned, embedded: w1.embedded, degraded: w1.degraded, glass: w1.glass.status } });
    const broadcast = () => { w1.applyGlass(); w1.send('state', state()); };
    const native = { ...W, findDesktopLayers: () => missingHost ? null : layers,
      watchDesktop: (_get, changed) => { hookCallback = changed; return () => { hookCallback = null; }; },
      cursorPos: () => ({ x: -100000, y: -100000 }) };
    w1 = new W1(store, { balloon: message => note('提示', message), onChange: broadcast, native, hidden: true });
    ipcMain.handle('state:get', state);
    ipcMain.handle('w1:pin', (_e, value) => w1.setPinned(value));
    ipcMain.on('w1:ready', () => w1.sendInfo());
    ipcMain.on('w1:size', (e, { w, h }) => { if (e.sender === w1.win?.webContents) w1.resize(w, h); });
    w1.create();
    await until(() => w1.ready && w1.embedded && w1.size.h > 360, '隐藏窗口挂靠并按内容调整高度');
    const js = code => w1.win.webContents.executeJavaScript(code);
    await until(() => js('document.querySelectorAll(".cal-bar").length > 0'), '日程渲染');
    await until(() => w1.surface.metrics.frames > 0 && w1.surface.height === w1.surface.expectedSize.height, '原生透明帧');
    clearInterval(w1.pollTimer);
    assert.equal(w1.win.isVisible(), false);
    assert.ok(W.isDesktopChild(w1.hwnd, layers));
    assert.equal(W.ownerOf(w1.hwnd), 0);
    const expected = screen.dipToScreenRect(null, w1.bounds()), actual = W.windowRect(w1.hwnd);
    assert.equal(actual.left, expected.x); assert.equal(actual.top, expected.y);
    assert.equal(actual.right - actual.left, expected.width);
    note('真实父子关系与坐标', { parent: W.parentOf(w1.hwnd), expectedParent: layers.host, style: W.styleOf(w1.hwnd).toString(16), rect: actual });

    const frame = w1.lastFrame, { width: frameWidth, height: frameHeight } = frame.getSize();
    const pixels = frame.toBitmap(), scale = frameWidth / w1.size.w;
    const alpha = (x, y) => pixels[(Math.round(y * scale) * frameWidth + Math.round(x * scale)) * 4 + 3];
    assert.equal(alpha(0, 0), 0, '外侧留白不透明');
    assert.ok(alpha(MARGIN, MARGIN) < 10, '左上角仍画成实心方角');
    assert.ok(alpha(w1.size.w / 2, MARGIN + 2) > 20, '透明卡片没有画出来');
    assert.equal(w1.surface.width, w1.surface.expectedSize.width);
    note('网页绘制帧', { width: frameWidth, height: frameHeight,
      displayScale: w1.surface.scale, nativeSize: { width: w1.surface.width, height: w1.surface.height }, outsideAlpha: alpha(0, 0),
      cornerAlpha: alpha(MARGIN, MARGIN), topAlpha: alpha(w1.size.w / 2, MARGIN + 2),
      limitation: '核对送入原生窗口的像素；不代表真实桌面合成已经可见' });

    const before = { ...w1.metrics }, glassBefore = { ...w1.glass.metrics };
    for (let i = 0; i < 100; i++) w1.poll();
    for (let i = 0; i < 10; i++) w1.checkHealth();
    hookCallback('desktop-host-shown');
    await wait(300);
    assert.equal(w1.metrics.attachments, before.attachments);
    assert.equal(w1.metrics.placements, before.placements);
    assert.equal(w1.glass.metrics.materialUpdates, glassBefore.materialUpdates);
    assert.equal(w1.metrics.orderRepairs, before.orderRepairs);
    note('稳定桌面上的鼠标与健康检查', '100 次鼠标检查、10 次健康检查和桌面显示通知，没有重新挂靠、定位或启用材质');

    const base = { ...w1.size }, top = W.windowRect(w1.hwnd).top;
    const cursor = await js(`(() => {const r=document.querySelector('.cal-bar').getBoundingClientRect();return {x:r.left+8,y:r.top+r.height/2};})()`);
    w1.send('w1:cursor', cursor);
    const opening = [];
    for (let i = 0; i < 12; i++) { await wait(25); opening.push(w1.size.h); }
    const expanded = { ...w1.size };
    assert.ok(expanded.h > base.h + 30, '详情未展开');
    assert.ok(opening.some(h => h > base.h && h < expanded.h), '展开缺少缓动中间帧');
    assert.equal(W.windowRect(w1.hwnd).top, top);
    const panelHeight = await js('document.getElementById("panel").getBoundingClientRect().height');
    assert.ok(Math.abs(expanded.h - panelHeight - MARGIN * 2) <= 1);
    w1.send('w1:cursor', { x: -1, y: -1 });
    await until(() => w1.size.h === base.h, '收起恢复原高度');
    assert.equal(w1.metrics.attachments, before.attachments);
    assert.equal(w1.glass.metrics.materialUpdates, glassBefore.materialUpdates);
    note('悬停伸缩', { base: base.h, expanded: expanded.h, restored: w1.size.h, opening,
      reattachments: w1.metrics.attachments - before.attachments, materialReapplies: w1.glass.metrics.materialUpdates - glassBefore.materialUpdates });

    // 隐藏宿主下增加一个带可见位的子窗口，模拟动态壁纸重新创建绘制窗口。
    // 宿主始终隐藏，因此该测试窗口不会出现在真实桌面上。
    testSurface = new DesktopSurface();
    assert.ok(W.attachToDesktop(testSurface.hwnd, layers));
    testSurface.paint(nativeImage.createFromBitmap(Buffer.from([120, 120, 120, 255]), { width: 1, height: 1 }));
    testSurface.show();
    assert.equal(testSurface.isVisible(), false);
    assert.equal(W.desktopOrderIntact(w1.hwnd, layers), false);
    hookCallback('desktop-child-shown');
    await until(() => W.desktopOrderIntact(w1.hwnd, layers), '动态壁纸顺序改变后恢复');
    assert.equal(w1.metrics.orderRepairs, before.orderRepairs + 1);
    assert.equal(w1.metrics.attachments, before.attachments);
    hookCallback('desktop-child-shown');
    await wait(300);
    assert.equal(w1.metrics.orderRepairs, before.orderRepairs + 1);
    testSurface.destroy(); testSurface = null;
    note('壁纸绘制窗口变化', '只修复一次自己的顺序；不重新挂靠、不移动其他窗口');

    // 仅改变测试挂件自己的父窗口，模拟桌面关系丢失；恢复必须只发生一次。
    assert.ok(W.detachFromDesktop(w1.hwnd));
    w1.checkHealth();
    await until(() => W.isDesktopChild(w1.hwnd, layers), '丢失父窗口关系后恢复');
    assert.equal(w1.metrics.attachments, before.attachments + 1);
    note('关系丢失后恢复', { recoveries: w1.metrics.recoveries, attachments: w1.metrics.attachments });

    assert.ok(w1.setPinned(false).ok);
    assert.ok(!(W.styleOf(w1.hwnd) & 0x40000000));
    assert.equal(W.ownerOf(w1.hwnd), 0);
    assert.ok(Number(require('koffi').load('user32.dll').func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)')(w1.hwnd, -20)) & 8);
    assert.ok(w1.setPinned(true).ok);
    assert.ok(W.isDesktopChild(w1.hwnd, layers));
    note('解锁与重新钉住', '恢复普通可摆放窗口，再恢复桌面子窗口；隐藏状态保持不变');

    failSave = true;
    const savedPinned = store.settings.w1.pinned;
    assert.equal(w1.setPinned(false).ok, false);
    assert.equal(store.settings.w1.pinned, savedPinned);
    assert.ok(w1.pinned && W.isDesktopChild(w1.hwnd, layers));
    failSave = false;
    assert.ok(w1.setPinned(false).ok);
    missingHost = true;
    assert.equal(w1.setPinned(true).ok, false);
    assert.equal(store.settings.w1.pinned, false);
    assert.equal(w1.pinned, false);
    assert.equal(w1.embedded, false);
    assert.ok(W.exStyleOf(w1.hwnd) & 8);
    assert.equal(w1.recoverTimer, null);
    missingHost = false;
    assert.ok(w1.setPinned(true).ok);
    note('失败时的状态', '保存失败恢复原状态；找不到桌面时返回失败并保持可摆放状态，不假报钉住成功');

    const oldSurface = w1.surface, oldHost = layers.host;
    const replacement = host();
    layers = { ...layers, host: replacement, wallpaper: replacement };
    owned.find(win => !win.isDestroyed() && W.hwndOf(win) === oldHost).destroy();
    await until(() => w1.surface && w1.surface !== oldSurface && w1.ready && W.isDesktopChild(w1.hwnd, layers), '桌面宿主销毁后重建', 6000);
    assert.equal(w1.win.isVisible(), false);
    note('宿主销毁后重建', { parent: W.parentOf(w1.hwnd), replacement, visible: w1.win.isVisible() });
    note('材质状态', w1.glass.status);
    assert.ok(w1.surface.metrics.frames > 0, '没有提交网页绘制帧');
    assert.equal(w1.surface.metrics.failures, 0, '原生帧提交失败');
    note('原生绘制帧', w1.surface.metrics);

    // 验证以“解锁”保存后下次启动，原生窗口仍使用保存的位置，而不是留在 (0,0)。
    assert.ok(w1.setPinned(false).ok);
    w1.destroy();
    w1 = new W1(store, { balloon: message => note('提示', message), onChange: broadcast, native, hidden: true });
    w1.create();
    await until(() => w1.ready && w1.size.h > 360 && w1.surface.metrics.frames > 0, '解锁状态重新启动');
    assert.equal(w1.win.isVisible(), false);
    assert.equal(w1.surface.isVisible(), false);
    assert.equal(w1.embedded, false);
    assert.ok(W.exStyleOf(w1.hwnd) & 8, '解锁启动未保持可摆放层级');
    const restored = W.windowRect(w1.hwnd), saved = screen.dipToScreenRect(null, w1.bounds());
    assert.equal(restored.left, saved.x); assert.equal(restored.top, saved.y);
    note('解锁状态重新启动', { x: restored.left, y: restored.top, hidden: !w1.surface.isVisible() });
    note('范围限制', '仅验证自有隐藏宿主与页面；真实图标遮挡、显示桌面、磨砂画面没有在这轮检查中验证');
  } catch (error) {
    failed = true;
    note('失败', String(error.stack || error));
    note('显示诊断', { bounds: w1?.pos && w1.bounds(), frame: w1?.lastFrame?.getSize(),
      representations: w1?.lastFrame?.getScaleFactors(), bitmapBytes: w1?.lastFrame?.toBitmap().length,
      scale: w1?.surface?.scale, expectedSize: w1?.surface?.expectedSize, draw: w1?.surface?.metrics,
      lastError: w1?.surface?.lastError, rect: w1?.hwnd && W.windowRect(w1.hwnd) });
  }
  finally { finish(failed ? 1 : 0); }
}

module.exports = { run };
