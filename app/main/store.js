// 数据读写：每次改动立即保存。先写临时文件再替换，替换前把原文件留成 .bak；文件读坏了从 .bak 恢复。
// 所有修改都在副本上做，写成功了才替换内存里的数据；写失败则保持原状态。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const D = require('../renderer/shared/dates');
const C = require('../renderer/shared/colors');
const R = require('./reminders');

const clone = o => JSON.parse(JSON.stringify(o));
const now = () => new Date().toISOString();
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const stamp = () => now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const DEFAULT_SETTINGS = {
  version: 1,
  w1: {
    pinned: false, x: null, y: null,
    // 字体颜色的初始默认值要在 Demo 里调，这里先用白色
    appearance: { panelColor: '#000000', panelOpacity: 28, blur: 14, textColor: '#FFFFFF', barFontSize: 10, barHeight: 12, width: 420 },
  },
  w2: { dock: null, x: null, y: null, width: 480, height: 720, theme: 'light' },
  // 统一提醒选项。默认勾哪些、提前几天还没定，这里是 Demo 的临时默认
  reminder: { startBefore: { on: true, days: 1 }, startDay: true, endBefore: { on: false, days: 1 }, endDay: true },
  // 开机自启：Demo 默认不开，免得往系统启动项里写东西；托盘菜单里可以打开
  general: { autoStart: false, onboardingDone: false },
  recentColors: [],
  lastColor: null,
};

function merge(base, extra) {
  const out = clone(base);
  for (const [k, v] of Object.entries(extra || {})) {
    const both = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]);
    out[k] = both ? merge(out[k], v) : v;
  }
  return out;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return { data: clone(fallback), recovered: null };
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), recovered: null };
  } catch (e) {
    try { fs.renameSync(file, file.replace(/\.json$/, `.broken-${stamp()}.json`)); } catch (_) { /* 改名失败也继续 */ }
    try { return { data: JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), recovered: 'bak' }; }
    catch (_) { return { data: clone(fallback), recovered: 'empty' }; }
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 5) throw e;   // 被占用时每隔 200ms 重试，最多 5 次
      sleep(200);
    }
  }
}

class UserError extends Error {}
const fail = e => ({ ok: false, error: e instanceof UserError ? e.message : '保存失败' });

function cleanRemind(r) {
  if (!r) return null;   // null 表示沿用统一设置
  const days = v => Math.max(1, Math.min(365, Math.round(Number(v) || 1)));
  const side = s => ({ on: !!(s && s.on), days: days(s && s.days) });
  return { startBefore: side(r.startBefore), startDay: !!r.startDay, endBefore: side(r.endBefore), endDay: !!r.endDay };
}

function cleanTask(t) {
  const title = String(t.title || '').replace(/[\r\n]+/g, ' ').trim();
  if (!title) throw new UserError('标题不能为空');
  if (title.length > 50) throw new UserError('标题最多 50 个字符');
  if (!D.isValid(t.startDate) || !D.isValid(t.endDate)) throw new UserError('日期格式不对');
  if (t.endDate < t.startDate) throw new UserError('结束日期不能早于开始日期');
  if (!C.isHex(t.color)) throw new UserError('颜色格式不对');
  const note = String(t.note || '');
  if (note.length > 500) throw new UserError('备注最多 500 个字符');
  return {
    id: t.id, title, startDate: t.startDate, endDate: t.endDate, color: t.color.toUpperCase(), note,
    pinned: !!t.pinned, done: !!t.done, remind: cleanRemind(t.remind), createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

class Store {
  constructor() {
    fs.mkdirSync(P.DATA, { recursive: true });
    this.firstRun = !fs.existsSync(P.SETTINGS);
    const t = readJson(P.TASKS, { version: 1, tasks: [] });
    const s = readJson(P.SETTINGS, DEFAULT_SETTINGS);
    const r = readJson(P.REMINDERS, { version: 1, lastRefreshDate: null, items: [] });
    this.tasks = Array.isArray(t.data.tasks) ? t.data.tasks : [];
    this.settings = merge(DEFAULT_SETTINGS, s.data);
    this.reminders = { lastRefreshDate: r.data.lastRefreshDate || null, items: Array.isArray(r.data.items) ? r.data.items : [] };
    this.recovered = [['日程', t.recovered], ['设置', s.recovered], ['提醒记录', r.recovered]].filter(([, how]) => how);
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }

  snapshot() {
    return { tasks: this.tasks, settings: this.settings, reminders: this.reminders.items, today: D.today() };
  }

  commit({ tasks, settings, reminders }) {
    try {
      if (tasks) writeJson(P.TASKS, { version: 1, tasks });
      if (settings) writeJson(P.SETTINGS, settings);
      if (reminders) writeJson(P.REMINDERS, { version: 1, ...reminders });
    } catch (e) {
      console.error('[store] 保存失败', e);
      return { ok: false, error: '保存失败' };
    }
    if (tasks) this.tasks = tasks;
    if (settings) this.settings = settings;
    if (reminders) this.reminders = reminders;
    for (const fn of this.listeners) fn();
    return { ok: true };
  }

  regenerate(tasks, settings, reminders, day = D.today()) {
    return { lastRefreshDate: day, items: [...reminders.items, ...R.generate(tasks, settings, reminders.items, day)] };
  }

  // 记下用过的颜色：最近使用最多 8 个、不含预设色；另记最后一次用的颜色给新建弹窗当默认
  withColor(settings, color) {
    const isPreset = C.PRESETS.some(([, hex]) => hex === color);
    const recent = isPreset ? settings.recentColors : [color, ...settings.recentColors.filter(c => c !== color)].slice(0, 8);
    return { ...settings, recentColors: recent, lastColor: color };
  }

  createTask(input) {
    let task;
    try { task = cleanTask({ ...input, id: crypto.randomUUID(), done: false, createdAt: now(), updatedAt: now() }); }
    catch (e) { return fail(e); }
    const tasks = [...this.tasks, task];
    const settings = this.withColor(this.settings, task.color);
    const res = this.commit({ tasks, settings, reminders: this.regenerate(tasks, settings, this.reminders) });
    return res.ok ? { ok: true, id: task.id } : res;
  }

  updateTask(id, patch) {
    const old = this.tasks.find(t => t.id === id);
    if (!old) return { ok: false, error: '这条日程已经不存在了' };
    let task;
    try { task = cleanTask({ ...old, ...patch, id, createdAt: old.createdAt, updatedAt: now() }); }
    catch (e) { return fail(e); }
    const tasks = this.tasks.map(t => (t.id === id ? task : t));
    let items = this.reminders.items;
    const rescheduled = old.startDate !== task.startDate || old.endDate !== task.endDate
      || JSON.stringify(old.remind) !== JSON.stringify(task.remind);
    // 完成后不再提醒，还没确认的一并移除；改期后旧的未确认提醒 Demo 里先去掉（怎么处理待确认）
    if (task.done || rescheduled) items = items.filter(r => !(r.taskId === id && !r.confirmed));
    const settings = patch.color ? this.withColor(this.settings, task.color) : null;
    return this.commit({ tasks, settings, reminders: this.regenerate(tasks, settings || this.settings, { ...this.reminders, items }) });
  }

  deleteTask(id) {
    const tasks = this.tasks.filter(t => t.id !== id);
    return this.commit({ tasks, reminders: { ...this.reminders, items: this.reminders.items.filter(r => r.taskId !== id) } });
  }

  confirmReminder(id) {
    const items = this.reminders.items.map(r => (r.id === id ? { ...r, confirmed: true, confirmedAt: now() } : r));
    return this.commit({ reminders: { ...this.reminders, items } });
  }

  saveSettings(patch) {
    const settings = merge(this.settings, patch);
    const reminders = patch.reminder ? this.regenerate(this.tasks, settings, this.reminders) : null;
    return this.commit({ settings, reminders });
  }

  refreshReminders(day = D.today()) {
    return this.commit({ reminders: this.regenerate(this.tasks, this.settings, this.reminders, day) });
  }

  // Demo 用：按当前月份放一批示例日程，方便看效果
  loadSamples() {
    const t = D.parse(D.today()), y = t.getFullYear(), m = t.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    const d = n => D.toStr(new Date(y, m, Math.min(n, last)));
    const nd = n => D.toStr(new Date(y, m + 1, n));
    const rows = [
      ['产品评审', d(2), d(4), '#AFA9EC', '会议室 B，带上原型 v3'],
      ['部门周会', d(4), d(4), '#EF9F27', '14:00，轮到我做分享'],
      ['出差 · 上海', d(8), d(11), '#F0997B', '虹桥 → 客户现场\n酒店已订，发票找行政'],
      ['写周报', d(11), d(11), '#EF9F27', '18:00 前发出'],
      ['设计终稿交付', d(14), d(22), '#5DCAA5', '等品牌那边回色卡，回来就出终稿', true],
      ['双周迭代 S12', d(16), d(18), '#85B7EB', '评审放在周五上午'],
      ['体检', d(17), d(17), '#ED93B1', '空腹，8:30 前到'],
      ['团建', d(18), d(18), '#FAC775', '下午出发，记得带外套'],
      ['牙医复诊', d(18), d(18), '#97C459', '19:30'],
      ['中秋', d(25), d(25), '#A32D2D', '回家吃饭'],
      ['国庆物料准备', d(28), nd(2), '#97C459', '海报两版 + 长图一张'],
      ['月度复盘', d(30), d(30), '#534AB7', '整理本月数据和下月计划'],
      ['提交报销单', d(1), d(3), '#85B7EB', '已经交了', false, true],
    ];
    const stampNow = now();
    const samples = rows.map(([title, startDate, endDate, color, note, pinned, done], i) => cleanTask({
      id: crypto.randomUUID(), title, startDate, endDate, color, note, pinned, done,
      createdAt: new Date(Date.parse(stampNow) + i).toISOString(), updatedAt: stampNow,
    }));
    const tasks = [...this.tasks, ...samples];   // 追加，不覆盖已有日程
    return this.commit({ tasks, reminders: this.regenerate(tasks, this.settings, this.reminders) });
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
