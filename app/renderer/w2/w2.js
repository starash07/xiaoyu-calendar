// W2 下拉窗页面：整月日历（已完成的灰色排在最后）、切换月份、悬停 / 点选详情、新建拖选、提醒栏
const D = RCDates, C = RCColors, K = RCCal;
const $ = id => document.getElementById(id);
const BAR_H = 16, FONT = 11;   // 下拉窗的甘特条先用固定尺寸，不跟桌面挂件的设置走（待确认）

const App = { state: null, view: null, hoverId: null, selectedId: null, newMode: false, sel: null };
const cal = $('cal'), calwrap = $('calwrap');

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
  $('title').textContent = `${y} 年 ${m + 1} 月`;
  cal.innerHTML = K.monthHTML({ year: y, month: m, tasks: s.tasks, today: s.today, barH: BAR_H, fontSize: FONT });
  const first = D.toStr(new Date(y, m, 1)), last = D.toStr(new Date(y, m + 1, 0));
  $('empty').hidden = s.tasks.some(t => t.endDate >= first && t.startDate <= last);
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
  if (!t) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = K.detailHTML(t, s.today);
  if (t.pinned) box.querySelector('.dt-title').insertAdjacentHTML('beforeend', '<span class="dt-pin">置顶</span>');
  if (App.selectedId === t.id) {
    box.querySelector('.dt-body').insertAdjacentHTML('beforeend',
      '<div class="dt-actions">'
      + '<button type="button" data-act="edit">编辑</button>'
      + `<button type="button" data-act="done">${t.done ? '取消完成' : '完成'}</button>`
      + `<button type="button" data-act="pin">${t.pinned ? '取消置顶' : '置顶'}</button>`
      + '<button type="button" data-act="delete" class="danger">删除</button>'
      + '</div>');
  }
  box.hidden = false;
}

$('detail').addEventListener('click', async e => {
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
function renderReminders() {
  const s = App.state, byId = new Map(s.tasks.map(t => [t.id, t]));
  const items = s.reminders
    .filter(r => !r.confirmed && byId.has(r.taskId) && !byId.get(r.taskId).done)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const box = $('reminders');
  box.hidden = !items.length;
  box.innerHTML = !items.length ? '' : `<div class="rm-head">待确认提醒 ${items.length} 条</div>` + items.map(r => {
    const t = byId.get(r.taskId);
    return `<div class="rm-item"><i class="rm-dot" style="background:${t.color}"></i>`
      + `<span class="rm-title" data-task="${t.id}" title="在日历里查看">${K.esc(t.title)}</span>`
      + `<span class="rm-reason">${K.reminderReason(r.kind, t, s.today)} · ${D.rangeText(t.startDate, t.endDate)}</span>`
      + `<button type="button" class="rm-ok" data-rid="${K.esc(r.id)}">知道了</button></div>`;
  }).join('');
}

$('reminders').addEventListener('click', async e => {
  const ok = e.target.closest('.rm-ok');
  if (ok) {
    const res = await rc.confirmReminder(ok.dataset.rid);
    if (!res.ok) toast('保存失败，这条提醒保持未确认', true);
    return;
  }
  const title = e.target.closest('.rm-title');
  const t = title && App.state.tasks.find(x => x.id === title.dataset.task);
  if (t) { const d = D.parse(t.startDate); App.view = { y: d.getFullYear(), m: d.getMonth() }; App.selectedId = t.id; render(); }
});

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
  render();
}

function goToday() {
  const t = D.parse(App.state.today);
  App.view = { y: t.getFullYear(), m: t.getMonth() };
  render();
  const cell = cal.querySelector('.cal-dc.today');
  if (cell) cell.scrollIntoView({ block: 'nearest' });
}

// —— 新建：先点「新建」，再在日历上拖出日期范围，松手弹出填写窗口 ——
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
    div.style.cssText = `left:calc(${i * 100 / 7}% + 2px);width:calc(${(j - i + 1) * 100 / 7}% - 4px);top:${week.querySelector('.cal-dates').offsetHeight + 3}px`;
    week.appendChild(div);
  });
  const label = $('daylabel');
  label.textContent = `${D.diff(a, b) + 1} 天`;
  if (e) { label.style.left = `${e.clientX + 14}px`; label.style.top = `${e.clientY + 12}px`; }
  label.hidden = false;
}

function clearSelection() {
  App.sel = null;
  cal.querySelectorAll('.cal-preview').forEach(n => n.remove());
  $('daylabel').hidden = true;
}

let press = null;   // 普通状态下按下的位置：移动超过 4px 算拖窗口，否则算点击
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
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 4) { press = null; rc.w2Drag(); }
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

// —— 顶部栏 ——
$('prevBtn').addEventListener('click', () => shiftMonth(-1));
$('nextBtn').addEventListener('click', () => shiftMonth(1));
$('todayBtn').addEventListener('click', goToday);
$('newBtn').addEventListener('click', enterNewMode);
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
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); enterNewMode(); }
  else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
  else if (e.key === 'Delete' && !typing && App.selectedId) {
    const t = App.state.tasks.find(x => x.id === App.selectedId);
    if (t) TaskDialog.confirmDelete(t);
  }
});

// —— 主进程发来的命令：托盘「新建日程」「设置」，以及用户主动收起时放弃填写 ——
rc.onCommand(cmd => {
  if (cmd.type === 'new') enterNewMode();
  else if (cmd.type === 'settings') Settings.open();
  else if (cmd.type === 'discard') { TaskDialog.discard(); if (App.newMode) exitNewMode(); }
});

rc.onState(s => { App.state = s; render(); if (Settings.isOpen()) Settings.render(); });
rc.getState().then(s => { App.state = s; render(); });

window.W2App = { App, toast, report, refreshBlock, render, select, exitNewMode };
