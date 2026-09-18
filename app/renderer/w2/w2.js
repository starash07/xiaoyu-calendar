// 主界面：月历与独立侧栏。直接新建，也可以先拖选日期。
const D = RCDates, C = RCColors, K = RCCal;
const $ = id => document.getElementById(id);
const BAR_H = 22, FONT = 11;
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const App = { state: null, view: null, hoverId: null, selectedId: null, newMode: false, sel: null };
const cal = $('cal'), calwrap = $('calwrap');
let reminderIndex = 0, remindersExpanded = false;
let reminderAnimations = [];

// —— 提示：浮现后自动消失 ——
let toastTimer = null;
function toast(msg, bad) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}
// 不经过填写弹窗的操作：成功或失败都提示一下；失败时数据没变，界面自然保持原状态
function report(res, okMsg) {
  if (res && res.ok) toast(okMsg);
  else toast('保存失败，已恢复原来的状态', true);
}

// 新建中 / 有弹窗 / 在设置页 / 输入框有焦点时，告诉主进程别自动收起
function refreshBlock() {
  const el = document.activeElement;
  const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  rc.setBlock(App.newMode || TaskDialog.isOpen() || Settings.isOpen() || typing);
}
document.addEventListener('focusin', refreshBlock);
document.addEventListener('focusout', () => setTimeout(refreshBlock, 0));

function render() {
  const s = App.state;
  if (!s) return;
  if (!App.view) { const t = D.parse(s.today); App.view = { y: t.getFullYear(), m: t.getMonth() }; }
  const { y, m } = App.view;
  $('title').innerHTML = `${m + 1}<span class="month-unit">月</span>`;
  $('monthKicker').textContent = `${y} / ${MONTHS[m]}`;
  cal.innerHTML = K.monthHTML({ year: y, month: m, tasks: s.tasks, today: s.today, barH: BAR_H, fontSize: FONT });
  cal.querySelectorAll('.cal-dc').forEach(cell => {
    cell.innerHTML = `<span class="date-number">${cell.textContent}</span>`;
    if (cell.dataset.date === s.today) cell.setAttribute('aria-current', 'date');
  });
  const byId = new Map(s.tasks.map(t => [t.id, t]));
  cal.querySelectorAll('.cal-bar').forEach(bar => {
    const t = byId.get(bar.dataset.id);
    bar.classList.toggle('is-pinned', t.pinned);
    bar.tabIndex = 0;
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', `${t.title}，${D.rangeText(t.startDate, t.endDate)}${t.done ? '，已完成' : ''}`);
  });
  const first = D.toStr(new Date(y, m, 1)), last = D.toStr(new Date(y, m + 1, 0));
  const monthTasks = s.tasks.filter(t => t.endDate >= first && t.startDate <= last);
  $('monthCount').innerHTML = `本月 <strong>${monthTasks.length}</strong> 项日程`;
  $('empty').hidden = monthTasks.length > 0;
  if (App.selectedId && !s.tasks.some(t => t.id === App.selectedId)) App.selectedId = null;
  K.markBars(cal, 'sel', App.selectedId);
  K.markBars(cal, 'hot', App.selectedId ? null : App.hoverId);
  renderDetail();
  renderReminders();
  if (App.sel) drawPreview();
}

// 详情：悬停时临时预览；点选后一直显示到取消选中，并出现操作按钮
function renderDetail() {
  const s = App.state, id = App.selectedId || App.hoverId;
  const t = id && s.tasks.find(x => x.id === id);
  const box = $('detail');
  const actions = $('detailActions');
  actions.hidden = !t || App.selectedId !== t.id;
  actions.innerHTML = '';
  $('detailSection').hidden = !t;
  if (!t) { box.hidden = true; box.innerHTML = ''; return; }
  $('detailLabel').textContent = App.selectedId ? '日程详情' : '日程预览';
  $('clearSelectionBtn').hidden = !App.selectedId;
  box.innerHTML = K.detailHTML(t, s.today);
  if (t.pinned) box.querySelector('.dt-title').insertAdjacentHTML('beforeend', '<span class="dt-pin">置顶</span>');
  if (App.selectedId === t.id) {
    actions.innerHTML = '<button type="button" data-act="edit">编辑</button>'
      + `<button type="button" data-act="done">${t.done ? '取消完成' : '完成'}</button>`
      + `<button type="button" data-act="pin">${t.pinned ? '取消置顶' : '置顶'}</button>`
      + '<button type="button" data-act="delete" class="danger">删除</button>';
  }
  box.hidden = false;
}

$('detailActions').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  const t = b && App.state.tasks.find(x => x.id === App.selectedId);
  if (!t) return;
  const act = b.dataset.act;
  if (act === 'edit') TaskDialog.open({ mode: 'edit', task: t });
  else if (act === 'delete') TaskDialog.confirmDelete(t);
  else if (act === 'done') report(await rc.updateTask(t.id, { done: !t.done }), t.done ? '已取消完成' : '已标记完成');
  else if (act === 'pin') report(await rc.updateTask(t.id, { pinned: !t.pinned }), t.pinned ? '已取消置顶' : '已置顶');
});

// 提醒栏：列出还没确认的提醒，逐条点「知道了」
function layoutReminders(animate = false) {
  const section = $('reminderSection'), box = $('reminders');
  const cards = [...box.querySelectorAll('.rm-item')];
  const moving = animate && cards.length && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 从当前画面接着运动，快速反复点击时也不会跳回动画起点。
  const oldHeight = section.getBoundingClientRect().height;
  const before = moving ? cards.map(card => ({
    rect: card.getBoundingClientRect(), opacity: getComputedStyle(card).opacity
  })) : [];
  reminderAnimations.forEach(animation => animation.cancel());
  reminderAnimations = [];
  section.classList.remove('is-animating');
  section.classList.toggle('expanded', remindersExpanded);
  cards.forEach((card, index) => {
    const depth = (index - reminderIndex + cards.length) % cards.length;
    card.classList.remove('deck-0', 'deck-1', 'deck-2');
    if (!remindersExpanded && depth <= 2) card.classList.add(`deck-${depth}`);
    card.inert = !remindersExpanded && depth !== 0;
  });
  if (!remindersExpanded) box.scrollTop = 0;
  if (!moving) return;

  const newHeight = section.getBoundingClientRect().height;
  const targets = cards.map(card => {
    const style = getComputedStyle(card);
    return { rect: card.getBoundingClientRect(), transform: style.transform, opacity: style.opacity };
  });
  const timing = { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' };
  section.classList.add('is-animating');
  const heightAnimation = section.animate([
    { height: `${oldHeight}px`, maxHeight: 'none' },
    { height: `${newHeight}px`, maxHeight: 'none' }
  ], timing);
  heightAnimation.onfinish = () => section.classList.remove('is-animating');
  reminderAnimations.push(heightAnimation);
  cards.forEach((card, index) => {
    const from = before[index], to = targets[index];
    const matrix = new DOMMatrix(to.transform === 'none' ? undefined : to.transform);
    const x = from.rect.left + from.rect.width / 2 - (to.rect.left + to.rect.width / 2 - matrix.e);
    const y = from.rect.top - (to.rect.top - matrix.f);
    const scaleX = from.rect.width / (to.rect.width / matrix.a);
    const scaleY = from.rect.height / (to.rect.height / matrix.d);
    reminderAnimations.push(card.animate([
      { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`, opacity: from.opacity },
      { transform: to.transform, opacity: to.opacity }
    ], timing));
  });
}

function renderReminders() {
  const s = App.state, byId = new Map(s.tasks.map(t => [t.id, t]));
  const items = s.reminders
    .filter(r => !r.confirmed && byId.has(r.taskId) && !byId.get(r.taskId).done)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const box = $('reminders');
  box.hidden = !items.length;
  $('reminderSection').hidden = !items.length;
  if (!items.length) { remindersExpanded = false; reminderIndex = 0; box.innerHTML = ''; layoutReminders(); return; }
  reminderIndex = Math.max(0, Math.min(reminderIndex, items.length - 1));
  box.innerHTML = items.map((r, index) => {
    const t = byId.get(r.taskId);
    return `<article class="rm-item" data-index="${index}" data-rid="${K.esc(r.id)}"><i class="rm-dot" style="background:${t.color}"></i>`
      + `<span class="rm-title">${K.esc(t.title)}</span>`
      + `<span class="rm-reason">${K.reminderReason(r.kind, t, s.today)}</span>`
      + `<div class="rm-bottom"><span class="rm-date">${D.rangeText(t.startDate, t.endDate)}</span>`
      + `<button type="button" class="rm-ok" data-rid="${K.esc(r.id)}" aria-label="确认提醒：${K.esc(t.title)}">知道了</button></div>`
      + `<span class="reminder-count" aria-label="第 ${index + 1} 条，共 ${items.length} 条提醒">${index + 1} / ${items.length}</span></article>`;
  }).join('');
  layoutReminders();
}

$('reminders').addEventListener('click', async e => {
  const ok = e.target.closest('.rm-ok');
  if (ok) {
    const res = await rc.confirmReminder(ok.dataset.rid);
    if (res.ok) toast('已确认提醒');
    else toast('保存失败，这条提醒保持未确认', true);
    return;
  }
  const card = e.target.closest('.rm-item');
  if (card) {
    reminderIndex = +card.dataset.index;
    remindersExpanded = !remindersExpanded;
    layoutReminders(true);
  }
});

$('reminders').addEventListener('wheel', e => {
  const cards = $('reminders').querySelectorAll('.rm-item');
  if (remindersExpanded || cards.length < 2 || Math.abs(e.deltaY) < 2) return;
  e.preventDefault();
  e.stopPropagation();
  reminderIndex = (reminderIndex + (e.deltaY > 0 ? 1 : -1) + cards.length) % cards.length;
  layoutReminders(true);
}, { passive: false });

function setHover(id) {
  if (id === App.hoverId) return;
  App.hoverId = id;
  K.markBars(cal, 'hot', id);
  renderDetail();
}

function select(id) {
  App.selectedId = id;
  App.hoverId = null;
  K.markBars(cal, 'hot', null);
  K.markBars(cal, 'sel', id);
  renderDetail();
}

function shiftMonth(n) {
  const d = new Date(App.view.y, App.view.m + n, 1);
  App.view = { y: d.getFullYear(), m: d.getMonth() };
  App.hoverId = null;
  App.selectedId = null;
  clearSelection();
  render();
}

function goToday() {
  const t = D.parse(App.state.today);
  App.view = { y: t.getFullYear(), m: t.getMonth() };
  App.hoverId = null;
  App.selectedId = null;
  clearSelection();
  render();
  const cell = cal.querySelector('.cal-dc.today');
  if (cell) cell.scrollIntoView({ block: 'nearest' });
}

// 直接新建默认今天；查看其他月份时默认该月 1 日，日期仍可修改。
function newTask() {
  if (TaskDialog.isOpen() || !App.state) return;
  Settings.close();
  exitNewMode();
  select(null);
  const today = D.parse(App.state.today), { y, m } = App.view;
  const day = y === today.getFullYear() && m === today.getMonth() ? App.state.today : D.toStr(new Date(y, m, 1));
  TaskDialog.open({ mode: 'new', start: day, end: day });
}

// 选日期：保留跨天拖选能力，作为新建的另一种入口。
function enterNewMode() {
  if (TaskDialog.isOpen()) return;
  Settings.close();
  App.newMode = true;
  select(null);
  calwrap.classList.add('newmode');
  $('newbar').hidden = false;
  refreshBlock();
}

function exitNewMode() {
  App.newMode = false;
  clearSelection();
  markHoverDay(null);
  calwrap.classList.remove('newmode');
  $('newbar').hidden = true;
  refreshBlock();
}

function dayAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const week = el && el.closest('.cal-week');
  if (!week) return null;
  const r = week.getBoundingClientRect();
  const col = Math.max(0, Math.min(6, Math.floor((x - r.left) / (r.width / 7))));
  return D.addDays(week.dataset.start, col);
}

function markHoverDay(day) {
  cal.querySelectorAll('.cal-dc.hov').forEach(n => n.classList.remove('hov'));
  if (day) { const c = cal.querySelector(`.cal-dc[data-date="${day}"]`); if (c) c.classList.add('hov'); }
}

const ordered = () => (App.sel.a <= App.sel.b ? [App.sel.a, App.sel.b] : [App.sel.b, App.sel.a]);

function drawPreview(e) {
  cal.querySelectorAll('.cal-preview').forEach(n => n.remove());
  if (!App.sel) return;
  const [a, b] = ordered();
  cal.querySelectorAll('.cal-week').forEach(week => {
    const ws = week.dataset.start, we = D.addDays(ws, 6);
    if (b < ws || a > we) return;
    const i = Math.max(0, D.diff(ws, a)), j = Math.min(6, D.diff(ws, b));
    const div = document.createElement('div');
    div.className = 'cal-preview';
    div.style.cssText = `left:calc(${i * 100 / 7}% + 2px);width:calc(${(j - i + 1) * 100 / 7}% - 4px);top:${week.querySelector('.cal-lanes').offsetTop}px`;
    week.appendChild(div);
  });
  const label = $('daylabel');
  label.textContent = `${D.diff(a, b) + 1} 天`;
  if (e) { label.style.left = `${Math.min(e.clientX + 14, innerWidth - 74)}px`; label.style.top = `${Math.min(e.clientY + 12, innerHeight - 32)}px`; }
  label.hidden = false;
}

function clearSelection() {
  App.sel = null;
  cal.querySelectorAll('.cal-preview').forEach(n => n.remove());
  $('daylabel').hidden = true;
}

let press = null;
calwrap.addEventListener('pointerdown', e => {
  if (e.button === 2 && App.sel) { clearSelection(); return; }   // 拖选中点右键：取消这次拖选
  if (e.button !== 0) return;
  if (App.newMode) {
    const day = dayAt(e.clientX, e.clientY);
    if (!day) return;
    App.sel = { a: day, b: day };
    calwrap.setPointerCapture(e.pointerId);
    drawPreview(e);
    return;
  }
  const bar = e.target.closest('.cal-bar');
  press = { x: e.clientX, y: e.clientY, id: bar ? bar.dataset.id : null };
});

calwrap.addEventListener('pointermove', e => {
  if (App.newMode) {
    const day = dayAt(e.clientX, e.clientY);
    markHoverDay(day);
    if (App.sel) { if (day) App.sel.b = day; drawPreview(e); }   // 拖出日历区域：保留最后经过的那一天
    return;
  }
  if (press && (e.buttons & 1)) {
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 4) press = null;
    return;
  }
  if (!App.selectedId) { const bar = e.target.closest('.cal-bar'); setHover(bar ? bar.dataset.id : null); }
});

calwrap.addEventListener('pointerup', () => {
  if (App.newMode) {
    if (!App.sel) return;
    const [a, b] = ordered();
    clearSelection();
    TaskDialog.open({ mode: 'new', start: a, end: b });
    return;
  }
  if (!press) return;
  const id = press.id;
  press = null;
  select(id);   // 点条选中；点空白取消选中
});

calwrap.addEventListener('pointerleave', () => {
  if (!App.selectedId) setHover(null);
  if (App.newMode && !App.sel) markHoverDay(null);
});
calwrap.addEventListener('contextmenu', e => { if (App.sel) { e.preventDefault(); clearSelection(); } });
calwrap.addEventListener('pointercancel', () => { press = null; clearSelection(); });
cal.addEventListener('keydown', e => {
  const bar = e.target.closest('.cal-bar');
  if (bar && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (!App.newMode) select(bar.dataset.id);
  }
});

// —— 顶部栏 ——
$('prevBtn').addEventListener('click', () => shiftMonth(-1));
$('nextBtn').addEventListener('click', () => shiftMonth(1));
$('todayBtn').addEventListener('click', goToday);
$('newBtn').addEventListener('click', newTask);
$('emptyNewBtn').addEventListener('click', newTask);
$('rangeBtn').addEventListener('click', enterNewMode);
$('cancelRangeBtn').addEventListener('click', exitNewMode);
$('clearSelectionBtn').addEventListener('click', () => select(null));
$('settingsBtn').addEventListener('click', () => Settings.open());
$('closeBtn').addEventListener('click', () => rc.hideW2());

// —— 键盘 ——
document.addEventListener('keydown', e => {
  if (TaskDialog.confirmOpen()) return;   // 删除确认框自己处理 Esc
  if (e.key === 'Escape') {
    if (TaskDialog.isOpen()) return;        // 填写弹窗里按 Esc 不关闭
    if (Settings.isOpen()) Settings.close();
    else if (App.sel) clearSelection();
    else if (App.newMode) exitNewMode();
    else if (App.selectedId) select(null);
    return;
  }
  if (TaskDialog.isOpen() || Settings.isOpen()) return;
  const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName);
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newTask(); }
  else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
  else if (e.key === 'Delete' && !typing && App.selectedId) {
    const t = App.state.tasks.find(x => x.id === App.selectedId);
    if (t) TaskDialog.confirmDelete(t);
  }
});

// —— 主进程发来的命令：托盘「新建日程」「设置」，以及用户主动收起时放弃填写 ——
rc.onCommand(cmd => {
  if (cmd.type === 'new') newTask();
  else if (cmd.type === 'settings') Settings.open();
  else if (cmd.type === 'discard') { TaskDialog.discard(); if (App.newMode) exitNewMode(); }
});

rc.onState(s => { App.state = s; render(); if (Settings.isOpen()) Settings.render(); });
rc.getState().then(s => { App.state = s; render(); });

window.W2App = { App, toast, report, refreshBlock, render, select, exitNewMode };
