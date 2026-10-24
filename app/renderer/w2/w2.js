// 主界面：便当盒布局。月份操作与提醒在月历上方，详情从窗口底部展开。
const D = RCDates, C = RCColors, K = RCCal, A = RCDesktopAppearance;
const $ = id => document.getElementById(id);
let appearancePreview = null, appearanceFrame = 0, calendarKey = '';

const App = { state: null, view: null, hoverId: null, selectedId: null, sel: null };
let settingsVisible = false;
const Settings = {
  isOpen: () => settingsVisible,
  async open() {
    if (!App.state || TaskDialog.isOpen()) return;
    clearSelection();
    try {
      const result = await rc.openSettings();
      if (!result?.ok) toast('设置窗口未能打开，请重试。', true);
    } catch (_) { toast('设置窗口未能打开，请重试。', true); }
  },
  close() { if (settingsVisible) rc.closeSettings(); },
};
rc.onSettingsVisibility?.(visible => { settingsVisible = !!visible; });
rc.onSettingsError?.(message => toast(message, true));
const cal = $('cal'), calwrap = $('calwrap');
const monthStage = $('monthStage'), monthPage = $('monthPage');
let monthMotion = null;
let datePointerId = null;
let reminderIndex = 0, remindersExpanded = false;
let reminderAnimations = [];
let queuedReminderDirection = 0, reminderWheelAmount = 0, reminderWheelTime = 0;
let remindersHTML = null;
let shownDetailId = null;

// 按面板的实际高度调整原生窗口；上限来自屏幕剩余空间，不依赖当前窗口高度。
// 观察动画中的每一帧，让真实窗口底边也跟着详情和提醒堆缓动。
const shell = $('appShell');
let availableHeight = 1000, sizeFrame = 0, lastHeight = 0;
function reportHeight() {
  if (sizeFrame) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    const height = Math.ceil(shell.getBoundingClientRect().height);
    if (height !== lastHeight) { lastHeight = height; rc.reportW2Height(height); }
  });
}
function measureDetail() {
  const height = Math.min($('detail').getBoundingClientRect().height, 260, Math.floor(availableHeight * .4));
  $('detailSection').style.setProperty('--detail-height', `${height}px`);
}
new ResizeObserver(reportHeight).observe(shell);
new ResizeObserver(measureDetail).observe($('detail'));
// 与 HTML 方案使用同一宽高规则；只在宽度变化时更新，避免高度动画反复触发布局。
let calendarWidth = 0, calendarSizeFrame = 0;
new ResizeObserver(() => {
  if (calendarSizeFrame) return;
  calendarSizeFrame = requestAnimationFrame(() => {
    calendarSizeFrame = 0;
    const width = cal.clientWidth;
    if (width === calendarWidth) return;
    calendarWidth = width;
    cal.style.setProperty('--week-height', `${Math.max(56, Math.round(width * .135))}px`);
  });
}).observe(cal);
rc.onW2Layout(({ maxHeight }) => {
  availableHeight = maxHeight;
  shell.style.setProperty('--available-height', `${maxHeight}px`);
  measureDetail();
  reportHeight();
});
rc.w2Ready();

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

// 页面只维护自己的输入锁；独立设置窗的暂停收起由主进程单独管理。
function refreshBlock() {
  const el = document.activeElement;
  const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  rc.setBlock(!!App.sel || TaskDialog.isOpen() || typing);
  shell.classList.toggle('editing', TaskDialog.isOpen() && !TaskDialog.confirmOpen());
}
document.addEventListener('focusin', refreshBlock);
document.addEventListener('focusout', () => setTimeout(refreshBlock, 0));

function render() {
  const s = App.state;
  if (!s) return;
  if (!App.view) { const t = D.parse(s.today); App.view = { y: t.getFullYear(), m: t.getMonth() }; }
  const { y, m } = App.view;
  $('monthLabel').textContent = `${y} 年 ${m + 1} 月`;
  renderCalendar(applyAppearance());
  const first = D.toStr(new Date(y, m, 1)), last = D.toStr(new Date(y, m + 1, 0));
  const monthTasks = s.tasks.filter(t => t.endDate >= first && t.startDate <= last);
  $('empty').hidden = monthTasks.length > 0;
  if (App.selectedId && !s.tasks.some(t => t.id === App.selectedId)) App.selectedId = null;
  K.markBars(cal, 'sel', App.selectedId);
  K.markBars(cal, 'hot', App.selectedId ? null : App.hoverId);
  renderDetail();
  renderReminders();
  if (App.sel) drawPreview();
}

function applyAppearance() {
  const ap = A.normalize({ ...App.state?.settings.w1.appearance, ...(appearancePreview || {}) });
  shell.style.setProperty('--date-size', `${ap.dateFontSize}px`);
  shell.style.setProperty('--detail-font-size', `${ap.detailFontSize}px`);
  shell.style.setProperty('--fg', ap.textColor);
  shell.style.setProperty('--fg2', C.rgba(ap.textColor, .72));
  shell.style.setProperty('--fg3', C.rgba(ap.textColor, .32));
  shell.style.setProperty('--weekend', ap.weekendColor);
  shell.style.setProperty('--weekend-out', C.rgba(ap.weekendColor, .55));
  const today = A.todayTone(ap.todayTone);
  shell.style.setProperty('--today-bg', today.fill);
  shell.style.setProperty('--today', today.ink);
  return ap;
}

function renderCalendar(ap) {
  const s = App.state, { y, m } = App.view;
  const key = JSON.stringify([y, m, s.today, s.tasks, ap.barHeight, ap.barFontSize]);
  // 字色和日期字号只更新样式，避免滑动时反复重建日历、打断悬停和选中。
  if (key === calendarKey) return;
  stopMonthMotion();
  calendarKey = key;
  cal.innerHTML = K.monthHTML({ year: y, month: m, tasks: s.tasks, today: s.today,
    barH: ap.barHeight, fontSize: ap.barFontSize, barRadius: 999, barGap: 5, barPadding: 8 });
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
  K.markBars(cal, 'sel', App.selectedId);
  K.markBars(cal, 'hot', App.selectedId ? null : App.hoverId);
  if (App.sel) drawPreview();
}

// 详情：悬停时临时预览；点选后一直显示到取消选中，并出现操作按钮
function renderDetail() {
  const s = App.state, id = App.selectedId || App.hoverId;
  const t = id && s.tasks.find(x => x.id === id);
  const box = $('detail');
  const section = $('detailSection');
  const actions = $('detailActions');
  if (!t) {
    shownDetailId = null;
    section.classList.remove('show');
    section.setAttribute('aria-hidden', 'true');
    // 保留内容直到收起完成，避免先清空内容导致动画跳变。
    section.inert = true;
    return;
  }

  const changed = shownDetailId && shownDetailId !== t.id;
  shownDetailId = t.id;
  box.classList.remove('swap');
  box.classList.toggle('selected', App.selectedId === t.id);
  box.innerHTML = `<div class="detail-title">${K.esc(t.title)}</div>`
    + `<div class="detail-meta">${D.rangeText(t.startDate, t.endDate)} · ${D.progressText(t, s.today)}</div>`
    + (t.note ? `<div class="detail-note">${K.esc(t.note)}</div>` : '');
  const tone = toneOf(t.done ? '#C3CCD2' : t.color);
  if (tone) {
    box.style.setProperty('--tone-bg', tone.bg);
    box.style.setProperty('--tone-ink', tone.ink);
    box.style.setProperty('--tone-soft', tone.soft);
    actions.style.setProperty('--tone-ink', tone.ink);
  }

  actions.hidden = App.selectedId !== t.id;
  actions.innerHTML = '';
  if (App.selectedId === t.id) {
    actions.innerHTML = '<button type="button" data-act="edit" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24"><path d="m15 5 4 4M5 19l1.2-4.2 8.5-8.5 3 3-8.5 8.5L5 19Z"/></svg></button>'
      + `<button type="button" data-act="done" class="${t.done ? 'on' : ''}" title="${t.done ? '取消完成' : '完成'}" aria-label="${t.done ? '取消完成' : '完成'}"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></button>`
      + '<button type="button" data-act="delete" class="danger" title="删除" aria-label="删除"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.8h4V7M7.5 7l.9 12.2h7.2L16.5 7"/></svg></button>';
  }
  box.hidden = false;
  measureDetail();
  section.classList.add('show');
  section.setAttribute('aria-hidden', 'false');
  section.inert = false;
  if (changed) {
    void box.offsetWidth;
    box.classList.add('swap');
  }
}

// 从日程条颜色推导详情卡的浅底、标题色和说明文字色。
function toneOf(color) {
  const hex = String(color || '').trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return null;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60);
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const sat = Math.round(Math.min(Math.max(s, .16), .6) * 100);
  return { bg: `hsl(${h} ${Math.round(sat * .9)}% 95%)`, ink: `hsl(${h} ${sat}% 32%)`, soft: `hsl(${h} ${Math.round(sat * .75)}% 45%)` };
}

$('detailActions').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  const t = b && App.state.tasks.find(x => x.id === App.selectedId);
  if (!t) return;
  const act = b.dataset.act;
  if (act === 'edit') TaskDialog.open({ mode: 'edit', task: t });
  else if (act === 'delete') TaskDialog.confirmDelete(t);
  else if (act === 'done') report(await rc.updateTask(t.id, { done: !t.done }), t.done ? '已取消完成' : '已标记完成');
});

// 提醒栏：列出还没确认的提醒，逐条点「知道了」
function layoutReminders(animate = false) {
  const section = $('reminderSection'), box = $('reminders');
  const cards = [...box.querySelectorAll('.rm-item')];
  const moving = animate && cards.length && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  queuedReminderDirection = 0;
  reminderWheelAmount = 0;
  reminderWheelTime = 0;
  // 从当前画面接着运动，快速反复点击时也不会跳回动画起点。
  const oldHeight = section.getBoundingClientRect().height;
  const before = moving ? cards.map(card => ({
    rect: card.getBoundingClientRect(), opacity: getComputedStyle(card).opacity
  })) : [];
  reminderAnimations.forEach(animation => animation.cancel());
  reminderAnimations = [];
  if (cards.length < 2) remindersExpanded = false;
  section.classList.remove('is-animating');
  section.classList.toggle('expanded', remindersExpanded);
  box.style.setProperty('--peek', cards.length > 2 ? '15px' : cards.length === 2 ? '8px' : '0px');
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
  // 叠放卡片轮换时高度不变，只在展开、收起时调整容器高度。
  if (Math.abs(newHeight - oldHeight) > .5) {
    section.classList.add('is-animating');
    reminderAnimations.push(section.animate([
      { height: `${oldHeight}px`, maxHeight: 'none' },
      { height: `${newHeight}px`, maxHeight: 'none' }
    ], timing));
  }
  cards.forEach((card, index) => {
    const from = before[index], to = targets[index];
    if (+from.opacity === 0 && +to.opacity === 0) return;
    const matrix = new DOMMatrix(to.transform === 'none' ? undefined : to.transform);
    const x = from.rect.left + from.rect.width / 2 - (to.rect.left + to.rect.width / 2 - matrix.e);
    const y = from.rect.top - (to.rect.top - matrix.f);
    const scaleX = from.rect.width / (to.rect.width / matrix.a);
    const scaleY = from.rect.height / (to.rect.height / matrix.d);
    reminderAnimations.push(card.animate([
      { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`, opacity: from.opacity },
      { transform: `translate(${matrix.e}px, ${matrix.f}px) scale(${matrix.a}, ${matrix.d})`, opacity: to.opacity }
    ], timing));
  });
  const animations = reminderAnimations;
  Promise.all(animations.map(animation => animation.finished)).then(() => {
    if (reminderAnimations !== animations) return;
    reminderAnimations = [];
    section.classList.remove('is-animating');
    const direction = queuedReminderDirection;
    queuedReminderDirection = 0;
    if (direction) cycleReminder(direction);
  }, () => {});
}

function cycleReminder(direction) {
  const count = $('reminders').children.length;
  if (remindersExpanded || count < 2) return;
  // 高频滚轮输入只保留下一步，不反复取消当前动画，也不积压长队列。
  if (reminderAnimations.length) {
    queuedReminderDirection = direction;
    return;
  }
  reminderIndex = (reminderIndex + direction + count) % count;
  layoutReminders(true);
}

function renderReminders() {
  const s = App.state, byId = new Map(s.tasks.map(t => [t.id, t]));
  const items = s.reminders
    .filter(r => !r.confirmed && byId.has(r.taskId) && !byId.get(r.taskId).done)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const html = items.map((r, index) => {
    const t = byId.get(r.taskId);
    return `<article class="rm-item" data-index="${index}" data-rid="${K.esc(r.id)}" tabindex="0">`
      + `<span class="rm-title">${K.esc(t.title)}</span>`
      + `<span class="rm-reason">${K.reminderReason(r.kind, t, s.today)}</span>`
      + `<div class="rm-bottom"><button type="button" class="rm-ok" data-rid="${K.esc(r.id)}" aria-label="确认提醒：${K.esc(t.title)}">知道了</button></div></article>`;
  }).join('');
  // 切月和无关状态更新时保留原卡片，避免重建后再次从透明状态进入。
  if (html === remindersHTML) return;
  remindersHTML = html;
  const box = $('reminders');
  box.hidden = !items.length;
  $('reminderSection').hidden = !items.length;
  if (!items.length) { remindersExpanded = false; reminderIndex = 0; box.innerHTML = ''; layoutReminders(); return; }
  $('reminderHead').textContent = `待确认提醒 ${items.length} 条`;
  reminderIndex = Math.max(0, Math.min(reminderIndex, items.length - 1));
  box.innerHTML = html;
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
  const box = $('reminders');
  if (remindersExpanded || box.children.length < 2 || !e.deltaY) return;
  e.preventDefault();
  e.stopPropagation();
  const now = performance.now();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1);
  if (now - reminderWheelTime > 160 || Math.sign(delta) !== Math.sign(reminderWheelAmount)) reminderWheelAmount = 0;
  reminderWheelTime = now;
  reminderWheelAmount += delta;
  // 累积触控板的细碎增量，避免惯性尾段每一帧都切换一张。
  if (Math.abs(reminderWheelAmount) < 32) return;
  reminderWheelAmount = 0;
  cycleReminder(Math.sign(delta));
}, { passive: false });

$('reminders').addEventListener('keydown', e => {
  const card = e.target.closest('.rm-item');
  if (!card || e.target.closest('.rm-ok') || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  reminderIndex = +card.dataset.index;
  remindersExpanded = !remindersExpanded;
  layoutReminders(true);
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

function stopMonthMotion() {
  if (!monthMotion) return;
  const motion = monthMotion;
  monthMotion = null;
  motion.animations.forEach(animation => animation.cancel());
  motion.ghost.remove();
  monthStage.classList.remove('is-turning');
  monthPage.inert = false;
}

function changeMonth(y, m) {
  if (!App.state || !App.view) return Promise.resolve();
  const direction = Math.sign((y - App.view.y) * 12 + m - App.view.m);
  const moving = direction && monthPage.offsetHeight > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fromStyle = getComputedStyle(monthPage);
  const from = { transform: fromStyle.transform, opacity: fromStyle.opacity };
  const oldHeight = monthStage.getBoundingClientRect().height;
  const ghost = moving ? monthPage.cloneNode(true) : null;
  stopMonthMotion();
  App.view = { y, m };
  App.hoverId = null;
  App.selectedId = null;
  clearSelection();
  render();
  if (!moving) return Promise.resolve();

  // 旧月只作视觉叠层，不保留重复 ID 或可交互控件。
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  ghost.classList.add('month-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  monthStage.appendChild(ghost);
  const newHeight = monthPage.offsetHeight;
  monthStage.classList.add('is-turning');
  monthPage.inert = true;
  const timing = { duration: 360, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' };
  const motion = { ghost, animations: [] };
  monthMotion = motion;
  motion.animations.push(
    ghost.animate([
      { ...from, boxShadow: '0 0 0 #31587300' },
      { transform: `translateX(${-direction * 14}%) translateZ(24px) rotateY(${direction * 9}deg) scale(.96)`, opacity: 0, boxShadow: '0 8px 24px #31587320' },
    ], timing),
    monthPage.animate([
      { transform: `translateX(${direction * 10}%) translateZ(-50px) rotateY(${-direction * 7}deg) scale(.97)`, opacity: .45 },
      { transform: 'none', opacity: 1 },
    ], timing),
    monthStage.animate([{ height: `${oldHeight}px` }, { height: `${newHeight}px` }], timing),
    $('monthLabel').animate([
      { transform: `translateY(${direction * 5}px)`, opacity: .4 },
      { transform: 'none', opacity: 1 },
    ], { ...timing, duration: 240 }),
  );
  // 连续切月从当前画面接着翻；取消旧动画不会清掉新的一轮。
  return Promise.allSettled(motion.animations.map(animation => animation.finished)).then(() => {
    if (monthMotion === motion) stopMonthMotion();
  });
}

function shiftMonth(n) {
  if (!App.view) return;
  const d = new Date(App.view.y, App.view.m + n, 1);
  changeMonth(d.getFullYear(), d.getMonth());
}

function goToday() {
  if (!App.state) return;
  const t = D.parse(App.state.today);
  const y = t.getFullYear(), m = t.getMonth();
  changeMonth(y, m).then(() => {
    if (App.view.y === y && App.view.m === m) cal.querySelector('.cal-dc.today')?.scrollIntoView({ block: 'nearest' });
  });
}

// 直接新建默认今天；查看其他月份时默认该月 1 日，日期仍可修改。
function newTask() {
  if (TaskDialog.isOpen() || !App.state) return;
  Settings.close({ animate: false, restoreFocus: false });
  clearSelection();
  select(null);
  const today = D.parse(App.state.today), { y, m } = App.view;
  const day = y === today.getFullYear() && m === today.getMonth() ? App.state.today : D.toStr(new Date(y, m, 1));
  TaskDialog.open({ mode: 'new', start: day, end: day });
}

// 日历本身即可选日期；已有日程条保留查看详情的点击行为。
function dayAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const week = el && el.closest('.cal-week');
  if (!week || !cal.contains(week)) return null;
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
    const dates = week.querySelector('.cal-dates');
    div.style.cssText = `left:calc(${i * 100 / 7}% + 2px);width:calc(${(j - i + 1) * 100 / 7}% - 4px);top:${dates.offsetTop}px;height:${dates.offsetHeight}px`;
    week.appendChild(div);
  });
  const label = $('daylabel');
  label.textContent = `${D.diff(a, b) + 1} 天`;
  if (e) { label.style.left = `${Math.min(e.clientX + 14, innerWidth - 74)}px`; label.style.top = `${Math.min(e.clientY + 12, innerHeight - 32)}px`; }
  label.hidden = false;
}

function clearSelection() {
  App.sel = null;
  const pointerId = datePointerId;
  datePointerId = null;
  if (pointerId !== null && calwrap.hasPointerCapture(pointerId)) calwrap.releasePointerCapture(pointerId);
  calwrap.classList.remove('selecting');
  markHoverDay(null);
  cal.querySelectorAll('.cal-preview').forEach(n => n.remove());
  $('daylabel').hidden = true;
  refreshBlock();
}

calwrap.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary || datePointerId !== null || !App.state
    || TaskDialog.isOpen() || Settings.isOpen() || e.target.closest('.cal-bar')) return;
  const day = dayAt(e.clientX, e.clientY);
  if (!day) return;
  e.preventDefault();
  datePointerId = e.pointerId;
  App.sel = { a: day, b: day };
  calwrap.setPointerCapture(e.pointerId);
  select(null);
  markHoverDay(null);
  calwrap.classList.add('selecting');
  refreshBlock();
  drawPreview(e);
});

calwrap.addEventListener('pointermove', e => {
  if (App.sel && e.pointerId === datePointerId) {
    const day = dayAt(e.clientX, e.clientY);
    if (day) App.sel.b = day;   // 拖出日历区域：保留最后经过的那一天
    drawPreview(e);
    return;
  }
  if (e.buttons || TaskDialog.isOpen() || Settings.isOpen()) return;
  const bar = e.target.closest('.cal-bar');
  markHoverDay(bar ? null : dayAt(e.clientX, e.clientY));
  if (!App.selectedId) setHover(bar ? bar.dataset.id : null);
});

calwrap.addEventListener('pointerup', e => {
  if (e.button !== 0 || e.pointerId !== datePointerId || !App.sel) return;
  const day = dayAt(e.clientX, e.clientY);
  if (day) App.sel.b = day;
  const [a, b] = ordered();
  // 先打开弹窗再结束拖选，使阻止自动收起的状态不中断。
  TaskDialog.open({ mode: 'new', start: a, end: b });
  clearSelection();
});

calwrap.addEventListener('pointerleave', () => {
  if (App.sel) return;
  if (!App.selectedId) setHover(null);
  markHoverDay(null);
});
calwrap.addEventListener('contextmenu', e => { if (App.sel) { e.preventDefault(); clearSelection(); } });
for (const type of ['pointercancel', 'lostpointercapture']) {
  calwrap.addEventListener(type, e => { if (e.pointerId === datePointerId) clearSelection(); });
}
window.addEventListener('blur', clearSelection);
cal.addEventListener('keydown', e => {
  const bar = e.target.closest('.cal-bar');
  if (bar && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (!App.sel) select(bar.dataset.id);
  }
});
cal.addEventListener('click', e => {
  if (App.sel || TaskDialog.isOpen() || Settings.isOpen()) return;
  const bar = e.target.closest('.cal-bar');
  if (bar) select(bar.dataset.id);
});

// 打开设置时保留固定的详情，方便即时调整字号；其他空白区域仍可收起。
document.addEventListener('click', e => {
  if (!App.selectedId || e.target.closest('.cal-bar, .detail-section, .overlay, .page, #settingsBtn')) return;
  select(null);
});

// —— 月份与快捷操作 ——
$('prevBtn').addEventListener('click', () => shiftMonth(-1));
$('nextBtn').addEventListener('click', () => shiftMonth(1));
$('todayBtn').addEventListener('click', goToday);
$('newBtn').addEventListener('click', newTask);
$('emptyNewBtn').addEventListener('click', newTask);
$('settingsBtn').addEventListener('click', () => Settings.open());
$('closeBtn').addEventListener('click', () => rc.hideW2());

// —— 键盘 ——
document.addEventListener('keydown', e => {
  if (TaskDialog.confirmOpen()) return;   // 删除确认框自己处理 Esc
  if (e.key === 'Escape') {
    if (TaskDialog.isOpen()) return;        // 填写弹窗里按 Esc 不关闭
    if (Settings.isOpen()) Settings.close();
    else if (App.sel) { e.preventDefault(); clearSelection(); }
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
  else if (cmd.type === 'discard') { TaskDialog.discard(); Settings.close({ animate: false, restoreFocus: false }); clearSelection(); }
});

// 主窗口收回后解除详情固定；再次展开时保持详情隐藏。
rc.onW2Retracted?.(() => select(null));

rc.onState(s => { App.state = s; render(); });
rc.onW2Preview?.(ap => {
  appearancePreview = ap;
  if (appearanceFrame) return;
  appearanceFrame = requestAnimationFrame(() => {
    appearanceFrame = 0;
    if (!App.state || !App.view) return;
    renderCalendar(applyAppearance());
    measureDetail();
    reportHeight();
  });
});
rc.getState().then(s => { App.state = s; render(); });

window.W2App = { App, toast, report, refreshBlock, render, select, clearSelection };
