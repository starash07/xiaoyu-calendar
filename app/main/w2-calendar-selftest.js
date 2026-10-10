// 用批准的叠放示例检查真实窗口，避免网页方案迁移后重新变得紧凑。
const assert = require('node:assert/strict');
const { screen } = require('electron');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run({ store, w2, broadcast, note, shot }) {
  const win = w2.win, wa = screen.getPrimaryDisplay().workArea;
  const js = code => win.webContents.executeJavaScript(code);
  const originalTasks = store.tasks, originalReminders = store.reminders;
  const originalView = await js('W2App.App.view');
  const task = (id, title, start, end, color) => ({ id, title, color,
    startDate: `2026-09-${start}`, endDate: `2026-09-${end}`,
    note: '日历布局验证，数据仅用于自测。', done: false, pinned: false, remind: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' });
  const sample = [
    task('spacing-plan', '项目方案整理', '07', '10', '#a8d9c5'),
    task('spacing-check', '资料核对', '09', '11', '#c8c2e9'),
    task('spacing-design', '新界面设计', '14', '20', '#abd5e8'),
    task('spacing-sprint', '双周迭代 S12', '16', '18', '#c8c2e9'),
    task('spacing-trip', '团建', '18', '18', '#f4d58a'),
    task('spacing-review', '完成本月复盘', '24', '26', '#a8d9c5'),
  ];
  const metrics = () => js(`(() => {
    const content = document.querySelector('.content'), bottom = document.querySelector('.bottom-bar');
    const weeks = [...document.querySelectorAll('.cal-week')].map(week => {
      const rect = week.getBoundingClientRect();
      const bars = [...week.querySelectorAll('.cal-bar')].map(bar => {
        const r = bar.getBoundingClientRect();
        return { top: r.top - rect.top, bottom: r.bottom - rect.top, height: r.height };
      });
      return { height: rect.height, bars };
    });
    return { weeks, shell: document.getElementById('appShell').getBoundingClientRect().height,
      background: getComputedStyle(document.getElementById('appShell')).backgroundColor,
      weekend: getComputedStyle(document.querySelector('.cal-dc:nth-child(6)')).color,
      font: getComputedStyle(document.querySelector('.cal-dates')).fontSize,
      scrolls: content.scrollHeight > content.clientHeight,
      bottomVisible: bottom.getBoundingClientRect().bottom <= innerHeight,
      fits: document.documentElement.scrollWidth <= innerWidth && bottom.scrollWidth <= bottom.clientWidth };
  })()`);
  const show = async (tasks, width, month = 8, year = 2026) => {
    store.tasks = tasks;
    store.reminders = { ...originalReminders, items: [] };
    w2.setBounds({ x: wa.x + 100, y: wa.y + 60, width });
    w2.updateLayoutLimit(true);
    broadcast();
    await js(`W2App.App.view = { y: ${year}, m: ${month} }; W2App.App.hoverId = null; W2App.select(null); W2App.render()`);
    await wait(350);
    return metrics();
  };
  const containsBars = state => {
    assert.ok(state.fits && state.bottomVisible, '日历或底部按钮超出窗口');
    assert.ok(state.weeks.every(w => w.bars.every(b => b.top >= 32 && b.bottom <= w.height - 7)), '日程条超出所在周');
    assert.ok(Math.abs(win.getBounds().height - Math.ceil(state.shell)) <= 1, '真实窗口未跟随内容高度');
  };
  try {
    w2.dock = null;
    w2.collapsed = false;
    w2.show();
    const regular = await show(sample, 480);
    containsBars(regular);
    assert.deepEqual(regular.weeks.map(w => w.bars.length), [0, 2, 3, 1, 0]);
    assert.deepEqual(regular.weeks.slice(1, 4).map(w => w.height), [81, 101, 61]);
    assert.ok(regular.weeks[0].height >= 56 && regular.weeks[0].height <= 60, '空白周高度不符合方案');
    assert.equal(regular.font, '17px');
    assert.equal(regular.background, 'rgb(255, 255, 255)');
    assert.equal(regular.weekend, 'rgb(138, 112, 214)');
    await shot(win, 'w2-spacing-480');
    const compact = await show(sample, 400);
    containsBars(compact);
    assert.equal(compact.weeks[0].height, 56);
    await shot(win, 'w2-spacing-400');
    const wide = await show(sample, 640);
    containsBars(wide);
    assert.ok(wide.weeks[0].height > regular.weeks[0].height, '空白周没有随宽度缩放');
    note('W2 日历宽度与周行高度', [480, 400, 640].map((width, i) => ({ width,
      weeks: [regular, compact, wide][i].weeks.map(w => w.height) })));

    for (const [year, month, count] of [[2021, 1, 4], [2026, 7, 6]]) {
      const empty = await show([], 400, month, year);
      containsBars(empty);
      assert.equal(empty.weeks.length, count);
      assert.ok(empty.weeks.every(w => w.height === 56 && !w.bars.length));
    }
    const dense = await show(Array.from({ length: 30 }, (_, i) => ({ ...sample[2], id: `dense-${i}` })), 380);
    containsBars(dense);
    assert.equal(dense.weeks[2].bars.length, 30, '密集日程被隐藏');
    assert.ok(dense.scrolls, '空间不足时内容无法滚动');
    assert.ok(win.getBounds().y + win.getBounds().height <= wa.y + wa.height);
    await shot(win, 'w2-spacing-dense');
    note('W2 日历留白、配色和密集日程', '通过；4/5/6 周月份、380/400/480/640px 宽度、30 条叠放');
  } finally {
    store.tasks = originalTasks;
    store.reminders = originalReminders;
    w2.setBounds({ x: wa.x + 100, y: wa.y + 60, width: 480 });
    w2.updateLayoutLimit(true);
    broadcast();
    await js(`W2App.App.view = ${JSON.stringify(originalView)}; W2App.render()`);
    await wait(350);
  }
}

module.exports = { run };
