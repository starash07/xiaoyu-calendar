// 提醒生成：只按天，开始 / 结束两头各有「提前 x 天」和「当天」两个选项，可以同时勾
const D = require('../renderer/shared/dates');

const KINDS = ['startBefore', 'startDay', 'endBefore', 'endDay'];

// 日程单独设过就用自己的，否则沿用设置里的统一选项
const optionsFor = (task, settings) => task.remind || settings.reminder;

function dueKinds(task, o, day) {
  const out = [];
  if (o.startBefore && o.startBefore.on && o.startBefore.days >= 1 && D.addDays(task.startDate, -o.startBefore.days) === day) out.push('startBefore');
  if (o.startDay && task.startDate === day) out.push('startDay');
  if (o.endBefore && o.endBefore.on && o.endBefore.days >= 1 && D.addDays(task.endDate, -o.endBefore.days) === day) out.push('endBefore');
  if (o.endDay && task.endDate === day) out.push('endDay');
  // 单日日程的「开始当天」和「结束当天」落在同一天：Demo 里先合并成一条（是否合并待确认）
  if (task.startDate === task.endDate && out.includes('startDay') && out.includes('endDay')) out.splice(out.indexOf('endDay'), 1);
  return out;
}

// 生成某一天该出的提醒；已经生成过的（不管确认没确认）不重复生成
function generate(tasks, settings, items, day) {
  const seen = new Set(items.map(r => r.id));
  const added = [];
  for (const t of tasks) {
    if (t.done) continue;   // 已完成的日程不再提醒
    for (const kind of dueKinds(t, optionsFor(t, settings), day)) {
      const id = `${t.id}|${kind}|${day}`;
      if (seen.has(id)) continue;
      seen.add(id);
      added.push({ id, taskId: t.id, kind, day, confirmed: false, createdAt: new Date().toISOString() });
    }
  }
  return added;
}

module.exports = { KINDS, optionsFor, dueKinds, generate };
