// 真实 Electron 窗口的布局回归：不能只检查网页里有没有展开详情。
const assert = require('node:assert/strict');
const { screen } = require('electron');
const D = require('../renderer/shared/dates');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run({ store, w2, broadcast, note, shot }) {
  const win = w2.win;
  const js = code => win.webContents.executeJavaScript(code);
  const originalTasks = store.tasks, originalReminders = store.reminders;
  const display = screen.getPrimaryDisplay(), wa = display.workArea;
  const today = D.today();
  const task = (id, title, note, color) => ({ id, title, note, color, startDate: today,
    endDate: D.addDays(today, 2), done: false, pinned: false, remind: null,
    createdAt: `${today}T00:00:00.000Z`, updatedAt: `${today}T00:00:00.000Z` });
  const layout = () => js(`(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    return { shell: rect('appShell'), calendar: rect('cal'), detail: rect('detailSection'),
      buttons: document.querySelector('.bottom-bar').getBoundingClientRect().bottom,
      shown: document.getElementById('detailSection').classList.contains('show'),
      contentHeight: document.querySelector('.content').clientHeight,
      contentScroll: document.querySelector('.content').scrollHeight };
  })()`);
  const select = id => js(`W2App.select(${JSON.stringify(id)})`);
  const hover = id => js(`(() => {
    const bar = document.querySelector('.cal-bar[data-id="${id}"]'), r = bar.getBoundingClientRect();
    bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
  })()`);
  const leave = () => js(`document.getElementById('calwrap').dispatchEvent(new PointerEvent('pointerleave'))`);
  const sameHeight = (a, b) => assert.ok(Math.abs(a - b) <= 1, `高度不一致：${a} / ${b}`);

  // 避免真实鼠标的位置影响自动收起；以下用同一套原生收起/滑出方法验证。
  clearInterval(w2.pollTimer);
  try {
    await require('./w2-calendar-selftest').run({ store, w2, broadcast, note, shot });
    store.tasks = [
      task('layout-short', '新界面设计', '整理功能，画出主界面。\n详情跟随窗口底部展开。', '#B7DCEF'),
      task('layout-other', '周末出游', '带上相机和水。', '#F4D691'),
      task('layout-long', '一份比较长的日程备注', Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行：备注需要完整显示，可以滚动查看。`).join('\n'), '#B1DACA'),
    ];
    store.reminders = { ...originalReminders, items: store.tasks.map(t => ({
      id: `reminder-${t.id}`, taskId: t.id, kind: 'startDay', day: today, confirmed: false,
    })) };
    w2.dock = null;
    w2.collapsed = false;
    w2.setBounds({ x: wa.x + 100, y: wa.y + 60, width: 480, height: 640 });
    w2.show();
    broadcast();
    await js(`document.getElementById('todayBtn').click()`);
    await wait(400);
    const base = win.getBounds(), baseLayout = await layout();
    sameHeight(base.height, Math.ceil(baseLayout.shell.height));
    await shot(win, 'w2-auto-base');

    // 窗口四角必须透明，顶栏和页面背景都不能绘制到圆角外。
    const capture = await win.webContents.capturePage();
    const bitmap = capture.toBitmap(), size = capture.getSize();
    const alpha = (x, y) => bitmap[(y * size.width + x) * 4 + 3];
    const corners = [alpha(0, 0), alpha(size.width - 1, 0), alpha(0, size.height - 1), alpha(size.width - 1, size.height - 1)];
    assert.ok(corners.every(a => a === 0), `圆角外仍有底色：${corners}`);
    assert.equal(alpha(24, 24), 255);
    note('W2 四角透明度', corners);

    const settingsBefore = JSON.stringify(store.settings.w2);
    await hover('layout-short');
    await wait(65);
    const opening = win.getBounds().height;
    await wait(300);
    const expanded = win.getBounds(), expandedLayout = await layout();
    assert.ok(expanded.height > base.height + 50, '悬停没有撑开真实窗口');
    assert.ok(opening > base.height && opening < expanded.height, '展开缺少中间帧');
    assert.equal(expanded.y, base.y, '展开改变了窗口顶边');
    assert.equal(expanded.width, base.width);
    assert.deepEqual(expandedLayout.calendar, baseLayout.calendar, '详情挤压了日历');
    sameHeight(expanded.height, Math.ceil(expandedLayout.shell.height));
    assert.equal(JSON.stringify(store.settings.w2), settingsBefore, '动画写回了窗口设置');
    await shot(win, 'w2-auto-hover');
    await leave();
    await wait(65);
    const closing = win.getBounds().height;
    await wait(300);
    assert.ok(closing > base.height && closing < expanded.height, '收起缺少中间帧');
    sameHeight(win.getBounds().height, base.height);
    note('W2 悬停与移开实际高度', { base: base.height, opening, expanded: expanded.height, closing, restored: win.getBounds().height, top: base.y });

    await js(`document.querySelector('.cal-bar[data-id="layout-short"]').click()`);
    await leave();
    await wait(320);
    assert.equal((await layout()).shown, true, '点选后移开丢失详情');
    await js(`document.querySelector('.brand').click()`);
    await wait(320);
    sameHeight(win.getBounds().height, base.height);
    // 动画中快速更换悬停目标。
    await hover('layout-long');
    await wait(50);
    await leave();
    await wait(30);
    await hover('layout-other');
    await wait(350);
    assert.equal(await js(`document.querySelector('.detail-title').textContent`), '周末出游');
    sameHeight(win.getBounds().height, Math.ceil((await layout()).shell.height));
    await leave();
    await wait(300);

    await js(`document.querySelector('.rm-item.deck-0').click()`);
    await wait(400);
    const reminderHeight = win.getBounds().height;
    assert.ok(reminderHeight > base.height, '提醒展开未增加窗口高度');
    await js(`document.querySelector('.rm-item').click()`);
    await wait(400);
    sameHeight(win.getBounds().height, base.height);
    note('W2 提醒展开/收起', { base: base.height, expanded: reminderHeight, restored: win.getBounds().height });

    await js(`TaskDialog.open({ mode: 'new', start: W2App.App.state.today, end: W2App.App.state.today })`);
    await wait(350);
    const formHeight = await js(`Number.parseFloat(document.getElementById('appShell').style.getPropertyValue('--dialog-height'))`);
    assert.ok(win.getBounds().height >= Math.min(formHeight, w2.maxHeight), '新建弹窗没有按实际内容留出填写高度');
    await js('TaskDialog.close()');
    await wait(350);
    sameHeight(win.getBounds().height, base.height);

    // 空间不够时限制在工作区内，仅内容滚动，底部操作仍可见。
    w2.setBounds({ x: wa.x + 100, y: wa.y + wa.height - 430, width: 380 });
    w2.updateLayoutLimit(true);
    await select('layout-long');
    await wait(400);
    const limited = win.getBounds(), limitedLayout = await layout();
    assert.ok(limited.y + limited.height <= wa.y + wa.height, '窗口越过屏幕底部');
    assert.ok(limitedLayout.buttons <= limited.height && limitedLayout.detail.bottom <= limited.height, '底部内容不可见');
    assert.ok(limitedLayout.contentScroll > limitedLayout.contentHeight, '空间不足时日历没有滚动');
    const noteScroll = await js(`(() => {
      const section = document.getElementById('detailSection'); section.scrollTop = section.scrollHeight;
      return { scroll: section.scrollTop, text: document.querySelector('.detail-note').textContent };
    })()`);
    assert.ok(noteScroll.scroll > 0 && noteScroll.text.includes('第 20 行'), '长备注被丢弃');
    await shot(win, 'w2-auto-limited');
    note('W2 靠近屏幕底部', { bounds: limited, limit: w2.maxHeight, noteScroll: noteScroll.scroll });

    // 贴边状态调整内容高度，隐藏后仍只露出 3px；滑出后高度仍准确。
    for (const edge of ['top', 'left', 'right']) {
      await select(null);
      w2.dock = edge;
      w2.dockDisplayId = display.id;
      w2.collapsed = false;
      w2.setBounds({ x: wa.x + 100, y: wa.y + 30, width: 480 });
      w2.setBounds(w2.dockBounds(false));
      w2.updateLayoutLimit(true);
      await wait(350);
      w2.collapse();
      await wait(230);
      await select('layout-short');
      await wait(350);
      const hidden = win.getBounds();
      if (edge === 'top') assert.equal(hidden.y + hidden.height, wa.y + 3);
      if (edge === 'left') assert.equal(hidden.x + hidden.width, wa.x + 3);
      if (edge === 'right') assert.equal(hidden.x, wa.x + wa.width - 3);
      w2.expand();
      await wait(230);
      const shown = win.getBounds();
      if (edge === 'top') assert.equal(shown.y, wa.y);
      if (edge === 'left') assert.equal(shown.x, wa.x);
      if (edge === 'right') assert.equal(shown.x + shown.width, wa.x + wa.width);
      sameHeight(shown.height, Math.ceil((await layout()).shell.height));
      note(`W2 ${edge} 贴边动态高度`, { hidden, shown });
    }
    note('W2 动态布局回归', '通过');
  } finally {
    store.tasks = originalTasks;
    store.reminders = originalReminders;
    w2.dock = null;
    w2.collapsed = false;
    w2.setBounds({ x: wa.x + 100, y: wa.y + 60, width: 480 });
    w2.updateLayoutLimit(true);
    broadcast();
    await select(null);
    await wait(350);
  }
}

module.exports = { run };
