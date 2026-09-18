// 日期工具：日程只精确到天，统一用 'YYYY-MM-DD' 字符串。主进程和页面共用这一份。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RCDates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
  // b 减 a 的天数；四舍五入避开夏令时的 23/25 小时
  const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const today = () => toStr(new Date());
  const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const ymd = s => { const d = parse(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  const WEEK = '日一二三四五六';
  const weekday = s => WEEK[parse(s).getDay()];
  const isValid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(parse(s)) === s;

  // 月网格：周一开头，第一周和最后一周不满的部分用相邻月份的日期补齐
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    return { start: toStr(new Date(year, month, 1 - lead)), weeks: Math.ceil((lead + days) / 7) };
  }

  // 详情里的日期：单日「9/11」，多日「9/14 – 9/22」，跨年时带年份
  function rangeText(start, end) {
    if (start === end) return md(start);
    if (start.slice(0, 4) !== end.slice(0, 4)) return `${ymd(start)} – ${ymd(end)}`;
    return `${md(start)} – ${md(end)}`;
  }

  // 进度文案（需求 3.2 日程详情）
  function progressText(task, day) {
    const total = diff(task.startDate, task.endDate) + 1;
    const single = total === 1;
    if (task.done) return single ? '已完成' : `已完成 · 共 ${total} 天`;
    if (day < task.startDate) {
      const n = diff(day, task.startDate);
      return single ? `${n} 天后` : `${n} 天后开始 · 共 ${total} 天`;
    }
    if (day > task.endDate) return single ? '已结束' : `已结束 · 共 ${total} 天`;
    return single ? '就是今天' : `第 ${diff(task.startDate, day) + 1} 天 / 共 ${total} 天`;
  }

  return { pad, toStr, parse, addDays, diff, today, md, ymd, weekday, isValid, monthGrid, rangeText, progressText };
});
