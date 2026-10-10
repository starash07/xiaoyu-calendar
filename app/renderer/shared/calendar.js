// 整月日历 + 甘特条：W1、W2 共用的排版和渲染
(function (root) {
  const D = root.RCDates, C = root.RCColors;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 排序：置顶 → 开始早 → 跨度长 → 创建早
  function cmp(p, q) {
    return (q.pinned ? 1 : 0) - (p.pinned ? 1 : 0)
      || (p.startDate < q.startDate ? -1 : p.startDate > q.startDate ? 1 : 0)
      || (D.diff(q.startDate, q.endDate) - D.diff(p.startDate, p.endDate))
      || String(p.createdAt).localeCompare(String(q.createdAt));
  }

  // 把一组日程放进这一周的泳道：每个分段放进最靠上、在它覆盖的几天里还空着的那一行
  function place(list, ws, we, occ, base, segs) {
    for (const t of list) {
      if (t.endDate < ws || t.startDate > we) continue;
      const a = Math.max(0, D.diff(ws, t.startDate));
      const b = Math.min(6, D.diff(ws, t.endDate));
      let lane = base;
      while (occ[lane] && occ[lane].some(([x, y]) => a <= y && b >= x)) lane++;
      (occ[lane] = occ[lane] || []).push([a, b]);
      segs.push({ task: t, a, b, lane, cl: t.startDate < ws, cr: t.endDate > we });
    }
  }

  // 一周的泳道：未完成的先排；已完成的只能排在未完成的下面，不插到上面的空位
  function layoutWeek(tasks, ws) {
    const we = D.addDays(ws, 6);
    const open = tasks.filter(t => !t.done).sort(cmp);
    const done = tasks.filter(t => t.done).sort(cmp);
    const occ = [], segs = [];
    place(open, ws, we, occ, 0, segs);
    place(done, ws, we, occ, occ.length, segs);
    return { segs, lanes: occ.length };
  }

  // 条的尺寸规则（需求 4.1）
  function geometry(barH) {
    return {
      gap: Math.max(2, Math.round(barH * 0.22)),
      padX: Math.max(3, Math.round(barH * 0.25)),
      rad: Math.max(2, Math.min(4, Math.round(barH / 4))),
    };
  }

  function monthHTML({ year, month, tasks, today, barH, fontSize, barRadius, barGap, barPadding }) {
    const { start, weeks } = D.monthGrid(year, month);
    const g = geometry(barH);
    const gap = barGap ?? g.gap, padX = barPadding ?? g.padX;
    let html = '<div class="cal-wd">' + '一二三四五六日'.split('').map(w => `<span>${w}</span>`).join('') + '</div>';
    for (let w = 0; w < weeks; w++) {
      const ws = D.addDays(start, w * 7);
      const { segs, lanes } = layoutWeek(tasks, ws);
      html += `<div class="cal-week" data-start="${ws}"><div class="cal-dates">`;
      for (let i = 0; i < 7; i++) {
        const day = D.addDays(ws, i), d = D.parse(day);
        const cls = (d.getMonth() !== month ? ' out' : '') + (day === today ? ' today' : '');
        html += `<div class="cal-dc${cls}" data-date="${day}">${d.getDate()}</div>`;
      }
      const h = lanes ? lanes * barH + (lanes - 1) * gap : 0;
      html += `</div><div class="cal-lanes" style="height:${h}px">`;
      for (const { task: t, a, b, lane, cl, cr } of segs) {
        // 跨周被截断的一端：直角、贴边；正常结束的一端：圆角、留 2px
        const radius = barRadius == null ? g.rad : barRadius;
        const li = cl ? 0 : 2, ri = cr ? 0 : 2, rl = cl ? 0 : radius, rr = cr ? 0 : radius;
        const style = `left:calc(${a * 100 / 7}% + ${li}px);width:calc(${(b - a + 1) * 100 / 7}% - ${li + ri}px);`
          + `top:${lane * (barH + gap)}px;height:${barH}px;line-height:${barH}px;font-size:${fontSize}px;padding:0 ${padX}px;`
          + `border-radius:${rl}px ${rr}px ${rr}px ${rl}px;`
          + (t.done ? '' : `background:${t.color};color:${C.barText(t.color)};`);
        html += `<div class="cal-bar${t.done ? ' done' : ''}" data-id="${t.id}" style="${style}">${esc(t.title)}</div>`;
      }
      html += '</div></div>';
    }
    return html;
  }

  // 给某个日程的所有分段加 / 去掉一个样式（悬停高亮、选中）
  function markBars(container, cls, id) {
    container.querySelectorAll('.cal-bar').forEach(el => el.classList.toggle(cls, !!id && el.dataset.id === id));
  }

  // 详情：标题、日期、进度、备注都完整显示，备注保留换行
  function detailHTML(task, today) {
    return `<i class="dt-bar" style="background:${task.done ? 'var(--done-bg)' : task.color}"></i>`
      + `<div class="dt-body"><div class="dt-title">${esc(task.title)}</div>`
      + `<div class="dt-meta">${D.rangeText(task.startDate, task.endDate)} · ${D.progressText(task, today)}</div>`
      + (task.note ? `<div class="dt-note">${esc(task.note)}</div>` : '')
      + '</div>';
  }

  // 提醒原因：按提醒种类和今天的日期算，提醒没确认留到后几天时文字也是对的
  function reminderReason(kind, task, today) {
    const isStart = kind === 'startBefore' || kind === 'startDay';
    const n = D.diff(today, isStart ? task.startDate : task.endDate);
    if (isStart) return n > 0 ? `${n} 天后开始` : n === 0 ? '今天开始' : '已开始';
    return n > 0 ? `${n} 天后截止` : n === 0 ? '今天截止' : '已截止';
  }

  root.RCCal = { esc, cmp, layoutWeek, geometry, monthHTML, markBars, detailHTML, reminderReason };
})(self);
