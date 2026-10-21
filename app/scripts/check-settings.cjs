// 只检查隐藏的实际设置浮窗；模拟保存与桌面命令，不访问真实日程或系统设置。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DEFAULT_SETTINGS } = require('../main/store');
const A = require('../renderer/shared/appearance');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.data-selftest', 'shots');
app.setPath('userData', path.join(root, '.data-selftest', 'settings-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], layouts = [], errors = [], previews = [], actions = [];
const state = {
  today: '2026-10-21', settings: structuredClone(DEFAULT_SETTINGS), reminders: [],
  tasks: [
    { id: 'a', title: '整理项目方案', startDate: '2026-10-19', endDate: '2026-10-23', color: '#A7D7C7', note: '第一版整理', pinned: true, done: false },
    { id: 'b', title: '周末出游', startDate: '2026-10-24', endDate: '2026-10-25', color: '#F4D691', note: '', pinned: false, done: false },
  ],
  w1: { pinned: true, embedded: true, degraded: false, glass: { available: false } },
};
let win, done = false, limit = 720, failSave = false, blocked = false;
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
  if (error) console.error(error); else console.log(`Settings overlay: ${checks.length} checks passed.`);
  win?.destroy(); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Hidden settings check timed out')), 30000).unref();
app.whenReady().then(async () => {
  const push = () => win.webContents.send('state', state);
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('settings:save', (_event, patch) => {
    if (failSave) return { ok: false };
    merge(state.settings, patch); push(); return { ok: true };
  });
  ipcMain.handle('w1:pin', (_event, pinned) => { actions.push(['pin', pinned]); state.w1.pinned = pinned; push(); return { ok: true }; });
  ipcMain.handle('w1:reset', () => { actions.push(['reset']); return { ok: true }; });
  ipcMain.handle('autostart:set', (_event, on) => { actions.push(['autostart', on]); state.settings.general.autoStart = on; push(); return { ok: true }; });
  ipcMain.on('appearance:preview', (_event, value) => { previews.push(value); push(); });
  ipcMain.on('w2:block', (_event, value) => { blocked = value; });
  ipcMain.on('w2:ready', () => win.webContents.send('w2:layout', { maxHeight: limit }));
  ipcMain.on('w2:height', (_event, height) => {
    if (!win || win.isDestroyed()) return;
    win.setContentSize(win.getContentSize()[0], Math.max(160, Math.min(Math.ceil(height), limit)));
  });
  win = new BrowserWindow({ width: 480, height: 520, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'preload', 'preload.js'), offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(path.join(root, 'renderer', 'w2', 'index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  await js('document.fonts.ready.then(() => true)'); await wait(120);
  const click = async id => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await wait(210); };
  const open = () => click('settingsBtn');
  const change = async (id, value, property = 'value') => {
    await js(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el[${JSON.stringify(property)}] = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(90);
  };
  const layout = async (width, height) => {
    limit = height; win.setContentSize(width, Math.min(win.getContentSize()[1], limit));
    win.webContents.send('w2:layout', { maxHeight: limit }); await wait(180);
  };
  const geometry = () => js(`(() => {
    const sheet = document.querySelector('.settings-sheet'), scroll = document.querySelector('.settings-scroll');
    const r = sheet.getBoundingClientRect(), footer = document.querySelector('.settings-footer').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, sheetHeight: r.height, top: r.top,
      overflow: scroll.scrollHeight - scroll.clientHeight, horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
      inside: r.left >= 19 && r.right <= innerWidth - 19 && r.top >= 23 && r.bottom <= innerHeight - 23,
      footerVisible: footer.top >= r.top && footer.bottom <= r.bottom,
      inert: document.querySelector('.workspace').inert,
      blur: getComputedStyle(document.getElementById('settings')).backdropFilter,
      barControlsVisible: ['st_barFontSize', 'st_barHeight'].every(id => {
        const el = document.getElementById(id), b = el.getBoundingClientRect(), s = scroll.getBoundingClientRect();
        return el.getClientRects().length > 0 && b.top >= s.top && b.bottom <= s.bottom;
      }) };
  })()`);
  const capture = async name => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const mouse = async (type, x, y, held = false) => {
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: held ? ['leftbuttondown'] : [] });
    await wait(80);
  };
  for (const [width, height] of [[480, 720], [380, 720]]) {
    await layout(width, height); await open();
    const size = await geometry(); layouts.push(size);
    assert.ok(size.inside && size.footerVisible && size.inert, JSON.stringify(size));
    assert.equal(size.horizontalOverflow, 0); assert.ok(size.overflow <= 1, JSON.stringify(size));
    assert.equal(size.barControlsVisible, true, '日程条设置应直接完整显示');
    assert.ok(size.sheetHeight < 455, '所有外观展开后，不应比之前的折叠版更高');
    assert.match(size.blur, /blur/); assert.equal(blocked, true);
    await capture(`w2-settings-${width}`); await click('stBack');
    checks.push(`${width}px 宽：日程条设置直接完整显示，整体比原折叠版更矮，打开时阻止自动收起`);
  }
  await layout(480, 720); await open();
  await click('stTabReminder');
  await capture('w2-settings-reminders');
  await change('gSBd', 3); await click('gEB'); await change('gEBd', 5); await click('gSD');
  assert.deepEqual(state.settings.reminder, { startBefore: { on: true, days: 3 }, startDay: false, endBefore: { on: true, days: 5 }, endDay: true });
  await click('gSB'); assert.equal(await js("document.getElementById('gSBd').disabled"), true);
  await click('gSB'); await change('gSBd', 999); assert.equal(state.settings.reminder.startBefore.days, 365);
  checks.push('开始与结束提醒、提前天数保存正确，关闭时禁用天数，越界输入修正');
  await click('stTabGeneral'); await capture('w2-settings-general');
  await click('stPin'); await click('stResetPos'); await click('stAuto');
  assert.deepEqual(actions, [['pin', false], ['reset'], ['autostart', true]]);
  checks.push('钉住/解锁、重置位置、开机自启仍通过原有接口调用（接口已模拟）');
  await click('stTabAppearance');
  assert.equal(await js("document.getElementById('st_blur').type"), 'range');
  const ap = { panelOpacity: 26, width: 500, dateFontSize: 19, barFontSize: 11, barHeight: 16, blur: 23, panelColor: '#e9f6ef', textColor: '#466278' };
  for (const [key, value] of Object.entries(ap)) await change(`st_${key}`, value);
  for (const [key, value] of Object.entries(ap)) assert.equal(state.settings.w1.appearance[key], typeof value === 'string' ? value.toUpperCase() : value);
  assert.ok(previews.some(value => value?.panelOpacity === 26 && value?.width === 500));
  await click('stTabReminder'); await click('stTabAppearance');
  assert.equal(await js("document.getElementById('st_width').value"), '500');
  assert.equal(await js("document.getElementById('st_blur').value"), '23');
  checks.push('8 项外观可即时预览并保存，切换分类保留值');
  await click('stBack'); await open();
  assert.equal(await js("document.getElementById('st_blur').value"), '23', '磨砂数值不能跳回旧的三档');
  await change('st_blur', 0);
  assert.equal(await js("document.getElementById('st_blur_out').textContent"), '关闭');
  assert.match(await js("document.getElementById('stGlassWarn').title"), /桌面磨砂尚未启用/);
  await change('st_blur', 40);
  assert.equal(state.settings.w1.appearance.blur, 40);
  assert.equal(await js("document.getElementById('st_blur_out').textContent"), '40');
  checks.push('磨砂滑块保留任意 0–40 整数，重开不跳档；0 为关闭，40 为最大值');
  failSave = true; await change('st_width', 550);
  assert.equal(await js("document.getElementById('st_width').value"), '500');
  assert.match(await js("document.getElementById('toast').textContent"), /失败/);
  failSave = false; await click('stReset');
  assert.deepEqual(state.settings.w1.appearance, { ...A.DEFAULT });
  checks.push('保存失败还原界面并提示；恢复默认外观保留其他设置');
  await js("document.getElementById('stBack').focus(); document.getElementById('stBack').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'stReset');
  await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'stBack');
  await js("document.getElementById('stTabAppearance').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))");
  assert.equal(await js('document.activeElement.id'), 'stTabReminder');
  assert.equal(await js("document.getElementById('stPanelReminder').hidden"), false);
  checks.push('Tab 焦点保持在浮窗内；方向键可切换设置分类');
  const p = await js("(() => { const r = document.getElementById('stHeading').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await mouse('mouseMove', p.x, p.y); await mouse('mouseDown', p.x, p.y, true); await mouse('mouseUp', p.x, p.y);
  assert.equal(await js('Settings.isOpen()'), true);
  await mouse('mouseDown', p.x, p.y, true); await mouse('mouseMove', 10, p.y, true); await mouse('mouseUp', 10, p.y);
  assert.equal(await js('Settings.isOpen()'), true);
  await mouse('mouseDown', 10, p.y, true); await mouse('mouseUp', 10, p.y); await wait(180);
  assert.equal(await js('Settings.isOpen()'), false);
  assert.equal(await js('TaskDialog.isOpen()'), false);
  assert.equal(await js("document.querySelector('.workspace').inert"), false);
  assert.equal(blocked, false);
  checks.push('点击内部不关闭，内部拖到外侧松手不误关；点击外侧关闭且不穿透新建日程');
  await open(); await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await wait(200);
  assert.equal(await js('Settings.isOpen()'), false);
  await open(); await js('Settings.close(); Settings.open()'); await wait(220);
  assert.equal(await js('Settings.isOpen()'), true);
  win.webContents.send('w2:cmd', { type: 'new' }); await wait(220);
  assert.equal(await js('Settings.isOpen()'), false); assert.equal(await js('TaskDialog.isOpen()'), true);
  assert.equal(await js("document.querySelector('.workspace').inert"), false);
  await click('dlgCancel'); await open(); win.webContents.send('w2:cmd', { type: 'discard' }); await wait(160);
  assert.equal(await js('Settings.isOpen()'), false);
  checks.push('Esc、快速关闭重开、托盘新建和主动收起均正确清理浮窗与焦点');
  await layout(380, 320); await open();
  const short = await geometry(); layouts.push(short);
  assert.ok(short.inside && short.footerVisible, JSON.stringify(short)); assert.equal(short.horizontalOverflow, 0); assert.ok(short.overflow > 0);
  await capture('w2-settings-short');
  checks.push('屏幕空间不足时只滚动设置内容，关闭按钮与底栏持续可见');
  await click('stBack');
  assert.equal(errors.length, 0, errors.join('\n'));
  finish();
}).catch(finish);
