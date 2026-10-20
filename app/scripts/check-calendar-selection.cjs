// Hidden renderer integration check: no OS mouse input, desktop changes, or real task data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DEFAULT_SETTINGS } = require('../main/store');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.data-selftest', 'shots', 'w2-selection-result.json');
app.setPath('userData', path.join(root, '.data-selftest', 'selection-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], errors = [], blocks = [], created = [];
const state = {
  today: '2026-10-20',
  settings: structuredClone(DEFAULT_SETTINGS),
  reminders: [],
  tasks: [{
    id: 'existing', title: '已有日程', startDate: '2026-10-12', endDate: '2026-10-16',
    color: '#A7D7C7', note: '用于检查已有日程的点击和跨越拖选。',
    done: false, pinned: false, remind: null, createdAt: '2026-10-01T00:00:00.000Z',
  }],
  w1: { pinned: false, embedded: false, degraded: false, glass: { available: false } },
};
let win, finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    passed: !error, visibleWindows: 0, osMouseInput: false, realDataAccess: false,
    results, errors, error: error ? String(error.stack || error) : null,
  }, null, 2));
  if (error) console.error(error);
  else console.log(`Calendar selection: ${results.length} checks passed.`);
  win?.destroy();
  app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Hidden selection test timed out')), 30000).unref();

app.whenReady().then(async () => {
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('task:create', (_event, task) => {
    const id = `created-${created.length}`;
    created.push(task);
    state.tasks.push({ ...task, id, done: false, createdAt: '2026-10-20T00:00:00.000Z' });
    win.webContents.send('state', state);
    return { ok: true, id };
  });
  ipcMain.on('w2:block', (_event, value) => blocks.push(value));
  ipcMain.on('w2:ready', () => win.webContents.send('w2:layout', { maxHeight: 900 }));
  win = new BrowserWindow({
    width: 480, height: 900, show: false,
    webPreferences: {
      preload: path.join(root, 'preload', 'preload.js'),
      offscreen: true, backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  await win.loadFile(path.join(root, 'renderer', 'w2', 'index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  await js('document.fonts.ready.then(() => true)');
  await wait(120);
  await js(`window.selectionTrace = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'contextmenu']) {
      document.addEventListener(type, e => {
        window.selectionTrace.push({ type, x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons,
          pointerId: e.pointerId, target: e.target.id || e.target.className, day: dayAt(e.clientX, e.clientY) });
        if (window.selectionTrace.length > 30) window.selectionTrace.shift();
      });
    }`);
  const point = selector => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing target: ' + ${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const date = value => point(`.cal-dc[data-date="${value}"]`);
  const mouse = async (type, p, button = 'left', modifiers = []) => {
    win.webContents.sendInputEvent({ type, ...p, button, clickCount: 1, modifiers });
    await wait(80);
  };
  const snapshot = () => js(`({
    open: TaskDialog.isOpen(),
    start: document.getElementById('dlgStart')?.value,
    end: document.getElementById('dlgEnd')?.value,
    selection: W2App.App.sel,
    previews: document.querySelectorAll('.cal-preview').length,
    selectedId: W2App.App.selectedId
  })`);
  const close = async () => {
    await js("document.getElementById('dlgCancel').click()");
    await wait(30);
    assert.equal(blocks.at(-1), false, '取消填写后仍阻止窗口收起');
  };
  const click = async selector => {
    const p = await point(selector);
    await mouse('mouseDown', p);
    await mouse('mouseUp', p);
  };
  const drag = async (a, b, via) => {
    const begin = await date(a), end = await date(b);
    const blockStart = blocks.length;
    await mouse('mouseDown', begin);
    assert.equal((await snapshot()).open, false, '按下时不应提前弹窗');
    assert.equal(blocks.at(-1), true, '拖选时必须阻止自动收起');
    if (via) await mouse('mouseMove', via, 'left', ['leftbuttondown']);
    await mouse('mouseMove', end, 'left', ['leftbuttondown']);
    const during = await snapshot();
    if (during.selection?.b !== b) console.error(JSON.stringify({ begin, end, during, trace: await js('window.selectionTrace') }, null, 2));
    assert.equal(during.selection.b, b);
    assert.ok(during.previews > 0, '拖选预览缺失');
    await mouse('mouseUp', end);
    const after = await snapshot(), [start, finish] = [a, b].sort();
    assert.equal(after.open, true);
    assert.equal(after.start, start);
    assert.equal(after.end, finish);
    assert.equal(after.selection, null);
    assert.equal(after.previews, 0);
    assert.ok(blocks.slice(blockStart).every(Boolean), '拖选到弹窗之间不应解除阻止收起');
  };

  await drag('2026-10-08', '2026-10-08');
  results.push('单击一天：松开后弹窗，开始和结束同一天');
  await close();

  await drag('2026-10-09', '2026-10-20', await point('.cal-bar[data-id="existing"]'));
  results.push('跨周正向拖选可越过已有日程条');
  await close();
  await drag('2026-10-25', '2026-10-10');
  results.push('反向拖选自动整理起止日期');
  await close();
  await drag('2026-09-28', '2026-10-02');
  results.push('首周补齐日期可跨月选择');
  await close();

  const begin = await date('2026-10-06'), end = await date('2026-10-09');
  await mouse('mouseDown', begin);
  await mouse('mouseMove', end, 'left', ['leftbuttondown']);
  await mouse('mouseMove', { x: 4, y: 4 }, 'left', ['leftbuttondown']);
  await mouse('mouseUp', { x: 4, y: 4 });
  assert.equal((await snapshot()).end, '2026-10-09');
  results.push('移出日历再松开，保留最后经过的日期');
  await close();

  for (const reason of ['Escape', 'contextmenu', 'pointercancel', 'lostpointercapture', 'blur']) {
    await mouse('mouseDown', begin);
    await mouse('mouseMove', end, 'left', ['leftbuttondown']);
    if (reason === 'Escape') {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    } else if (reason === 'contextmenu') {
      await mouse('mouseDown', end, 'right', ['leftbuttondown']);
      await mouse('mouseUp', end, 'right', ['leftbuttondown']);
    } else if (reason === 'lostpointercapture') {
      await js('calwrap.releasePointerCapture(datePointerId)');
    } else if (reason === 'blur') {
      await js("window.dispatchEvent(new Event('blur'))");
    } else {
      await js("calwrap.dispatchEvent(new PointerEvent('pointercancel', { pointerId: datePointerId }))");
    }
    await wait(30);
    await mouse('mouseUp', end);
    const cancelled = await snapshot();
    if (cancelled.open) console.error(JSON.stringify({ reason, cancelled, trace: await js('window.selectionTrace') }, null, 2));
    assert.equal(cancelled.open, false, `${reason} 后松开不应弹窗`);
    assert.equal(cancelled.selection, null, `${reason} 后选区未清除`);
    assert.equal(cancelled.previews, 0);
    assert.equal(blocks.at(-1), false);
    results.push(`${reason} 取消选择，不会在松开时误建日程`);
  }

  await click('.cal-bar[data-id="existing"]');
  assert.equal((await snapshot()).selectedId, 'existing');
  assert.equal((await snapshot()).open, false);
  results.push('点击已有日程保留详情行为，不打开新建');
  await click('#newBtn');
  assert.equal((await snapshot()).start, state.today);
  assert.equal((await snapshot()).end, state.today);
  results.push('底部按钮直接新建，当前月默认今天');
  await close();
  await click('#nextBtn');
  await click('#newBtn');
  assert.equal((await snapshot()).start, '2026-11-01');
  results.push('底部按钮在其他月份默认该月第一天');
  await close();
  await click('#prevBtn');

  await drag('2026-10-22', '2026-10-24');
  await js(`(() => {
    const title = document.getElementById('dlgTitle');
    title.value = '选区保存测试';
    title.dispatchEvent(new Event('input'));
    document.getElementById('dlgSave').click();
  })()`);
  await wait(80);
  assert.equal(created.length, 1);
  assert.equal(created[0].startDate, '2026-10-22');
  assert.equal(created[0].endDate, '2026-10-24');
  assert.equal((await snapshot()).open, false);
  assert.equal(await js('document.querySelectorAll(\'.cal-bar[data-id="created-0"]\').length'), 1);
  results.push('选区日期传入实际新建接口，保存后日历显示新条');
  assert.equal(win.isVisible(), false, '测试窗口不应显示');
  assert.deepEqual(errors, [], 'renderer 出现错误');
  finish();
}).catch(finish);
