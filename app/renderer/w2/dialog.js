// 新建 / 编辑日程的填写弹窗 + 删除确认框
// 填写弹窗只能用鼠标点「保存」「取消」：按 Enter 不保存（备注里 Enter 是换行），按 Esc 不关闭
const TaskDialog = (() => {
  const modal = $('modal'), confirmEl = $('confirm');
  const q = id => document.getElementById(id);
  let ctx = null;          // { mode: 'new' | 'edit', taskId, color }
  let confirmCtx = null;   // { id }

  const state = () => W2App.App.state;

  function remindSummary(o) {
    const parts = [];
    if (o.startBefore.on) parts.push(`开始前 ${o.startBefore.days} 天`);
    if (o.startDay) parts.push('开始当天');
    if (o.endBefore.on) parts.push(`结束前 ${o.endBefore.days} 天`);
    if (o.endDay) parts.push('结束当天');
    return parts.length ? parts.join('、') : '不提醒';
  }

  function open({ mode, task, start, end }) {
    const st = state();
    const t = task || {
      title: '', startDate: start, endDate: end, note: '', pinned: false, remind: null,
      color: st.settings.lastColor || C.PRESETS[0][1],   // 默认用最近一次用过的颜色，第一次用预设第 1 色
    };
    ctx = { mode, taskId: task ? task.id : null, color: t.color.toUpperCase() };
    const g = st.settings.reminder, r = t.remind || g;
    modal.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgHead">
        <h3 id="dlgHead">${mode === 'new' ? '新建日程' : '编辑日程'}</h3>
        <div class="preview-bar" id="dlgPreview"></div>
        <div class="field"><label for="dlgTitle">标题</label>
          <input type="text" id="dlgTitle" maxlength="50" value="${K.esc(t.title)}">
          <div class="err" id="errTitle" hidden></div></div>
        <div class="row2">
          <div class="field"><label for="dlgStart">开始日期</label><input type="date" id="dlgStart" value="${t.startDate}"></div>
          <div class="field"><label for="dlgEnd">结束日期</label><input type="date" id="dlgEnd" value="${t.endDate}"></div>
        </div>
        <div class="err" id="errDate" hidden style="margin:-6px 0 10px"></div>
        <div class="field"><span class="field-label">颜色</span>
          <div class="swatches" id="dlgPresets"></div>
          <div id="dlgRecentWrap"><div class="sw-sub">最近使用</div><div class="swatches" id="dlgRecent"></div></div>
          <div class="custom-color"><input type="color" id="dlgPicker" title="取色器"><input type="text" id="dlgHex" maxlength="7" spellcheck="false"></div>
        </div>
        <div class="field"><label for="dlgNote">备注</label><textarea id="dlgNote" maxlength="500">${K.esc(t.note)}</textarea></div>
        <label class="check"><input type="checkbox" id="dlgPinned" ${t.pinned ? 'checked' : ''}> 置顶（排在其他日程前面）</label>
        <div class="field" style="margin-top:10px"><span class="field-label">提醒</span>
          <label class="check"><input type="radio" name="dlgRemind" value="global" ${t.remind ? '' : 'checked'}> 沿用统一设置（${remindSummary(g)}）</label>
          <label class="check"><input type="radio" name="dlgRemind" value="custom" ${t.remind ? 'checked' : ''}> 这条日程单独设置</label>
          <div class="remind-grid${t.remind ? '' : ' off'}" id="dlgRemindGrid">
            <label class="check"><input type="checkbox" id="rSB" ${r.startBefore.on ? 'checked' : ''}> 开始前 <input type="number" id="rSBd" min="1" max="365" value="${r.startBefore.days}"> 天</label>
            <label class="check"><input type="checkbox" id="rSD" ${r.startDay ? 'checked' : ''}> 开始当天</label>
            <label class="check"><input type="checkbox" id="rEB" ${r.endBefore.on ? 'checked' : ''}> 结束前 <input type="number" id="rEBd" min="1" max="365" value="${r.endBefore.days}"> 天</label>
            <label class="check"><input type="checkbox" id="rED" ${r.endDay ? 'checked' : ''}> 结束当天</label>
          </div>
        </div>
        <div class="err" id="errSave" hidden></div>
        <div class="actions">
          ${mode === 'edit' ? '<button type="button" class="danger-btn" id="dlgDelete">删除</button>' : ''}
          <div class="spacer"></div>
          <button type="button" class="plain-btn" id="dlgCancel">取消</button>
          <button type="button" class="primary" id="dlgSave">保存</button>
        </div>
      </div>`;
    modal.hidden = false;
    wire();
    paintColors();
    updatePreview();
    q('dlgTitle').focus();
    W2App.refreshBlock();
  }

  function showErr(id, msg) { q(id).textContent = msg; q(id).hidden = false; }
  function hideErr(id) { q(id).hidden = true; }

  function wire() {
    q('dlgTitle').addEventListener('input', () => { hideErr('errTitle'); updatePreview(); });
    q('dlgTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });   // 标题只有一行，Enter 没有反应
    ['dlgStart', 'dlgEnd'].forEach(id => q(id).addEventListener('input', () => hideErr('errDate')));
    q('dlgPicker').addEventListener('input', e => setColor(e.target.value));
    q('dlgHex').addEventListener('input', e => { const v = e.target.value.trim(); if (C.isHex(v)) setColor(v, true); });
    modal.querySelectorAll('input[name="dlgRemind"]').forEach(el => el.addEventListener('change', () => {
      q('dlgRemindGrid').classList.toggle('off', modal.querySelector('input[name="dlgRemind"]:checked').value !== 'custom');
    }));
    q('dlgCancel').addEventListener('click', close);
    q('dlgSave').addEventListener('click', save);
    const del = q('dlgDelete');
    if (del) del.addEventListener('click', () => { const t = state().tasks.find(x => x.id === ctx.taskId); if (t) confirmDelete(t); });
  }

  function paintColors() {
    const cur = ctx.color;
    const sw = (hex, title) => `<button type="button" class="swatch${hex.toUpperCase() === cur ? ' on' : ''}" data-c="${hex}" title="${title}" style="background:${hex}"></button>`;
    q('dlgPresets').innerHTML = C.PRESETS.map(([name, hex]) => sw(hex, name)).join('');
    const recent = state().settings.recentColors || [];
    q('dlgRecentWrap').hidden = !recent.length;
    q('dlgRecent').innerHTML = recent.map(hex => sw(hex, hex)).join('');
    q('dlgPicker').value = cur.toLowerCase();
    modal.querySelectorAll('.swatch').forEach(b => { b.onclick = () => setColor(b.dataset.c); });
  }

  function setColor(hex, fromHex) {
    ctx.color = hex.toUpperCase();
    paintColors();
    if (!fromHex) q('dlgHex').value = ctx.color;
    updatePreview();
  }

  // 顶部预览条：用当前标题和颜色实时画出来，直接看到条上文字的效果
  function updatePreview() {
    const el = q('dlgPreview');
    el.textContent = q('dlgTitle').value.trim() || '日程标题';
    el.style.background = ctx.color;
    el.style.color = C.barText(ctx.color);
    if (document.activeElement !== q('dlgHex')) q('dlgHex').value = ctx.color;
  }

  async function save() {
    const title = q('dlgTitle').value.trim(), startDate = q('dlgStart').value, endDate = q('dlgEnd').value;
    let bad = false;
    if (!title) { showErr('errTitle', '标题不能为空'); bad = true; }
    if (!D.isValid(startDate) || !D.isValid(endDate)) { showErr('errDate', '请选择开始日期和结束日期'); bad = true; }
    else if (endDate < startDate) { showErr('errDate', '结束日期不能早于开始日期'); bad = true; }
    if (bad) return;
    hideErr('errSave');
    const custom = modal.querySelector('input[name="dlgRemind"]:checked').value === 'custom';
    const remind = !custom ? null : {
      startBefore: { on: q('rSB').checked, days: +q('rSBd').value || 1 }, startDay: q('rSD').checked,
      endBefore: { on: q('rEB').checked, days: +q('rEBd').value || 1 }, endDay: q('rED').checked,
    };
    const data = { title, startDate, endDate, color: ctx.color, note: q('dlgNote').value, pinned: q('dlgPinned').checked, remind };
    const mode = ctx.mode;
    q('dlgSave').disabled = true;
    const res = mode === 'new' ? await rc.createTask(data) : await rc.updateTask(ctx.taskId, data);
    if (!ctx) return;   // 等结果时弹窗已被放弃
    q('dlgSave').disabled = false;
    if (res.ok) {
      close();
      if (mode === 'new' && res.id) flash(res.id);
      else W2App.toast('已保存');
      return;
    }
    // 保存失败：提示并保留弹窗和已填内容，可以再点「保存」
    const shown = ['标题不能为空', '结束日期不能早于开始日期', '标题最多 50 个字符', '备注最多 500 个字符'];
    showErr('errSave', shown.includes(res.error) ? res.error : '保存失败，请重试。关闭后本次修改不会保留。');
  }

  function flash(id) {
    setTimeout(() => {
      document.querySelectorAll(`#cal .cal-bar[data-id="${id}"]`).forEach(el => {
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 700);
      });
    }, 60);
  }

  function close() {
    const wasNew = ctx && ctx.mode === 'new';
    ctx = null;
    modal.hidden = true;
    modal.innerHTML = '';
    if (wasNew) W2App.exitNewMode();   // 取消或保存后都退出新建状态
    W2App.refreshBlock();
  }

  // 用户主动收起 / 隐藏下拉窗：关掉弹窗，放弃没保存的内容
  function discard() {
    closeConfirm();
    if (ctx) close();
  }

  function confirmDelete(task) {
    confirmCtx = { id: task.id };
    confirmEl.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true">
        <p>删除日程『${K.esc(task.title)}』？</p>
        <div class="actions"><div class="spacer"></div>
          <button type="button" class="plain-btn" id="cfCancel">取消</button>
          <button type="button" class="danger-btn" id="cfDelete">删除</button>
        </div></div>`;
    confirmEl.hidden = false;
    q('cfCancel').onclick = closeConfirm;
    q('cfDelete').onclick = async () => {
      const id = confirmCtx.id;
      closeConfirm();
      const res = await rc.deleteTask(id);
      if (!res.ok) { W2App.toast('保存失败，已恢复原来的状态', true); return; }
      if (ctx && ctx.taskId === id) close();
      W2App.toast('已删除');
    };
    q('cfCancel').focus();
    W2App.refreshBlock();
  }

  function closeConfirm() {
    confirmCtx = null;
    confirmEl.hidden = true;
    confirmEl.innerHTML = '';
    W2App.refreshBlock();
  }

  // 删除确认框里按 Esc：等于点「取消」，不删除
  document.addEventListener('keydown', e => {
    if (confirmCtx && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeConfirm(); }
  }, true);

  return {
    open, close, discard, confirmDelete,
    isOpen: () => !!ctx || !!confirmCtx,
    confirmOpen: () => !!confirmCtx,
  };
})();
