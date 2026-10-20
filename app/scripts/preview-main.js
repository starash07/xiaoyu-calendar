// 将实际主界面打包成单文件交互预览。示例数据只在内存中修改。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DEFAULT_SETTINGS } = require('../main/store');

const root = path.resolve(__dirname, '..', '..');
const renderer = path.join(root, 'app', 'renderer', 'w2');
const output = path.join(root, '设计', '主界面预览.html');

function previewApi(settings) {
  const D = window.RCDates;
  const today = D.today(), date = D.parse(today), year = date.getFullYear(), month = date.getMonth();
  const day = n => D.toStr(new Date(year, month, n));
  const rows = [
    ['整理本月计划', 1, 3, '#B6D9EC', '留出一点弹性，先安排最重要的几件事。', false, true],
    ['阅读 · 一本新书', 3, 6, '#C8C4ED', '每天读一点，记下喜欢的句子。'],
    ['项目方案整理', 7, 10, '#A7D7C7', '梳理需求，整理参考资料。\n周四前完成第一版。', true],
    ['和朋友吃饭', 12, 12, '#F3BDAD', '提前订好位置。'],
    ['新界面设计', 14, 20, '#B7DCEF', '整理功能，画出主界面，再一起看看实际效果。\n\n白底、柔和的蓝色文字，留一点活泼的颜色。', true],
    ['整理照片', 16, 16, '#D0C8E9', '选出最喜欢的几张。'],
    ['周末出游', 19, 20, '#F4D691', '带上相机和水。'],
    ['完成本月复盘', 24, 26, '#B1DACA', '看看哪些事情做得不错，哪些可以慢一点。'],
    ['假期准备', 28, 33, '#F2BEAE', '确认行程，收拾行李。'],
  ];
  let state = {
    today, settings, w1: { pinned: false, embedded: false, degraded: false, glass: { mode: 'none', available: false } },
    tasks: rows.map(([title, a, b, color, note, pinned, done], i) => ({
      id: `preview-${i}`, title, startDate: day(a), endDate: day(b), color, note,
      pinned: !!pinned, done: !!done, remind: null, createdAt: new Date(2026, 0, 1, 0, i).toISOString(), updatedAt: new Date().toISOString(),
    })),
    reminders: [],
  };
  // 三条未确认记录用于查看密度；日期和原因仍根据真实日期计算。
  state.reminders = [4, 6, 7].map((n, i) => ({ id: `reminder-${i}`, taskId: `preview-${n}`, kind: i ? 'startBefore' : 'endDay', day: today, confirmed: false }));
  const listeners = [];
  const push = () => { for (const fn of listeners) fn(structuredClone(state)); };
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k]) merge(a[k], v);
      else a[k] = v;
    }
  };
  const ok = () => ({ ok: true });
  let layoutListener = () => {};
  const layout = () => layoutListener({ maxHeight: Math.max(160, innerHeight - 36) });
  addEventListener('resize', layout);
  window.rc = {
    getState: async () => structuredClone(state),
    onState: fn => { listeners.push(fn); }, onCommand: () => {},
    onW2Layout: fn => { layoutListener = fn; }, w2Ready: layout, reportW2Height: () => {},
    setBlock: () => {}, w2Drag: () => {}, previewAppearance: () => {},
    hideW2: () => window.W2App.toast('这是交互预览，关闭此标签页即可退出'),
    createTask: async task => {
      const id = crypto.randomUUID();
      state.tasks.push({ ...task, id, done: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      state.settings.lastColor = task.color;
      push(); return { ok: true, id };
    },
    updateTask: async (id, patch) => {
      const task = state.tasks.find(t => t.id === id);
      if (!task) return { ok: false };
      Object.assign(task, patch);
      if (task.done) state.reminders = state.reminders.filter(r => r.taskId !== id || r.confirmed);
      push(); return ok();
    },
    deleteTask: async id => {
      state.tasks = state.tasks.filter(t => t.id !== id);
      state.reminders = state.reminders.filter(r => r.taskId !== id);
      push(); return ok();
    },
    confirmReminder: async id => { state.reminders.find(r => r.id === id).confirmed = true; push(); return ok(); },
    saveSettings: async patch => { merge(state.settings, patch); push(); return ok(); },
    setPinned: async pinned => { state.w1.pinned = pinned; push(); return ok(); },
    resetW1: async () => ok(),
    setAutoStart: async on => { state.settings.general.autoStart = on; push(); return ok(); },
  };
}

function build() {
  let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  html = html.replace('<title>小鱼日程表</title>', '<title>小鱼日程表 · 主界面交互预览</title>');
  html = html.replace('把日子安排好', '交互预览 · 数据不保存');
  html = html.replace('</head>', '<style>html { background: #ffffff; } body { width: min(480px, calc(100% - 32px)); margin: 18px auto; overflow: visible; }</style></head>');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) => {
    const cssPath = path.resolve(renderer, file);
    // 本地 SVG（如自定义光标）一起打包，预览仍可独立打开。
    const css = fs.readFileSync(cssPath, 'utf8').replace(/url\("([^"]+\.svg)"\)/g, (_match, asset) =>
      `url("data:image/svg+xml;base64,${fs.readFileSync(path.resolve(path.dirname(cssPath), asset)).toString('base64')}")`);
    return `<style>${css}</style>`;
  });
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) => {
    const bridge = file === 'w2.js' ? `<script>(${previewApi.toString()})(${JSON.stringify(DEFAULT_SETTINGS)});</script>` : '';
    return bridge + '<script>' + fs.readFileSync(path.resolve(renderer, file), 'utf8').replace(/<\/script/gi, '<\\/script') + '</script>';
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  return html;
}

build();
console.log(output);
if (process.argv.includes('--serve')) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(build());
  });
  server.listen(0, '127.0.0.1', () => console.log(`PREVIEW_URL=http://127.0.0.1:${server.address().port}`));
}
