// 只运行隐藏的实际 W2 页面：不控制系统鼠标，不访问用户日程。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DEFAULT_SETTINGS } = require('../main/store');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.data-selftest', 'shots');
app.setPath('userData', path.join(root, '.data-selftest', 'dialog-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], layouts = [], errors = [], created = [], updated = [];
const rules = { startBefore: { on: true, days: 3 }, startDay: false, endBefore: { on: true, days: 2 }, endDay: true };
const state = {
  today: '2026-10-20', settings: structuredClone(DEFAULT_SETTINGS), reminders: [],
  tasks: [{ id: 'edit-me', title: '编辑原有日程', startDate: '2026-10-21', endDate: '2026-10-24',
    color: '#AFA9EC', note: '原有备注\n第二行', pinned: true, done: false, remind: rules,
    createdAt: '2026-10-20T00:00:00.000Z' }],
  w1: { pinned: true, embedded: true, degraded: false, glass: { available: false } },
};
state.settings.recentColors = ['#123456', '#85B7EB', '#AFA9EC', '#ED93B1', '#F0997B', '#EF9F27', '#FAC775', '#97C459'];
let win, done = false, limit = 640, failSave = false;
function finish(error) {
  if (done) return;
  done = true;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'w2-dialog-result.json'), JSON.stringify({
    passed: !error, visibleWindows: 0, osMouseInput: false, realDataAccess: false,
    checks, layouts, errors, error: error ? String(error.stack || error) : null,
  }, null, 2));
  if (error) console.error(error);
  else console.log(`Task dialog: ${checks.length} checks passed.`);
  win?.destroy();
  app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Hidden dialog check timed out')), 30000).unref();

app.whenReady().then(async () => {
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('task:create', (_event, data) => {
    if (failSave) return { ok: false, error: 'Simulated save failure' };
    created.push(data);
    return { ok: true, id: 'new-task' };
  });
  ipcMain.handle('task:update', (_event, id, data) => {
    updated.push({ id, ...data });
    return { ok: true };
  });
  ipcMain.on('w2:ready', () => win.webContents.send('w2:layout', { maxHeight: limit }));
  ipcMain.on('w2:height', (_event, height) => {
    if (!win || win.isDestroyed()) return;
    win.setContentSize(win.getContentSize()[0], Math.max(160, Math.min(Math.ceil(height), limit)));
  });
  win = new BrowserWindow({
    width: 480, height: 520, frame: false, show: false,
    webPreferences: { preload: path.join(root, 'preload', 'preload.js'), offscreen: true, backgroundThrottling: false },
  });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(path.join(root, 'renderer', 'w2', 'index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  await js('document.fonts.ready.then(() => true)');
  await wait(100);
  const click = async id => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await wait(120); };
  const open = async () => { await click('newBtn'); };
  const geometry = () => js(`(() => {
    const form = document.querySelector('.dialog'), scroll = document.querySelector('.dialog-scroll');
    const r = form.getBoundingClientRect(), save = document.getElementById('dlgSave').getBoundingClientRect();
    const cancel = document.getElementById('dlgCancel').getBoundingClientRect();
    return {
      width: innerWidth, windowHeight: innerHeight, formHeight: r.height, requested: parseFloat(appShell.style.getPropertyValue('--dialog-height')),
      overflow: scroll.scrollHeight - scroll.clientHeight, horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
      inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
      buttonsVisible: save.top >= r.top && save.bottom <= innerHeight && cancel.top >= r.top && cancel.bottom <= innerHeight,
      panelsClosed: document.getElementById('dlgColorPanel').hidden && document.getElementById('dlgRemindPanel').hidden
    };
  })()`);
  const layout = async (width, maxHeight) => {
    limit = maxHeight;
    win.setContentSize(width, Math.min(win.getContentSize()[1], limit));
    win.webContents.send('w2:layout', { maxHeight: limit });
    await wait(200);
  };
  const capture = async name => {
    fs.mkdirSync(output, { recursive: true });
    const bitmap = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, `${name}.png`), bitmap.toPNG());
  };

  for (const [width, maxHeight] of [[480, 640], [380, 640], [380, 420]]) {
    await layout(width, maxHeight);
    await open();
    const size = await geometry();
    layouts.push(size);
    assert.equal(size.inside && size.buttonsVisible && size.panelsClosed, true);
    assert.ok(size.overflow <= 1, `默认表单仍需滚动：${JSON.stringify(size)}`);
    assert.equal(size.horizontalOverflow, 0);
    assert.ok(size.requested < 440, '默认弹窗不应再撑到旧的 640px');
    await capture(`w2-dialog-${width}-${maxHeight}`);
    checks.push(`${width}px 宽、${maxHeight}px 可用高度：默认表单完整可见，无滚动`);
    await click('dlgCancel');
  }

  await layout(480, 640);
  await open();
  await click('dlgSave');
  assert.equal(await js("document.getElementById('errTitle').hidden"), false);
  assert.equal(created.length, 0);
  checks.push('空标题仍阻止保存并显示校验提示');
  await js(`(() => {
    const el = document.getElementById('dlgTitle');
    el.value = '紧凑表单保存'; el.dispatchEvent(new Event('input'));
    document.getElementById('dlgNote').value = '第一行\\n第二行';
    document.getElementById('dlgPinned').checked = true;
  })()`);
  assert.equal(await js("document.getElementById('dlgNote').scrollHeight <= document.getElementById('dlgNote').clientHeight"), true, '两行备注应完整显示');
  await click('dlgColorToggle');
  await js(`document.querySelector('#dlgPresets [data-c="#AFA9EC"]').click()`);
  await click('dlgRemindToggle');
  assert.equal(await js("document.getElementById('dlgColorPanel').hidden"), true);
  await js(`(() => {
    document.querySelector('input[name="dlgRemind"][value="custom"]').click();
    document.getElementById('rSB').checked = true; document.getElementById('rSBd').value = 3;
    document.getElementById('rSD').checked = false;
    document.getElementById('rEB').checked = true; document.getElementById('rEBd').value = 2;
    document.getElementById('rED').checked = true;
    document.getElementById('rSBd').dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(150);
  await capture('w2-dialog-reminders');
  await click('dlgRemindToggle');
  await click('dlgSave');
  assert.deepEqual(created[0], {
    title: '紧凑表单保存', startDate: state.today, endDate: state.today, color: '#AFA9EC',
    note: '第一行\n第二行', pinned: true, remind: rules,
  });
  checks.push('颜色与提醒展开互斥，收起后仍完整保存颜色、四项提醒、备注和置顶');

  await js("TaskDialog.open({ mode: 'edit', task: W2App.App.state.tasks[0] })");
  await wait(120);
  assert.equal(await js("document.getElementById('dlgRemindLabel').textContent"), '提醒 · 单独');
  await click('dlgSave');
  assert.equal(updated[0].id, 'edit-me');
  assert.equal(updated[0].note, '原有备注\n第二行');
  assert.equal(updated[0].pinned, true);
  assert.deepEqual(updated[0].remind, rules);
  checks.push('编辑已有日程时，未展开的单独提醒与原有资料保持完整');

  await open();
  await js("document.getElementById('dlgTitle').value = '失败后重试'");
  failSave = true;
  await click('dlgSave');
  assert.equal(await js('TaskDialog.isOpen()'), true);
  assert.equal(await js("document.getElementById('errSave').hidden"), false);
  assert.equal((await geometry()).buttonsVisible, true);
  failSave = false;
  await click('dlgSave');
  assert.equal(created.at(-1).remind, null);
  assert.equal(await js('TaskDialog.isOpen()'), false);
  checks.push('统一提醒仍以 null 保存；保存失败保留输入，底部可重试');

  await layout(380, 320);
  await open();
  await click('dlgColorToggle');
  const small = await geometry();
  layouts.push(small);
  assert.equal(small.inside && small.buttonsVisible, true);
  assert.equal(small.horizontalOverflow, 0);
  assert.ok(small.overflow > 0, '极短窗口应允许滚动表单内容');
  await capture('w2-dialog-short');
  await click('dlgCancel');
  assert.equal(await js("appShell.style.getPropertyValue('--dialog-height')"), '');
  checks.push('极短窗口仅中间表单滚动，操作按钮可见；关闭后释放表单高度');
  assert.equal(win.isVisible(), false);
  assert.deepEqual(errors, []);
  finish();
}).catch(finish);
