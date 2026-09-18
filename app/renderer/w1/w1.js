// W1 桌面挂件页面：只显示当月未完成的日程；只响应悬停，悬停时详情在日历下方浮现
const D = RCDates, C = RCColors, K = RCCal;
const $ = id => document.getElementById(id);
const panel = $('panel'), cal = $('cal'), detail = $('detail'), bg = $('bg'), tint = $('tint');

let state = null;      // 主进程推来的数据
let info = null;       // 窗口位置、是否钉住、壁纸
let preview = null;    // 设置页拖滑块时的临时外观
let hoverId = null;
let wallImg = null, wallUrl = '';

const appearance = () => ({ ...state.settings.w1.appearance, ...(preview || {}) });

function applyAppearance() {
  const ap = appearance();
  panel.style.setProperty('--w', `${ap.width}px`);
  panel.style.setProperty('--blur', `${ap.blur}px`);
  tint.style.background = C.rgba(ap.panelColor, ap.panelOpacity / 100);
  for (const [k, v] of Object.entries(C.textTokens(ap.textColor))) panel.style.setProperty(`--${k}`, v);
}

function render() {
  if (!state) return;
  applyAppearance();
  const ap = appearance();
  const t = D.parse(state.today);
  $('title').textContent = `${t.getFullYear()} 年 ${t.getMonth() + 1} 月`;
  cal.innerHTML = K.monthHTML({
    year: t.getFullYear(), month: t.getMonth(), tasks: state.tasks.filter(x => !x.done),
    today: state.today, barH: ap.barHeight, fontSize: ap.barFontSize,
  });
  K.markBars(cal, 'hot', hoverId);
  renderDetail();
  renderFlag();
  placeWallpaper();
}

function renderDetail() {
  const task = hoverId && state.tasks.find(x => x.id === hoverId && !x.done);
  detail.hidden = !task;
  detail.innerHTML = task ? K.detailHTML(task, state.today) : '';
}

function renderFlag() {
  const open = new Set(state.tasks.filter(x => !x.done).map(x => x.id));
  const n = state.reminders.filter(r => !r.confirmed && open.has(r.taskId)).length;
  $('flag').hidden = !n;
  $('flag').textContent = n > 9 ? '9+' : String(n);
  if (!n) $('flagTip').hidden = true;
}

function setHover(id) {
  if (id === hoverId) return;
  hoverId = id;
  K.markBars(cal, 'hot', id);
  renderDetail();
}

// 悬停判断：钉住时坐标来自主进程的光标轮询，摆放中来自页面自己的鼠标事件
function hitTest(x, y) {
  if (x < 0) { setHover(null); $('flagTip').hidden = true; return; }
  const el = document.elementFromPoint(x, y);
  const bar = el && el.closest('.cal-bar');
  setHover(bar ? bar.dataset.id : null);
  $('flagTip').hidden = !(el && el.closest('#flag'));
}

// 把模糊背景和真实壁纸对齐：算出壁纸在屏幕上的实际位置，再换成相对 .bg 的偏移
function placeWallpaper() {
  const w = info && info.wallpaper;
  if (!w) { bg.style.backgroundImage = ''; return; }
  if (w.url !== wallUrl) {
    wallUrl = w.url;
    wallImg = new Image();
    wallImg.onload = placeWallpaper;
    wallImg.src = w.url;
    bg.style.backgroundImage = `url("${w.url}")`;
  }
  if (!wallImg || !wallImg.naturalWidth) return;
  const S = info.display, iw = wallImg.naturalWidth, ih = wallImg.naturalHeight;
  let r;
  if (w.fit === 'stretch') r = { x: S.x, y: S.y, w: S.width, h: S.height };
  else if (w.fit === 'center') r = { x: S.x + (S.width - iw) / 2, y: S.y + (S.height - ih) / 2, w: iw, h: ih };
  else if (w.fit === 'tile') r = { x: S.x, y: S.y, w: iw, h: ih, tile: true };
  else {
    const k = w.fit === 'fit' ? Math.min(S.width / iw, S.height / ih) : Math.max(S.width / iw, S.height / ih);
    r = { x: S.x + (S.width - iw * k) / 2, y: S.y + (S.height - ih * k) / 2, w: iw * k, h: ih * k };
  }
  const pr = panel.getBoundingClientRect();
  const ox = info.pos.x + pr.left + 1 - 40, oy = info.pos.y + pr.top + 1 - 40;   // .bg 向外扩了 40px，边框 1px
  bg.style.backgroundSize = `${r.w}px ${r.h}px`;
  bg.style.backgroundPosition = `${r.x - ox}px ${r.y - oy}px`;
  bg.style.backgroundRepeat = r.tile ? 'repeat' : 'no-repeat';
}

// 内容大小变了就告诉主进程：窗口顶部不动，底边跟着伸缩
new ResizeObserver(() => {
  const r = panel.getBoundingClientRect();
  rc.reportSize(r.width + 16, r.height + 16);
}).observe(panel);

rc.onState(s => { state = s; preview = null; render(); });
rc.onPreview(ap => { preview = ap; if (state) render(); });
rc.onCursor(({ x, y }) => hitTest(x, y));
rc.onW1Info(i => {
  info = i;
  panel.classList.toggle('loose', i.loose);
  placeWallpaper();
});

panel.addEventListener('mousemove', e => { if (info && !info.embedded) hitTest(e.clientX, e.clientY); });
panel.addEventListener('mouseleave', () => { if (info && !info.embedded) hitTest(-1, -1); });
panel.addEventListener('mousedown', e => {
  if (!info || !info.loose || e.button !== 0 || e.target.closest('button')) return;
  rc.w1Drag();
});
$('pinBtn').addEventListener('click', () => rc.setPinned(true));

rc.getState().then(s => { state = s; render(); });
rc.w1Ready();
