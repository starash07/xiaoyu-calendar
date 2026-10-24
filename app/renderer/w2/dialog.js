// 新建 / 编辑日程的填写弹窗 + 删除确认框
// 填写弹窗只能用鼠标点「保存」「取消」：按 Enter 不保存（备注里 Enter 是换行），按 Esc 不关闭
const TaskDialog = (() => {
  const modal = $('modal'), confirmEl = $('confirm');
  const q = id => document.getElementById(id);
  let ctx = null;          // { mode: 'new' | 'edit', taskId, color }
  let confirmCtx = null;   // { id }
  let layoutObserver = null;
  let layoutFrame = 0;
  let dialogMotion = null, closing = null;
  let confirmMotion = null, confirmClosing = null;

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
    cancelDialogMotion();
    closing = null;
    layoutObserver?.disconnect();
    const st = state();
    const t = task || {
      title: '', startDate: start, endDate: end, note: '', pinned: false, remind: null,
      color: st.settings.lastColor || C.PRESETS[0][1],   // 默认用最近一次用过的颜色，第一次用预设第 1 色
    };
    ctx = { mode, taskId: task ? task.id : null, color: t.color.toUpperCase() };
    const g = st.settings.reminder, r = t.remind || g;
    const chevron = '<svg class="tool-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
    modal.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgHead">
        <div class="dialog-header">
          <h3 id="dlgHead">${mode === 'new' ? '新建日程' : '编辑日程'}</h3>
        </div>
        <div class="dialog-scroll">
          <div class="dialog-fields">
            <div class="field"><label for="dlgTitle">标题</label>
              <input type="text" id="dlgTitle" maxlength="50" placeholder="日程名称" autocomplete="off" value="${K.esc(t.title)}">
              <div class="err" id="errTitle" role="alert" hidden></div></div>
            <div class="row2">
              <div class="field"><label for="dlgStart">开始日期</label><input type="date" id="dlgStart" value="${t.startDate}"></div>
              <div class="field"><label for="dlgEnd">结束日期</label><input type="date" id="dlgEnd" value="${t.endDate}"></div>
            </div>
            <div class="err" id="errDate" role="alert" hidden></div>
            <div class="field"><label for="dlgNote">备注<span class="optional">选填</span></label>
              <textarea id="dlgNote" maxlength="500" rows="2" placeholder="补充一些细节">${K.esc(t.note)}</textarea></div>
            <div class="dialog-tools">
              <button type="button" class="editor-tool" id="dlgColorToggle" aria-controls="dlgColorPanel" aria-expanded="false"><span class="color-dot" id="dlgColorDot" aria-hidden="true"></span>颜色${chevron}</button>
              <button type="button" class="editor-tool" id="dlgRemindToggle" aria-controls="dlgRemindPanel" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8a5 5 0 0 1 10 0v4l1.5 2h-13L5 12V8Zm3 8h4"/></svg><span id="dlgRemindLabel"></span>${chevron}</button>
              <label class="pin-tool" title="排在其他日程前面"><input type="checkbox" id="dlgPinned" ${t.pinned ? 'checked' : ''}>置顶</label>
            </div>
            <div class="editor-drawer" id="dlgColorPanel" aria-label="日程颜色" hidden>
              <div class="swatches" id="dlgPresets"></div>
              <div id="dlgRecentWrap"><div class="sw-sub">最近使用</div><div class="swatches" id="dlgRecent"></div></div>
              <div class="custom-color"><label for="dlgPicker">自定义</label><input type="color" id="dlgPicker" title="取色器"><input type="text" id="dlgHex" aria-label="颜色 HEX 值" maxlength="7" spellcheck="false"></div>
            </div>
            <div class="editor-drawer" id="dlgRemindPanel" aria-label="日程提醒" hidden>
              <div class="remind-mode">
                <label class="check"><input type="radio" name="dlgRemind" value="global" ${t.remind ? '' : 'checked'}>沿用统一设置</label>
                <label class="check"><input type="radio" name="dlgRemind" value="custom" ${t.remind ? 'checked' : ''}>单独设置</label>
              </div>
              <p class="remind-summary" id="dlgGlobalSummary" ${t.remind ? 'hidden' : ''}>${remindSummary(g)}</p>
              <div class="remind-grid" id="dlgRemindGrid" ${t.remind ? '' : 'hidden'}>
                <label class="check"><input type="checkbox" id="rSB" ${r.startBefore.on ? 'checked' : ''}>开始前 <input type="number" id="rSBd" aria-label="开始前几天提醒" min="1" max="365" value="${r.startBefore.days}"> 天</label>
                <label class="check"><input type="checkbox" id="rSD" ${r.startDay ? 'checked' : ''}>开始当天</label>
                <label class="check"><input type="checkbox" id="rEB" ${r.endBefore.on ? 'checked' : ''}>结束前 <input type="number" id="rEBd" aria-label="结束前几天提醒" min="1" max="365" value="${r.endBefore.days}"> 天</label>
                <label class="check"><input type="checkbox" id="rED" ${r.endDay ? 'checked' : ''}>结束当天</label>
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="err" id="errSave" role="alert" hidden></div>
          <div class="actions">
            ${mode === 'edit' ? '<button type="button" class="danger-btn" id="dlgDelete">删除</button>' : ''}
            <div class="spacer"></div>
            <button type="button" class="plain-btn" id="dlgCancel">取消</button>
            <button type="button" class="primary" id="dlgSave">保存</button>
          </div>
        </div>
      </div>`;
    modal.hidden = false;
    wire();
    paintColors();
    updateRemindLabel();
    layoutObserver = new ResizeObserver(() => {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; measureDialog(); });
    });
    modal.querySelectorAll('.dialog-header, .dialog-fields, .dialog-footer').forEach(el => layoutObserver.observe(el));
    measureDialog();
    W2App.refreshBlock();
    animateDialog(true);
    q('dlgTitle').focus({ preventScroll: true });
  }

  function cancelDialogMotion() {
    dialogMotion?.cancel();
    dialogMotion = null;
  }

  function animateDialog(opening) {
    if (!dialogMotion) dialogMotion = new RCPopupMotion(modal.querySelector('.dialog'), {
      openDuration: 400,
      openEasing: 'cubic-bezier(.2, .65, .25, 1)',
      openFrom: 'translate(0px, 10px) scale(.88, .88)',
      openPeak: 'translate(0px, -0.5px) scale(1.003, 1.003)',
      openPeakOffset: .82,
      backdrop: modal,
      backdropColor: '#1c1c201f',
    });
    return opening ? dialogMotion.open() : dialogMotion.close();
  }

  // 按完整表单内容申请窗口空间；空间不足时只滚动中间区域，操作按钮固定。
  function measureDialog() {
    if (!ctx || closing) return;
    const styles = getComputedStyle(modal);
    const panel = $('appShell'), panelStyle = getComputedStyle(panel);
    const height = [...modal.querySelectorAll('.dialog-header, .dialog-fields, .dialog-footer')]
      .reduce((sum, el) => sum + el.offsetHeight, 2)
      + parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
      + parseFloat(panelStyle.borderTopWidth) + parseFloat(panelStyle.borderBottomWidth);
    panel.style.setProperty('--dialog-height', `${Math.ceil(height)}px`);
  }

  function togglePanel(name) {
    const opening = q(`dlg${name}Panel`).hidden;
    for (const part of ['Color', 'Remind']) {
      const show = opening && part === name;
      q(`dlg${part}Panel`).hidden = !show;
      q(`dlg${part}Toggle`).setAttribute('aria-expanded', String(show));
    }
  }

  function readReminder() {
    if (modal.querySelector('input[name="dlgRemind"]:checked').value !== 'custom') return null;
    return {
      startBefore: { on: q('rSB').checked, days: +q('rSBd').value || 1 }, startDay: q('rSD').checked,
      endBefore: { on: q('rEB').checked, days: +q('rEBd').value || 1 }, endDay: q('rED').checked,
    };
  }

  function updateRemindLabel() {
    const custom = readReminder(), rules = custom || state().settings.reminder;
    const summary = remindSummary(rules);
    q('dlgRemindLabel').textContent = summary === '不提醒' ? '不提醒' : custom ? '提醒 · 单独' : '提醒 · 统一';
    q('dlgRemindToggle').title = summary;
  }

  function showErr(id, msg) { q(id).textContent = msg; q(id).hidden = false; }
  function hideErr(id) { q(id).hidden = true; }

  function wire() {
    q('dlgColorToggle').addEventListener('click', () => togglePanel('Color'));
    q('dlgRemindToggle').addEventListener('click', () => togglePanel('Remind'));
    q('dlgTitle').addEventListener('input', () => hideErr('errTitle'));
    q('dlgTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });   // 标题只有一行，Enter 没有反应
    ['dlgStart', 'dlgEnd'].forEach(id => q(id).addEventListener('input', () => hideErr('errDate')));
    q('dlgPicker').addEventListener('input', e => setColor(e.target.value));
    q('dlgHex').addEventListener('input', e => { const v = e.target.value.trim(); if (C.isHex(v)) setColor(v, true); });
    modal.querySelectorAll('input[name="dlgRemind"]').forEach(el => el.addEventListener('change', () => {
      const custom = modal.querySelector('input[name="dlgRemind"]:checked').value === 'custom';
      q('dlgRemindGrid').hidden = !custom;
      q('dlgGlobalSummary').hidden = custom;
      updateRemindLabel();
    }));
    q('dlgRemindGrid').addEventListener('input', updateRemindLabel);
    q('dlgCancel').addEventListener('click', close);
    q('dlgSave').addEventListener('click', save);
    const del = q('dlgDelete');
    if (del) del.addEventListener('click', () => { const t = state().tasks.find(x => x.id === ctx.taskId); if (t) confirmDelete(t); });
  }

  function paintColors() {
    const cur = ctx.color;
    const sw = (hex, title) => `<button type="button" class="swatch${hex.toUpperCase() === cur ? ' on' : ''}" data-c="${hex}" title="${title}" aria-label="${title}" aria-pressed="${hex.toUpperCase() === cur}" style="background:${hex}"></button>`;
    q('dlgPresets').innerHTML = C.PRESETS.map(([name, hex]) => sw(hex, name)).join('');
    const recent = state().settings.recentColors || [];
    q('dlgRecentWrap').hidden = !recent.length;
    q('dlgRecent').innerHTML = recent.map(hex => sw(hex, hex)).join('');
    q('dlgPicker').value = cur.toLowerCase();
    q('dlgColorDot').style.background = cur;
    if (document.activeElement !== q('dlgHex')) q('dlgHex').value = cur;
    modal.querySelectorAll('.swatch').forEach(b => { b.onclick = () => setColor(b.dataset.c); });
  }

  function setColor(hex, fromHex) {
    ctx.color = hex.toUpperCase();
    paintColors();
    if (!fromHex) q('dlgHex').value = ctx.color;
  }

  async function save() {
    if (!ctx || closing || q('dlgSave').disabled) return;
    const editing = ctx;
    const title = q('dlgTitle').value.trim(), startDate = q('dlgStart').value, endDate = q('dlgEnd').value;
    let bad = false;
    if (!title) { showErr('errTitle', '标题不能为空'); bad = true; }
    if (!D.isValid(startDate) || !D.isValid(endDate)) { showErr('errDate', '请选择开始日期和结束日期'); bad = true; }
    else if (endDate < startDate) { showErr('errDate', '结束日期不能早于开始日期'); bad = true; }
    if (bad) return;
    hideErr('errSave');
    const remind = readReminder();
    const data = { title, startDate, endDate, color: ctx.color, note: q('dlgNote').value, pinned: q('dlgPinned').checked, remind };
    const mode = ctx.mode;
    q('dlgSave').disabled = true;
    let res;
    try { res = mode === 'new' ? await rc.createTask(data) : await rc.updateTask(editing.taskId, data); }
    catch (_) { res = { ok: false }; }
    if (ctx !== editing || closing) return;   // 等结果时弹窗已关闭或换成另一条日程。
    q('dlgSave').disabled = false;
    if (res.ok) {
      await close();
      if (ctx) return;
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

  function finishClose() {
    cancelDialogMotion();
    closing = null;
    layoutObserver?.disconnect();
    layoutObserver = null;
    cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    ctx = null;
    modal.hidden = true;
    modal.innerHTML = '';
    $('appShell').style.removeProperty('--dialog-height');
    W2App.refreshBlock();
  }

  function close({ animate = true } = {}) {
    if (!ctx) return Promise.resolve();
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return Promise.resolve();
    }
    if (closing) return closing;
    const editing = ctx;
    modal.querySelector('.dialog').inert = true;
    closing = animateDialog(false).then(completed => {
      if (completed && ctx === editing) finishClose();
    });
    return closing;
  }

  // 用户主动收起 / 隐藏下拉窗：关掉弹窗，放弃没保存的内容
  function discard() {
    closeConfirm({ animate: false });
    if (ctx) close({ animate: false });
  }

  function confirmDelete(task) {
    confirmMotion?.cancel();
    confirmClosing = null;
    confirmCtx = { id: task.id };
    confirmEl.innerHTML = `<div class="confirm-box" role="alertdialog" aria-modal="true">
        <p>删除日程『${K.esc(task.title)}』？</p>
        <div class="actions"><div class="spacer"></div>
          <button type="button" class="plain-btn" id="cfCancel">取消</button>
          <button type="button" class="danger-btn" id="cfDelete">删除</button>
        </div></div>`;
    confirmEl.hidden = false;
    confirmMotion = new RCPopupMotion(confirmEl.querySelector('.confirm-box'));
    confirmMotion.open();
    q('cfCancel').onclick = closeConfirm;
    q('cfDelete').onclick = async () => {
      if (!confirmCtx || confirmClosing) return;
      const id = confirmCtx.id;
      await closeConfirm();
      const res = await rc.deleteTask(id);
      if (!res.ok) { W2App.toast('保存失败，已恢复原来的状态', true); return; }
      if (ctx && ctx.taskId === id) await close();
      W2App.toast('已删除');
    };
    q('cfCancel').focus();
    W2App.refreshBlock();
  }

  function finishConfirmClose() {
    confirmMotion?.cancel();
    confirmMotion = null;
    confirmClosing = null;
    confirmCtx = null;
    confirmEl.hidden = true;
    confirmEl.innerHTML = '';
    W2App.refreshBlock();
  }

  function closeConfirm({ animate = true } = {}) {
    if (!confirmCtx) return Promise.resolve();
    if (!animate || !confirmMotion) {
      finishConfirmClose();
      return Promise.resolve();
    }
    if (confirmClosing) return confirmClosing;
    const confirming = confirmCtx;
    confirmEl.querySelector('.confirm-box').inert = true;
    confirmClosing = confirmMotion.close().then(completed => {
      if (completed && confirmCtx === confirming) finishConfirmClose();
    });
    return confirmClosing;
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
