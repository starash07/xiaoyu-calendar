// 桌面挂件的短测：使用 --selftest 的独立数据，结束后自动关闭测试窗口。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');
const P = require('./paths');
const W = require('./win32');
const D = require('../renderer/shared/dates');
const A = require('../renderer/shared/appearance');
const { Store } = require('./store');
const getWindowLong = require('koffi').load('user32.dll').func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run({ store, w1, w2, broadcast }) {
  assert.ok(P.SELFTEST && P.DATA.endsWith('.data-selftest'), '短测只能使用独立数据');
  const started = Date.now(), log = [];
  const note = (name, value) => { log.push({ name, value }); require('./selftest-runtime').log('[desktop-smoke]', name, JSON.stringify(value)); };
  const js = (win, code) => win.webContents.executeJavaScript(code);
  const nativeBounds = () => {
    const r = W.windowRect(w1.hwnd), scale = w1.surface.scale;
    return { x: r.left / scale, y: r.top / scale, width: (r.right - r.left) / scale, height: (r.bottom - r.top) / scale };
  };
  const saveResult = () => fs.writeFileSync(path.join(P.SHOTS, 'w1-smoke-result.json'), JSON.stringify({ elapsedMs: Date.now() - started, log }, null, 2));
  fs.mkdirSync(P.SHOTS, { recursive: true });
  const watchdog = setTimeout(() => {
    note('失败', '短测超过 45 秒，已停止'); saveResult(); w1.destroy(); w2.destroy(); app.exit(1);
  }, 45000);
  let failed = false;
  try {
    await wait(1600);
    clearInterval(w1.pollTimer);
    clearInterval(w2.pollTimer);
    const wa = screen.getPrimaryDisplay().workArea;
    assert.ok(store.saveSettings({ w1: { appearance: A.DEFAULT } }).ok);
    assert.ok(w1.setPinned(false).ok);
    w1.pos = { x: wa.x + Math.max(30, wa.width - 480), y: wa.y + 35 };
    w1.place(); w1.sendInfo();
    w2.setBounds({ x: wa.x + 30, y: wa.y + 35, width: 480, height: 640 });
    const today = D.today(), createdAt = new Date().toISOString();
    const task = (id, title, start, end, color, done = false) => ({
      id, title, startDate: D.addDays(today, start), endDate: D.addDays(today, end), color, done,
      note: '独立测试数据。\n详情应在下面展开，窗口顶边保持原位。', pinned: false, remind: null, createdAt, updatedAt: createdAt,
    });
    store.tasks = [task('smoke-main', '整理本周计划', -1, 2, '#A7D7C7'),
      task('smoke-other', '设计整理', 0, 1, '#B7DCEF'), task('smoke-day', '出门走走', 0, 0, '#F4D691'),
      task('smoke-done', '已经完成', 0, 0, '#D0C8E9', true)];
    store.reminders = { lastRefreshDate: today, items: [{ id: 'smoke-reminder', taskId: 'smoke-main', kind: 'startDay', day: today, confirmed: false }] };
    broadcast();
    await wait(450);
    const snapshot = () => js(w1.win, `(() => {
      const panel = document.getElementById('panel'), tint = document.getElementById('tint');
      const cal = document.getElementById('cal'), box = document.getElementById('details'), rect = panel.getBoundingClientRect();
      return { width: rect.width, height: rect.height, calendarTop: cal.getBoundingClientRect().top,
        font: getComputedStyle(document.querySelector('.cal-dc')).fontSize,
        barFont: getComputedStyle(document.querySelector('.cal-bar')).fontSize,
        tint: getComputedStyle(tint).backgroundColor,
        text: getComputedStyle(panel).color, weekend: getComputedStyle(document.querySelector('.cal-wd span:nth-child(6)')).color,
        todayFill: getComputedStyle(document.querySelector('.cal-dc.today .date-number')).backgroundColor,
        barText: getComputedStyle(document.querySelector('.cal-bar')).color,
        detail: box.classList.contains('show'), flag: !document.getElementById('flag').hidden,
        ids: [...new Set([...document.querySelectorAll('.cal-bar')].map(b => b.dataset.id))],
        wallpaper: !!document.getElementById('bg') || [...document.querySelectorAll('*')].some(el => getComputedStyle(el).backgroundImage.includes('url(')) };
    })()`);
    const base = await snapshot(), nativeBase = nativeBounds();
    assert.deepEqual(base.ids.sort(), ['smoke-day', 'smoke-main', 'smoke-other']);
    assert.equal(base.font, '17px'); assert.equal(base.width, 420); assert.equal(base.flag, true);
    assert.equal(base.weekend, 'rgb(138, 112, 214)'); assert.equal(base.todayFill, 'rgb(197, 229, 216)');
    assert.equal(base.barText, 'rgb(52, 86, 98)');
    assert.equal(base.wallpaper, false, '桌面页面又铺上了壁纸图片');
    assert.deepEqual(w1.glass.status, {mode: 'none', available: false, reason: 'desktop-surface'});
    assert.ok(w1.surface.metrics.frames > 0, '没有提交原生显示帧');
    note('启动与选定外观', { width: base.width, dateFont: base.font, wallpaperImageRemoved: !base.wallpaper, nativeGlass: w1.glass.status, visibleTasks: base.ids.length });
    note('真实磨砂', '当前显示方式尚未接入，本轮不验证磨砂，也不把它记为通过');

    const cursor = await js(w1.win, `(() => { const r = document.querySelector('.cal-bar[data-id="smoke-main"]').getBoundingClientRect(); return { x: r.left + 8, y: r.top + r.height / 2 }; })()`);
    w1.send('w1:cursor', cursor);
    const opening = [];
    for (let i = 0; i < 12; i++) { await wait(30); opening.push(nativeBounds().height); }
    const expanded = await snapshot(), nativeExpanded = nativeBounds();
    assert.ok(expanded.detail && nativeExpanded.height > nativeBase.height + 30, '悬停未撑开真实窗口');
    assert.equal(nativeExpanded.y, nativeBase.y, '展开改变了窗口顶边');
    assert.equal(expanded.calendarTop, base.calendarTop, '展开挤动了日历');
    assert.ok(opening.some(h => h > nativeBase.height && h < nativeExpanded.height), '展开没有中间帧');
    assert.ok(Math.abs(nativeExpanded.height - Math.ceil(expanded.height + 16)) <= 1, '内容和真实窗口高度不一致');
    fs.writeFileSync(path.join(P.SHOTS, 'w1-smoke-hover.png'), (await w1.win.webContents.capturePage()).toPNG());
    w1.send('w1:cursor', { x: -1, y: -1 });
    const closing = [];
    for (let i = 0; i < 12; i++) { await wait(30); closing.push(nativeBounds().height); }
    assert.equal(nativeBounds().height, nativeBase.height, '移开后没有恢复原高度');
    assert.ok(closing.some(h => h > nativeBase.height && h < nativeExpanded.height), '收起没有中间帧');
    note('悬停与真实窗口缓动', { base: nativeBase.height, expanded: nativeExpanded.height, restored: nativeBounds().height, opening, closing });

    w2.show();
    await js(w2.win, 'Settings.open()');
    const checks = [
      ['panelOpacity', 32, s => assert.equal(s.tint, 'rgba(255, 255, 255, 0.32)')],
      ['width', 460, s => { assert.equal(s.width, 460); assert.equal(w1.size.w, 476); }],
      ['dateFontSize', 20, s => { assert.equal(s.font, '20px'); assert.equal(s.barFont, '10px'); }],
      ['blur', 40, () => assert.deepEqual(w1.glass.status, {mode: 'none', available: false, reason: 'desktop-surface'})],
      ['panelColor', '#D7EEE5', s => assert.equal(s.tint, 'rgba(215, 238, 229, 0.32)')],
      ['textColor', '#21486B', s => assert.equal(s.text, 'rgb(33, 72, 107)')],
    ];
    for (const [key, value, check] of checks) {
      const before = store.settings.w1.appearance[key];
      await js(w2.win, `(() => { const el = document.getElementById('st_${key}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await wait(240);
      check(await snapshot());
      assert.equal(store.settings.w1.appearance[key], before, `${key} 在预览阶段提前保存`);
      await js(w2.win, `document.getElementById('st_${key}').dispatchEvent(new Event('change', { bubbles: true }))`);
      await wait(120);
      assert.equal(store.settings.w1.appearance[key], value, `${key} 没有保存`);
    }
    const persisted = new Store();
    for (const [key, value] of checks) assert.equal(persisted.settings.w1.appearance[key], value, `${key} 重新读取后丢失`);
    note('六项设置', '磨砂只验证设置保留，其余外观验证预览和保存；日期字号不影响条目文字');
    await js(w2.win, `document.getElementById('stReset').click()`);
    await wait(300);
    assert.deepEqual(store.settings.w1.appearance, A.DEFAULT);
    const reset = await snapshot(); assert.equal(reset.font, '17px'); assert.equal(reset.width, 420);
    await js(w2.win, 'Settings.close()');
    note('恢复默认', '通过');

    assert.ok(store.confirmReminder('smoke-reminder').ok);
    await wait(120);
    assert.equal((await snapshot()).flag, false, '确认提醒后标志没有消失');
    assert.ok(store.updateTask('smoke-main', { done: true }).ok);
    await wait(200);
    const after = await snapshot();
    assert.ok(!after.ids.includes('smoke-main'));
    note('提醒确认与完成同步', '确认后提醒标志消失，已完成条目从桌面隐藏');

    w1.pos = { x: w1.pos.x - 50, y: w1.pos.y + 12 }; w1.place(); w1.sendInfo();
    await wait(200);
    assert.equal((await snapshot()).wallpaper, false);
    assert.ok(w1.setPinned(true).ok);
    await wait(350);
    assert.ok(w1.embedded && !w1.degraded && W.ownerOf(w1.hwnd) === 0, '钉住时不应绑定桌面 owner');
    assert.ok(W.isDesktopChild(w1.hwnd, w1.desktopLayers), '挂件没有进入桌面容器');
    assert.ok(W.desktopOrderIntact(w1.hwnd, w1.desktopLayers), '桌面容器内的顺序不正确');
    assert.deepEqual(w1.glass.status, {mode: 'none', available: false, reason: 'desktop-surface'});
    // 模拟系统把挂件层级改变；不操作其他窗口、不触发全局显示桌面。
    W.sendToBottom(w1.hwnd);
    w1.checkHealth();
    await wait(400);
    assert.ok(W.desktopOrderIntact(w1.hwnd, w1.desktopLayers), '健康检查未恢复绘制顺序');
    assert.ok(w1.setPinned(false).ok);
    await wait(250);
    note('解锁状态', { embedded: w1.embedded, parent: W.parentOf(w1.hwnd), owner: W.ownerOf(w1.hwnd), desktopLayers: w1.desktopLayers, nativeHandle: W.hwndOf(w1.win), cachedHandle: w1.hwnd,
      alwaysOnTop: !!(W.exStyleOf(w1.hwnd) & 8), style: Number(getWindowLong(w1.hwnd, -16)).toString(16), exStyle: Number(getWindowLong(w1.hwnd, -20)).toString(16) });
    assert.ok(!w1.embedded && W.ownerOf(w1.hwnd) === 0, '解锁后未解除桌面挂靠');
    assert.ok(W.exStyleOf(w1.hwnd) & 8, '解锁后未恢复可摆放的置顶窗口');
    assert.deepEqual(w1.glass.status, {mode: 'none', available: false, reason: 'desktop-surface'});
    note('钉住与解锁', '桌面父子关系、顺序恢复与解锁通过；真实图标遮挡、全局显示桌面需另行实测');
    assert.equal(A.migrate({ panelColor: '#000000', panelOpacity: 28, textColor: '#FFFFFF', barHeight: 12 }, 1).dateFontSize, 17);
    assert.deepEqual(A.migrate({ panelColor: '#000000', panelOpacity: 28, textColor: '#FFFFFF', barHeight: 12 }, 1), A.DEFAULT);
    const custom = { ...A.DEFAULT, panelColor: '#B8E0D2', panelOpacity: 40, textColor: '#234567', width: 510 };
    assert.deepEqual(A.migrate(custom, 1), custom);
    note('旧设置兼容', '旧默认外观更新，自定义外观保留');
  } catch (error) { failed = true; note('失败', String(error.stack || error)); }
  finally {
    clearTimeout(watchdog); saveResult();
    if (failed) { w1.destroy(); w2.destroy(); app.exit(1); }
    else app.quit();
  }
}

module.exports = { run };
