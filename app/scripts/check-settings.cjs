// 隐藏的两个日历 + 独立设置窗口；不显示窗口、不操作系统鼠标、不读取真实数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { DEFAULT_SETTINGS } = require('../main/store');
const { SettingsWindow } = require('../main/settings-window');
const { applyAppearancePreview } = require('../main/appearance-preview');
const A = require('../renderer/shared/appearance');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.data-selftest', 'shots');
app.setPath('userData', path.join(root, '.data-selftest', 'settings-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], layouts = [], errors = [], previews = [], actions = [];
const state = {
  today: '2026-10-22', settings: structuredClone(DEFAULT_SETTINGS),
  reminders: [{ id: 'r', taskId: 'a', kind: 'endBefore', day: '2026-10-22', confirmed: false }],
  tasks: [{ id: 'a', title: '整理项目方案', startDate: '2026-10-19', endDate: '2026-10-23', color: '#A7D7C7', note: '第一版整理', pinned: true, done: false }],
  w1: { pinned: true, embedded: true, degraded: false, glass: { available: false } },
};
let mainWin, widgetWin, settings, done = false, failSave = false, settingsHeld = false, pageBlocked = false;
function merge(a, b) {
  for (const [key, value] of Object.entries(b)) {
    if (value && typeof value === 'object' && a[key]) merge(a[key], value);
    else a[key] = value;
  }
}
function finish(error) {
  if (done) return;
  done = true;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'w2-settings-result.json'), JSON.stringify({
    passed: !error, visibleWindows: 0, osMouseInput: false, realDataAccess: false,
    checks, layouts, errors, error: error ? String(error.stack || error) : null,
  }, null, 2));
  if (error) console.error(error); else console.log('Settings window: ' + checks.length + ' checks passed.');
  settings?.close(); mainWin?.destroy(); widgetWin?.destroy(); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Hidden settings check timed out')), 45000).unref();
app.whenReady().then(async () => {
  const push = () => { mainWin.webContents.send('state', state); widgetWin.webContents.send('state', state); settings?.send('state', state); };
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('settings:save', (_event, patch) => {
    if (failSave) return { ok: false };
    merge(state.settings, patch); push(); return { ok: true };
  });
  ipcMain.handle('w1:pin', (_event, pinned) => { actions.push(['pin', pinned]); state.w1.pinned = pinned; push(); return { ok: true }; });
  ipcMain.handle('w1:reset', () => { actions.push(['reset']); return { ok: true }; });
  ipcMain.handle('autostart:set', (_event, on) => { actions.push(['autostart', on]); state.settings.general.autoStart = on; push(); return { ok: true }; });
  ipcMain.on('w2:block', (_event, value) => { pageBlocked = value; });
  ipcMain.on('w2:ready', () => mainWin.webContents.send('w2:layout', { maxHeight: 720 }));
  ipcMain.on('w2:height', (_event, height) => mainWin.setContentSize(480, Math.max(160, Math.min(Math.ceil(height), 720))));
  mainWin = new BrowserWindow({ x: 120, y: 0, width: 480, height: 520, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'preload', 'preload.js'), offscreen: true, backgroundThrottling: false } });
  widgetWin = new BrowserWindow({ width: 640, height: 720, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'preload', 'preload.js'), offscreen: true, backgroundThrottling: false } });
  ipcMain.on('w1:ready', () => widgetWin.webContents.send('w1:info', { loose: false, embedded: true, margin: 8 }));
  const panel = {
    win: mainWin,
    setSettingsOpen(value) { settingsHeld = value; mainWin.webContents.send('settings:visibility', value); },
    send(channel, data) { mainWin.webContents.send(channel, data); },
    show() { throw new Error('Hidden check must not show the main panel'); },
  };
  const widget = { previewAppearance(value) { previews.push(value); widgetWin.webContents.send('w1:preview', value); } };
  const preview = value => applyAppearancePreview(widget, panel, value);
  settings = new SettingsWindow(panel, { hidden: true, onClose: () => preview(null) });
  ipcMain.on('appearance:preview', (event, value) => { if (settings.owns(event.sender)) preview(value); });
  ipcMain.handle('settings:open', () => settings.open());
  ipcMain.on('settings:ready', event => settings.markReady(event.sender));
  ipcMain.on('settings:close', event => {
    if (settings.owns(event.sender) || event.sender === mainWin.webContents) settings.close();
  });
  const listen = win => {
    win.on('show', () => finish(new Error('A test window was shown')));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push((win === mainWin ? '主面板: ' : win === widgetWin ? '桌面日历: ' : '设置: ') + event.message); });
  };
  listen(mainWin);
  listen(widgetWin);
  await widgetWin.loadFile(path.join(root, 'renderer', 'w1', 'index.html'));
  await mainWin.loadFile(path.join(root, 'renderer', 'w2', 'index.html'));
  const mainJs = code => mainWin.webContents.executeJavaScript(code);
  const js = code => settings.win.webContents.executeJavaScript(code);
  const widgetJs = code => widgetWin.webContents.executeJavaScript(code);
  await mainJs('document.fonts.ready.then(() => true)'); await wait(150);
  const baseBounds = mainWin.getBounds();
  const open = async () => {
    await mainJs("document.getElementById('settingsBtn').click()");
    for (let n = 0; n < 100 && !settings.ready; n++) await wait(20);
    assert.ok(settings.ready && settings.win, '独立设置窗口应完成加载');
    listen(settings.win); await wait(200);
  };
  const click = async id => { await js('document.getElementById(' + JSON.stringify(id) + ').click()'); await wait(210); };
  const change = async (id, value, property = 'value') => {
    await js('(() => { const el = document.getElementById(' + JSON.stringify(id) + '); el[' + JSON.stringify(property) + '] = ' + JSON.stringify(value) + '; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await wait(90);
  };
  const inputOnly = async (id, value) => {
    await js('(() => { const el = document.getElementById(' + JSON.stringify(id) + '); el.value = ' + JSON.stringify(value) + '; el.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await wait(90);
  };
  const calendarLook = win => win.webContents.executeJavaScript('(' + (() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const day = style('.cal-dc:not(.out):not(.today):nth-child(-n+5)');
    const bar = style('.cal-bar');
    return { dateSize: day.fontSize, textColor: day.color, barSize: bar.fontSize, barHeight: bar.height,
      weekend: style('.cal-dc:not(.out):nth-child(6)').color,
      weekendHeading: style('.cal-wd span:nth-child(6)').color,
      weekendOutside: style('.cal-dc.out:nth-child(n+6)').color,
      today: style('.today .date-number').color, todayFill: style('.today .date-number').backgroundColor };
  }).toString() + ')()');
  const sameAppearance = async expected => {
    const [main, desktop] = await Promise.all([calendarLook(mainWin), calendarLook(widgetWin)]);
    for (const value of [main, desktop]) {
      for (const [key, expectedValue] of Object.entries(expected)) assert.equal(value[key], expectedValue, key + ': ' + JSON.stringify(value));
    }
  };
  const geometry = () => js('(' + (() => {
    const sheet = document.querySelector('.settings-sheet'), scroll = document.querySelector('.settings-scroll');
    const r = sheet.getBoundingClientRect(), header = document.querySelector('.settings-header').getBoundingClientRect();
    const close = document.getElementById('stBack').getBoundingClientRect(), reset = document.getElementById('stReset').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, x: r.x, y: r.y, sheetWidth: r.width, sheetHeight: r.height,
      centered: Math.abs(r.x + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 1,
      overflow: scroll.scrollHeight - scroll.clientHeight, horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
      inside: r.left >= 19 && r.right <= innerWidth - 19 && r.top >= 23 && r.bottom <= innerHeight - 23,
      headerControlsVisible: close.top >= r.top && close.bottom <= header.bottom && reset.top >= r.top && reset.bottom <= header.bottom,
      sheetColor: getComputedStyle(sheet).backgroundColor, sheetBlur: getComputedStyle(sheet).backdropFilter,
      backdrop: getComputedStyle(document.getElementById('settings')).backgroundColor,
      backdropBlur: getComputedStyle(document.getElementById('settings')).backdropFilter,
      barControlsVisible: ['st_barFontSize', 'st_barHeight'].every(id => {
        const el = document.getElementById(id), b = el.getBoundingClientRect(), s = scroll.getBoundingClientRect();
        return el.getClientRects().length > 0 && b.top >= s.top && b.bottom <= s.bottom;
      }) };
  }).toString() + ')()');
  const capture = async name => {
    const r = await geometry(); fs.mkdirSync(output, { recursive: true });
    const rect = { x: Math.floor(r.x - 16), y: Math.floor(r.y - 16), width: Math.ceil(r.sheetWidth + 32), height: Math.ceil(r.sheetHeight + 32) };
    fs.writeFileSync(path.join(output, name + '.png'), (await settings.win.webContents.capturePage(rect)).toPNG());
  };
  const mouse = async (type, x, y, held = false) => {
    settings.win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: held ? ['leftbuttondown'] : [] });
    await wait(60);
  };
  await open();
  const oldAppearance = { panelColor: '#000000', textColor: '#FFFFFF', panelOpacity: 28, barHeight: 12 };
  const migrated = A.migrate(oldAppearance, 2);
  for (const [key, value] of Object.entries(oldAppearance)) assert.equal(migrated[key], value);
  assert.equal(migrated.weekendColor, A.DEFAULT.weekendColor); assert.equal(migrated.todayTone, 'mint');
  assert.equal(A.normalize({ weekendColor: 'bad', todayTone: 'bad' }).weekendColor, A.DEFAULT.weekendColor);
  assert.equal(A.normalize({ todayTone: 'bad' }).todayTone, 'mint');
  assert.equal(await js("document.getElementById('stPanelAppearance').textContent.includes('主界面 · 桌面共用')"), false);
  assert.deepEqual(settings.win.getBounds(), screen.getDisplayMatching(baseBounds).workArea);
  assert.deepEqual(mainWin.getBounds(), baseBounds);
  assert.equal(await mainJs("document.querySelector('.workspace').inert"), false);
  assert.equal(await mainJs("document.querySelector('#settings')"), null);
  let size = await geometry(); layouts.push(size);
  assert.ok(size.centered && size.inside, JSON.stringify(size));
  assert.equal(size.backdrop, 'rgba(0, 0, 0, 0)'); assert.equal(size.backdropBlur, 'none');
  assert.equal(size.sheetColor, 'rgb(255, 255, 255)'); assert.equal(size.sheetBlur, 'none');
  assert.equal(size.headerControlsVisible, true);
  assert.equal(await js("document.querySelector('.settings-footer')"), null);
  assert.equal(settingsHeld, true); assert.equal(pageBlocked, false);
  assert.equal(await js("document.activeElement === document.querySelector('.settings-sheet')"), true);
  await capture('w2-settings-centered');
  const originalWindow = settings.win;
  settings.open(); await wait(80); assert.equal(settings.win, originalWindow);
  checks.push('设置在主面板所在屏幕居中，只开一个窗口；外侧透明，主面板尺寸与显示不受影响');
  const dragHeader = async (dx, dy) => {
    const r = await geometry(), x = r.x + 60, y = r.y + 22;
    await mouse('mouseMove', x, y); await mouse('mouseDown', x, y, true);
    await mouse('mouseMove', x + dx, y + dy, true); await mouse('mouseUp', x + dx, y + dy);
    await wait(80);
  };
  await dragHeader(80, 60);
  let dragged = await geometry();
  assert.ok(Math.abs(dragged.x - size.x - 80) < 1 && Math.abs(dragged.y - size.y - 60) < 1, JSON.stringify(dragged));
  assert.equal(settingsHeld, true); assert.deepEqual(mainWin.getBounds(), baseBounds);
  await click('stTabReminder'); await click('stTabAppearance');
  assert.equal((await geometry()).x, dragged.x); assert.equal((await geometry()).y, dragged.y);
  const resetPoint = await js("(() => { const r = document.getElementById('stReset').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await mouse('mouseDown', resetPoint.x, resetPoint.y, true);
  await mouse('mouseMove', resetPoint.x + 6, resetPoint.y + 3, true); await mouse('mouseUp', resetPoint.x + 6, resetPoint.y + 3);
  assert.equal((await geometry()).x, dragged.x); assert.equal((await geometry()).y, dragged.y);
  await capture('w2-settings-dragged');
  checks.push('不透明设置卡片可由标题区拖动，切换分类保持位置；标题按钮不触发拖动');
  await dragHeader(1 - (dragged.x + 60), 1 - (dragged.y + 22));
  dragged = await geometry(); assert.equal(dragged.x, 20); assert.equal(dragged.y, 24);
  await dragHeader(dragged.width - 1 - (dragged.x + 60), dragged.height - 1 - (dragged.y + 22));
  dragged = await geometry(); assert.ok(dragged.inside);
  assert.equal(dragged.x + dragged.sheetWidth, dragged.width - 20);
  assert.equal(dragged.y + dragged.sheetHeight, dragged.height - 24);
  settings.win.setContentSize(380, 520); await wait(180);
  assert.ok((await geometry()).inside, '拖动后缩小可用屏幕也不能丢失标题');
  await click('stBack'); await open(); assert.equal((await geometry()).centered, true);
  checks.push('拖到屏幕边缘会保留可见边距；缩小可用范围保持可见，新打开恢复居中');
  for (const width of [480, 380]) {
    settings.win.setContentSize(width, 720); await wait(180);
    size = await geometry(); layouts.push(size);
    assert.ok(size.centered && size.inside && size.headerControlsVisible && size.barControlsVisible, JSON.stringify(size));
    assert.equal(size.horizontalOverflow, 0); assert.ok(size.overflow <= 1);
    await capture('w2-settings-' + width);
    checks.push(width + 'px 可用宽度下日程条设置直接显示、内容不滚动');
  }
  settings.win.setContentSize(480, 720); await wait(80);
  await click('stTabReminder'); await capture('w2-settings-reminders');
  await change('gSBd', 3); await click('gEB'); await change('gEBd', 5); await click('gSD');
  assert.deepEqual(state.settings.reminder, { startBefore: { on: true, days: 3 }, startDay: false, endBefore: { on: true, days: 5 }, endDay: true });
  await click('gSB'); assert.equal(await js("document.getElementById('gSBd').disabled"), true);
  await click('gSB'); await change('gSBd', 999); assert.equal(state.settings.reminder.startBefore.days, 365);
  checks.push('提醒自动保存，越界输入修正、禁用状态正确');
  await click('stTabGeneral'); await capture('w2-settings-general');
  await click('stPin'); await click('stResetPos'); await click('stAuto');
  assert.deepEqual(actions, [['pin', false], ['reset'], ['autostart', true]]);
  checks.push('桌面摆放与开机自启保留原接口（均模拟）');
  await click('stTabAppearance');
  const savedAppearance = structuredClone(state.settings.w1.appearance);
  const originalLooks = await Promise.all([calendarLook(mainWin), calendarLook(widgetWin)]);
  await mainJs("W2App.select('a'); window.previewBar = document.querySelector('.cal-bar')");
  await wait(280);
  await inputOnly('st_dateFontSize', 22); await inputOnly('st_textColor', '#726083');
  await inputOnly('st_weekendColor', '#5479b8');
  assert.equal(await mainJs("window.previewBar === document.querySelector('.cal-bar')"), true);
  await inputOnly('st_barFontSize', 12); await inputOnly('st_barHeight', 18);
  await sameAppearance({ dateSize: '22px', textColor: 'rgb(114, 96, 131)', barSize: '12px', barHeight: '18px',
    weekend: 'rgb(84, 121, 184)', weekendHeading: 'rgb(84, 121, 184)', weekendOutside: 'rgba(84, 121, 184, 0.55)' });
  assert.deepEqual(state.settings.w1.appearance, savedAppearance, '拖动过程预览不能提前写入设置');
  assert.equal(await mainJs("W2App.App.selectedId === 'a' && document.querySelector('.cal-bar.sel') != null && document.getElementById('detailSection').classList.contains('show')"), true);
  assert.equal(await mainJs("getComputedStyle(document.getElementById('appShell')).backgroundColor"), 'rgb(255, 255, 255)');
  const previewLooks = await Promise.all([calendarLook(mainWin), calendarLook(widgetWin)]);
  assert.equal(previewLooks[0].today, originalLooks[0].today);
  assert.equal(previewLooks[1].today, previewLooks[1].textColor);
  assert.equal(previewLooks[1].todayFill, 'rgba(0, 0, 0, 0)');
  assert.equal(settingsHeld, true);
  await capture('w2-settings-shared-preview');
  fs.writeFileSync(path.join(output, 'w2-main-live-preview.png'), (await mainWin.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'w1-live-preview.png'), (await widgetWin.webContents.capturePage()).toPNG());
  await click('stBack');
  assert.deepEqual(await Promise.all([calendarLook(mainWin), calendarLook(widgetWin)]), originalLooks);
  await mainJs('W2App.select(null)'); await wait(280); await open();
  checks.push('共用外观与周末颜色实时作用于两个日历的日期、表头和跨月日期；保留选中、详情及白底，关闭未提交预览恢复保存值');
  const rgb = hex => 'rgb(' + [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(', ') + ')';
  const desktopToday = await calendarLook(widgetWin);
  for (const tone of A.TODAY_TONES) {
    await click('st_today_' + tone.id);
    const look = await calendarLook(mainWin);
    assert.equal(look.todayFill, rgb(tone.fill)); assert.equal(look.today, rgb(tone.ink));
    assert.equal(state.settings.w1.appearance.todayTone, tone.id);
    assert.deepEqual(await calendarLook(widgetWin), desktopToday, '主面板配色不染色桌面玻璃圆');
  }
  await js("document.getElementById('st_today_apricot').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))");
  await wait(100);
  assert.equal(await js('document.activeElement.id'), 'st_today_mint');
  assert.equal(state.settings.w1.appearance.todayTone, 'mint');
  await click('st_today_violet');
  await mainJs("document.querySelector('.cal-dc.today').classList.add('hov')");
  assert.equal((await calendarLook(mainWin)).todayFill, rgb(A.todayTone('violet').fill));
  await mainJs("document.querySelector('.cal-dc.today').classList.remove('hov')");
  checks.push('当天五种配色可点选和键盘切换，悬停仍保留配色；桌面当天保持无色透明玻璃');
  const ap = { panelOpacity: 26, width: 500, dateFontSize: 19, barFontSize: 11, barHeight: 16, blur: 23, panelColor: '#e9f6ef', textColor: '#466278', weekendColor: '#8764bf' };
  for (const [key, value] of Object.entries(ap)) await change('st_' + key, value);
  for (const [key, value] of Object.entries(ap)) assert.equal(state.settings.w1.appearance[key], typeof value === 'string' ? value.toUpperCase() : value);
  assert.ok(previews.some(value => value?.panelOpacity === 26 && value?.width === 500));
  await sameAppearance({ dateSize: '19px', textColor: 'rgb(70, 98, 120)', barSize: '11px', barHeight: '16px', weekend: 'rgb(135, 100, 191)' });
  assert.equal((await calendarLook(mainWin)).todayFill, rgb(A.todayTone('violet').fill));
  assert.equal((await calendarLook(widgetWin)).todayFill, 'rgba(0, 0, 0, 0)');
  const changedBounds = mainWin.getBounds();
  for (const key of ['x', 'y', 'width']) assert.equal(changedBounds[key], baseBounds[key]);
  assert.equal(changedBounds.height, await mainJs("Math.ceil(document.getElementById('appShell').getBoundingClientRect().height)"));
  await click('stBack'); assert.equal(settings.win, null); assert.equal(settingsHeld, false);
  await Promise.all([mainWin.loadFile(path.join(root, 'renderer', 'w2', 'index.html')), widgetWin.loadFile(path.join(root, 'renderer', 'w1', 'index.html'))]);
  await wait(180);
  await sameAppearance({ dateSize: '19px', textColor: 'rgb(70, 98, 120)', barSize: '11px', barHeight: '16px', weekend: 'rgb(135, 100, 191)' });
  assert.equal((await calendarLook(mainWin)).todayFill, rgb(A.todayTone('violet').fill));
  await open(); assert.equal(await js("document.getElementById('st_blur').value"), '23');
  await change('st_blur', 0); assert.equal(await js("document.getElementById('st_blur_out').textContent"), '关闭');
  assert.match(await js("document.getElementById('stGlassWarn').title"), /桌面磨砂尚未启用/);
  await change('st_blur', 40); assert.equal(state.settings.w1.appearance.blur, 40);
  checks.push('外观自动保存后两个日历重载仍一致，主面板高度随内容适配；透明度、底色、宽度和磨砂仍仅用于桌面');
  failSave = true; await change('st_width', 550);
  assert.equal(await js("document.getElementById('st_width').value"), '500');
  assert.match(await js("document.getElementById('toast').textContent"), /失败/);
  await change('st_barHeight', 18); await change('st_textColor', '#b36699');
  await change('st_weekendColor', '#5479b8'); await click('st_today_rose');
  await sameAppearance({ dateSize: '19px', textColor: 'rgb(70, 98, 120)', barSize: '11px', barHeight: '16px', weekend: 'rgb(135, 100, 191)' });
  assert.equal((await calendarLook(mainWin)).todayFill, rgb(A.todayTone('violet').fill));
  assert.equal(await js("document.querySelector('.today-tone[aria-checked=true]').dataset.tone"), 'violet');
  failSave = false; await click('stReset'); assert.deepEqual(state.settings.w1.appearance, { ...A.DEFAULT });
  await sameAppearance({ dateSize: '17px', textColor: 'rgb(49, 88, 115)', barSize: '10px', barHeight: '15px', weekend: 'rgb(138, 112, 214)' });
  assert.equal((await calendarLook(mainWin)).todayFill, rgb(A.todayTone('mint').fill));
  assert.equal((await calendarLook(widgetWin)).todayFill, 'rgba(0, 0, 0, 0)');
  checks.push('保存失败时两边共同回退；恢复默认同步生效并保留其他设置');
  await js("document.getElementById('stReset').focus(); document.getElementById('stReset').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'st_blur');
  await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'stReset');
  await js("document.getElementById('stTabAppearance').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'stTabReminder');
  checks.push('键盘焦点和分类切换正常');
  const p = await js("(() => { const r = document.getElementById('stHeading').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await mouse('mouseDown', p.x, p.y, true); await mouse('mouseUp', p.x, p.y); assert.ok(settings.win);
  await mouse('mouseDown', p.x, p.y, true); await mouse('mouseMove', 10, p.y, true); await mouse('mouseUp', 10, p.y); assert.ok(settings.win);
  await mouse('mouseDown', 10, p.y, true); await mouse('mouseUp', 10, p.y); await wait(200);
  assert.ok(settings.win); assert.equal(settingsHeld, true);
  assert.equal(await mainJs('TaskDialog.isOpen()'), false);
  checks.push('点击空白、内部点击及拖到外侧松手均保持设置打开，主面板继续展开且不误建日程');
  await open(); await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await wait(200);
  assert.equal(settings.win, null); assert.equal(settingsHeld, false);
  await open(); await js('Settings.close()'); settings.open(); await wait(220); assert.ok(settings.win);
  mainWin.webContents.send('w2:cmd', { type: 'new' }); await wait(220);
  assert.equal(settings.win, null); assert.equal(settingsHeld, false); assert.equal(await mainJs('TaskDialog.isOpen()'), true);
  assert.equal(pageBlocked, true);
  await mainJs("document.getElementById('dlgCancel').click()"); await wait(80); await open();
  mainWin.webContents.send('w2:cmd', { type: 'discard' }); await wait(180);
  assert.equal(settings.win, null); assert.equal(settingsHeld, false);
  checks.push('Esc、快速重开、托盘新建及主动隐藏正确关闭设置并释放独立锁，填写锁保留');
  await open(); settings.win.setContentSize(380, 320); await wait(180);
  const short = await geometry(); layouts.push(short);
  assert.ok(short.centered && short.inside && short.headerControlsVisible && short.overflow > 0, JSON.stringify(short));
  assert.equal(short.horizontalOverflow, 0); await capture('w2-settings-short');
  settings.updateDisplay(); await wait(80);
  assert.deepEqual(settings.win.getBounds(), screen.getDisplayMatching(baseBounds).workArea);
  checks.push('小屏只滚动内部，关闭入口可见；显示区域变化后重新居中');
  await inputOnly('st_dateFontSize', 22);
  await sameAppearance({ dateSize: '22px' });
  settings.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); await wait(80);
  assert.equal(settings.win, null); assert.equal(settingsHeld, false); assert.equal(previews.at(-1), null);
  await sameAppearance({ dateSize: '17px' });
  await open(); await click('stBack');
  assert.equal(await mainJs('Settings.isOpen()'), false);
  checks.push('设置进程异常退出也释放锁和预览，下次仍可打开');
  assert.equal(errors.length, 0, errors.join('\n'));
  finish();
}).catch(finish);
