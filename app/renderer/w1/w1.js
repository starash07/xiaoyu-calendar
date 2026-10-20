// W1 桌面挂件页面：只显示当月未完成的日程；只响应悬停，悬停时详情在日历下方浮现
const D = RCDates, C = RCColors, K = RCCal, A = RCDesktopAppearance;
const $ = id => document.getElementById(id);
const panel = $('panel'), cal = $('cal'), detail = $('detail'), tint = $('tint');
const details = $('details');

let state = null;      // 主进程推来的数据
let info = null;       // 窗口位置、是否钉住
let preview = null;    // 设置页拖滑块时的临时外观
let hoverId = null;
let calendarKey = '', detailKey = '', hideTimer = null;
let sizeFrame = 0, lastSize = '', calendarWidth = 0;
let cursor = { x: -1, y: -1 };

const appearance = () => A.normalize({ ...state?.settings.w1.appearance, ...(preview || {}) });

function applyAppearance() {
  const ap = appearance();
  panel.style.setProperty('--w', `${ap.width}px`);
  panel.style.setProperty('--date-size', `${ap.dateFontSize}px`);
  tint.style.background = C.rgba(ap.panelColor, ap.panelOpacity / 100);
  panel.style.setProperty('--fg', ap.textColor);
  panel.style.setProperty('--fg2', C.rgba(ap.textColor, .72));
  panel.style.setProperty('--fg3', C.rgba(ap.textColor, .32));
  panel.style.setProperty('--rule', C.rgba(ap.textColor, .10));
  panel.style.setProperty('--detail-rule', C.rgba(ap.textColor, .14));
}

function render() {
  if (!state) return;
  applyAppearance();
  const ap = appearance();
  const t = D.parse(state.today);
  $('month').textContent = `${t.getMonth() + 1} 月`;
  $('year').textContent = String(t.getFullYear());
  const tasks = state.tasks.filter(x => !x.done);
  const key = JSON.stringify([state.today, tasks, ap.barHeight, ap.barFontSize]);
  // 拖动颜色、透明度和宽度时保留日历节点，避免悬停详情被反复重建。
  if (key !== calendarKey) {
    calendarKey = key;
    cal.innerHTML = K.monthHTML({
      year: t.getFullYear(), month: t.getMonth(), tasks,
      today: state.today, barH: ap.barHeight, fontSize: ap.barFontSize,
      barRadius: 999, barGap: 5, barPadding: 7,
    });
    cal.querySelectorAll('.cal-dc').forEach(cell => {
      const number = document.createElement('span');
      number.className = 'date-number';
      number.textContent = cell.textContent;
      cell.replaceChildren(number);
      if (cell.dataset.date === state.today) cell.setAttribute('aria-current', 'date');
    });
    const byId = new Map(tasks.map(task => [task.id, task]));
    cal.querySelectorAll('.cal-bar').forEach(bar => {
      const task = byId.get(bar.dataset.id);
      bar.style.color = '#345662';
      bar.setAttribute('aria-label', `${task.title}，${D.rangeText(task.startDate, task.endDate)}`);
      bar.setAttribute('aria-describedby', 'details');
    });
    if (![...cal.querySelectorAll('.cal-bar')].some(bar => bar.dataset.id === hoverId)) hoverId = null;
  }
  K.markBars(cal, 'hot', hoverId);
  renderDetail();
  renderFlag();
  reportSize();
}

function renderDetail() {
  const task = hoverId && state?.tasks.find(x => x.id === hoverId && !x.done);
  if (task) {
    const html = K.detailHTML(task, state.today);
    if (html !== detailKey) { detailKey = html; detail.innerHTML = html; }
  }
  // 收起时不清空内容，否则 0fr 会直接跳到零高，无法呈现收起动画。
  details.classList.toggle('show', !!task);
  details.setAttribute('aria-hidden', String(!task));
}

function renderFlag() {
  const open = new Set(state.tasks.filter(x => !x.done).map(x => x.id));
  const n = state.reminders.filter(r => !r.confirmed && open.has(r.taskId)).length;
  $('flag').hidden = !n;
  $('flagCount').textContent = n > 9 ? '9+' : String(n);
  $('flag').setAttribute('aria-label', `${n} 条待确认提醒，请到主窗口查看`);
  if (!n) $('flagTip').hidden = true;
}

function setHover(id) {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (id === hoverId) return;
  hoverId = id;
  K.markBars(cal, 'hot', id);
  renderDetail();
}

// 悬停判断：钉住时坐标来自主进程的光标轮询，摆放中来自页面自己的鼠标事件
function hitTest(x, y) {
  cursor = { x, y };
  cal.querySelector('.cal-dc.hov')?.classList.remove('hov');
  if (x < 0 || panel.classList.contains('dragging')) { setHover(null); $('flagTip').hidden = true; return; }
  const el = document.elementFromPoint(x, y);
  const bar = el && el.closest('.cal-bar');
  if (bar) setHover(bar.dataset.id);
  else if (hoverId && !hideTimer) hideTimer = setTimeout(() => setHover(null), 100);
  el?.closest('.cal-dc.today')?.classList.add('hov');
  $('flagTip').hidden = !(!$('flag').hidden && el && el.closest('#flag'));
}

// 内容大小变了就告诉主进程：窗口顶部不动，底边跟着伸缩
function reportSize() {
  if (sizeFrame) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    const r = panel.getBoundingClientRect(), margin = info?.margin ?? 8;
    const w = Math.ceil(r.width + margin * 2), h = Math.ceil(r.height + margin * 2);
    const key = `${w}/${h}`;
    if (key !== lastSize) { lastSize = key; rc.reportSize(w, h); }
  });
}
new ResizeObserver(reportSize).observe(panel);
new ResizeObserver(() => {
  if (cal.clientWidth === calendarWidth) return;
  calendarWidth = cal.clientWidth;
  panel.style.setProperty('--week-height', `${Math.max(54, Math.round(calendarWidth * .135))}px`);
  if (state) hitTest(cursor.x, cursor.y);
}).observe(cal);

rc.onState(s => { state = s; render(); });
rc.onPreview(ap => { preview = ap; if (state) render(); });
rc.onCursor(({ x, y }) => hitTest(x, y));
rc.onW1Info(i => {
  const placementChanged = info && (info.loose !== i.loose || info.dragging !== i.dragging);
  info = i;
  panel.classList.toggle('loose', i.loose);
  panel.classList.toggle('dragging', !!i.dragging);
  panel.setAttribute('aria-label', i.loose ? '可以拖动的桌面日历' : '已钉住的桌面日历');
  if (placementChanged) hitTest(-1, -1);
  reportSize();
});

panel.addEventListener('mousemove', e => { if (info && !info.embedded) hitTest(e.clientX, e.clientY); });
panel.addEventListener('mouseleave', () => { if (info && !info.embedded) hitTest(-1, -1); });
// 只拖上方提示条，查看日程时不会误把整个挂件拖走。
$('dragHandle').addEventListener('mousedown', e => {
  if (!info || !info.loose || e.button !== 0 || e.target.closest('button')) return;
  hitTest(-1, -1);
  rc.w1Drag();
});
$('pinBtn').addEventListener('click', async () => {
  $('pinBtn').disabled = true;
  try {
    const res = await rc.setPinned(true);
    $('placementNote').textContent = res.ok ? '拖动摆放位置' : (res.error || '保存失败，请再试一次');
  } catch (_) { $('placementNote').textContent = '保存失败，请再试一次'; }
  finally { $('pinBtn').disabled = false; }
});

rc.getState().then(s => { state = s; render(); });
rc.w1Ready();
