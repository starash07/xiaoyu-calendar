// 设置在独立窗口里居中显示；共用外观即时应用到主日历和桌面挂件。
const Settings = (() => {
  const page = $('settings');
  const q = id => document.getElementById(id);
  let isOpenFlag = false, closing = false, closeTimer = null;
  let editingAppearance = false, appearanceRevision = 0;
  let releaseDrag = null;
  const A = RCDesktopAppearance;
  const DEFAULT_AP = A.DEFAULT;
  const COLOR_KEYS = ['panelColor', 'textColor', 'weekendColor'];
  const SLIDERS = [
    ['panelOpacity', '玻璃不透明度', ...A.LIMITS.panelOpacity, v => `${v}%`],
    ['width', '挂件宽度', ...A.LIMITS.width, v => `${v}px`],
    ['dateFontSize', '日期字号', ...A.LIMITS.dateFontSize, v => `${v}px`],
    ['blur', '磨砂强度', ...A.LIMITS.blur, v => v === 0 ? '关闭' : String(v)],
    ['barFontSize', '日程条字号', ...A.LIMITS.barFontSize, v => `${v}px`],
    ['barHeight', '日程条高度', ...A.LIMITS.barHeight, v => `${v}px`],
  ];
  const sliderRows = rows => rows.map(([k, name, min, max, step]) => `<div class="settings-control">
    <div class="control-heading"><span class="control-label"><label for="st_${k}">${name}</label>${k === 'blur' ? `<button type="button" class="settings-help" id="stGlassWarn" aria-label="磨砂说明"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.3"/><path d="M7.9 7.5a2.15 2.15 0 0 1 4.2.6c0 1.5-2.1 1.7-2.1 3.2"/><path d="M10 14h.01"/></svg></button>` : ''}</span><output id="st_${k}_out" for="st_${k}"></output></div>
    <input type="range" id="st_${k}" min="${min}" max="${max}" step="${step}"></div>`).join('');
  const state = () => SettingsHost.state();

  function build() {
    page.innerHTML = `
      <section class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="stHeading" tabindex="-1">
        <header class="settings-header"><h2 id="stHeading">设置</h2>
          <div class="settings-header-actions"><button type="button" class="settings-reset" id="stReset">恢复默认外观</button>
          <button type="button" class="icon" id="stBack" aria-label="关闭设置" title="关闭设置"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M4 12l8-8"/></svg></button></div></header>
        <nav class="settings-tabs" role="tablist" aria-label="设置分类">
          <button type="button" role="tab" id="stTabAppearance" data-tab="Appearance" aria-controls="stPanelAppearance" aria-selected="true">外观</button>
          <button type="button" role="tab" id="stTabReminder" data-tab="Reminder" aria-controls="stPanelReminder" aria-selected="false" tabindex="-1">提醒</button>
          <button type="button" role="tab" id="stTabGeneral" data-tab="General" aria-controls="stPanelGeneral" aria-selected="false" tabindex="-1">通用</button>
        </nav>
        <div class="settings-scroll">
          <div class="settings-panel" id="stPanelAppearance" role="tabpanel" aria-labelledby="stTabAppearance">
            <h3 class="settings-group-title">日历与日程</h3>
            <div class="settings-grid">
              ${sliderRows(SLIDERS.slice(2, 3))}
              <div class="settings-today">
                <span id="stTodayLabel">主面板当天底色</span>
                <div class="today-tones" role="radiogroup" aria-labelledby="stTodayLabel">
                  ${A.TODAY_TONES.map(tone => `<button type="button" class="today-tone" id="st_today_${tone.id}" role="radio" aria-checked="false" tabindex="-1" aria-label="${tone.label}" title="${tone.label}" data-tone="${tone.id}" style="--tone-fill:${tone.fill};--tone-ink:${tone.ink}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8 2.5 2.5L12 5"/></svg></button>`).join('')}
                </div>
              </div>
            </div>
            <div class="settings-grid">
              <label class="settings-color" for="st_weekendColor"><span>周末文字</span><input type="color" id="st_weekendColor"></label>
              <label class="settings-color" for="st_textColor"><span>文字颜色</span><input type="color" id="st_textColor"></label>
            </div>
            <div class="settings-grid">${sliderRows(SLIDERS.slice(4))}</div>
            <p class="settings-notice" id="stBarWarn" hidden>条高太小，文字可能被裁切。</p>
            <h3 class="settings-group-title">桌面挂件 <span>仅桌面生效</span></h3>
            <div class="settings-grid">${sliderRows(SLIDERS.slice(0, 2))}</div>
            <div class="settings-grid">
              <label class="settings-color" for="st_panelColor"><span>玻璃底色</span><input type="color" id="st_panelColor"></label>
              ${sliderRows(SLIDERS.slice(3, 4))}
            </div>
          </div>
          <div class="settings-panel" id="stPanelReminder" role="tabpanel" aria-labelledby="stTabReminder" hidden>
            <p class="settings-intro">新建日程默认使用这些提醒，也可以在每个日程里单独调整。</p>
            <section class="settings-card"><h3>开始提醒</h3>
              <div class="reminder-option"><label for="gSB">开始前</label><span class="reminder-days"><input type="number" id="gSBd" aria-label="开始前几天提醒" min="1" max="365">天</span><input class="settings-switch" type="checkbox" role="switch" id="gSB"></div>
              <div class="reminder-option"><label for="gSD">开始当天</label><input class="settings-switch" type="checkbox" role="switch" id="gSD"></div>
            </section>
            <section class="settings-card"><h3>结束提醒</h3>
              <div class="reminder-option"><label for="gEB">结束前</label><span class="reminder-days"><input type="number" id="gEBd" aria-label="结束前几天提醒" min="1" max="365">天</span><input class="settings-switch" type="checkbox" role="switch" id="gEB"></div>
              <div class="reminder-option"><label for="gED">结束当天</label><input class="settings-switch" type="checkbox" role="switch" id="gED"></div>
            </section>
          </div>
          <div class="settings-panel" id="stPanelGeneral" role="tabpanel" aria-labelledby="stTabGeneral" hidden>
            <section class="settings-card"><h3>桌面挂件</h3><p class="settings-intro" id="stW1State"></p>
              <div class="settings-actions"><button type="button" class="settings-action" id="stPin"></button><button type="button" class="settings-action" id="stResetPos">重置位置</button></div>
            </section>
            <section class="settings-card"><label class="settings-toggle-row" for="stAuto"><span>开机自启</span><input class="settings-switch" type="checkbox" role="switch" id="stAuto"></label><p class="settings-intro">开机时自动打开小鱼。</p></section>
            <div class="settings-about"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="settings-about-name">小鱼日程表 <small>0.1.0</small></span></div>
          </div>
        </div>
      </section>`;
    wire();
    render();
  }

  function selectTab(name, focus = false) {
    page.querySelectorAll('[role=tab]').forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      q(`stPanel${tab.dataset.tab}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
    q('stReset').hidden = name !== 'Appearance';
    page.querySelector('.settings-scroll').scrollTop = 0;
  }

  // 读取全部外观字段，切换分类不会丢失当前值。
  function current() {
    const ap = Object.fromEntries(COLOR_KEYS.map(key => [key, q(`st_${key}`).value.toUpperCase()]));
    ap.todayTone = page.querySelector('.today-tone[aria-checked=true]')?.dataset.tone || DEFAULT_AP.todayTone;
    for (const [k] of SLIDERS) ap[k] = +q(`st_${k}`).value;
    return ap;
  }

  function updateHints(ap) {
    for (const [k, , , , , fmt] of SLIDERS) q(`st_${k}_out`).textContent = fmt(ap[k]);
    page.querySelectorAll('.today-tone').forEach(button => {
      const selected = button.dataset.tone === ap.todayTone;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const glassHelp = state().w1.glass?.available === false
      ? '桌面磨砂尚未启用，选择的效果会保留。' : '拖动调整磨砂强度，0 为关闭。';
    q('stGlassWarn').title = glassHelp;
    q('stGlassWarn').setAttribute('aria-label', `磨砂说明：${glassHelp}`);
    q('stBarWarn').hidden = ap.barHeight >= ap.barFontSize + 2;
  }

  async function saveAp(patch, msg) {
    const revision = ++appearanceRevision;
    editingAppearance = false;
    let res;
    try { res = await rc.saveSettings({ w1: { appearance: patch } }); }
    catch (_) { res = { ok: false }; }
    if (revision === appearanceRevision) {
      rc.previewAppearance(null);
      render();
    }
    SettingsHost.report(res, msg || '已保存');
    return res;
  }

  async function saveAction(action, message) {
    let result;
    try { result = await action(); } catch (_) { result = { ok: false }; }
    render();
    SettingsHost.report(result, message);
  }

  function wire() {
    q('stBack').addEventListener('click', () => close());
    const tabs = [...page.querySelectorAll('[role=tab]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next !== null) { event.preventDefault(); selectTab(tabs[next].dataset.tab, true); }
      });
    });
    for (const key of [...COLOR_KEYS, ...SLIDERS.map(s => s[0])]) {
      const el = q(`st_${key}`);
      el.addEventListener('input', () => {
        editingAppearance = true;
        appearanceRevision++;
        const ap = current();
        updateHints(ap);
        rc.previewAppearance(ap);
      });
      el.addEventListener('change', () => { const ap = current(); saveAp({ [key]: ap[key] }); });
    }
    const tones = [...page.querySelectorAll('.today-tone')];
    const chooseTone = button => {
      const ap = { ...current(), todayTone: button.dataset.tone };
      updateHints(ap);
      rc.previewAppearance(ap);
      saveAp({ todayTone: ap.todayTone });
    };
    tones.forEach((button, index) => {
      button.addEventListener('click', () => chooseTone(button));
      button.addEventListener('keydown', event => {
        const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % tones.length
          : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + tones.length - 1) % tones.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tones.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        tones[next].focus();
        chooseTone(tones[next]);
      });
    });
    q('stReset').addEventListener('click', () => saveAp(DEFAULT_AP, '已恢复默认外观'));
    q('stPin').addEventListener('click', () => {
      const pinned = state().w1.pinned;
      saveAction(() => rc.setPinned(!pinned), pinned ? '已解锁，可以拖动挂件了' : '已钉住');
    });
    q('stResetPos').addEventListener('click', () => saveAction(() => rc.resetW1(), '已移回主显示器右上角'));
    for (const id of ['gSB', 'gSBd', 'gSD', 'gEB', 'gEBd', 'gED']) q(id).addEventListener('change', saveReminder);
    q('stAuto').addEventListener('change', event => {
      const on = event.target.checked;
      saveAction(() => rc.setAutoStart(on), on ? '已开启开机自启' : '已关闭开机自启');
    });
  }

  function saveReminder() {
    const days = id => Math.min(365, Math.max(1, Math.round(+q(id).value || 1)));
    const reminder = {
      startBefore: { on: q('gSB').checked, days: days('gSBd') }, startDay: q('gSD').checked,
      endBefore: { on: q('gEB').checked, days: days('gEBd') }, endDay: q('gED').checked,
    };
    q('gSBd').disabled = !reminder.startBefore.on;
    q('gEBd').disabled = !reminder.endBefore.on;
    return saveAction(() => rc.saveSettings({ reminder }), '已保存');
  }

  function render() {
    if (!isOpenFlag || closing || !page.firstChild) return;
    const s = state(), ap = A.normalize(s.settings.w1.appearance), w1 = s.w1;
    if (!editingAppearance) {
      for (const key of COLOR_KEYS) q(`st_${key}`).value = ap[key].toLowerCase();
      for (const [k] of SLIDERS) q(`st_${k}`).value = ap[k];
    }
    updateHints(editingAppearance ? current() : ap);
    q('stW1State').textContent = !w1.pinned ? '已解锁，可以拖动挂件调整位置。'
      : w1.degraded ? '暂时无法钉到桌面，当前置于窗口底层。' : '已钉住在桌面上。';
    q('stPin').textContent = w1.pinned ? '解锁摆放' : '钉在桌面';
    const r = s.settings.reminder;
    q('gSB').checked = r.startBefore.on; q('gSBd').value = r.startBefore.days; q('gSD').checked = r.startDay;
    q('gEB').checked = r.endBefore.on; q('gEBd').value = r.endBefore.days; q('gED').checked = r.endDay;
    q('gSBd').disabled = !r.startBefore.on; q('gEBd').disabled = !r.endBefore.on;
    q('stAuto').checked = !!s.settings.general.autoStart;
  }

  function open() {
    if (!state()) return;
    clearTimeout(closeTimer);
    closeTimer = null;
    closing = false;
    page.classList.remove('is-closing');
    if (isOpenFlag) { page.querySelector('.settings-sheet').focus({ preventScroll: true }); return; }
    isOpenFlag = true;
    page.hidden = false;
    build();
    releaseDrag = SettingsHost.enableDragging(page.querySelector('.settings-sheet'));
    // 初始焦点落在对话框，避免刚打开就给关闭按钮画出键盘焦点环。
    page.querySelector('.settings-sheet').focus({ preventScroll: true });
  }

  function finishClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
    isOpenFlag = closing = false;
    releaseDrag?.();
    releaseDrag = null;
    page.hidden = true;
    page.classList.remove('is-closing');
    page.innerHTML = '';
    SettingsHost.closed();
  }

  function close({ animate = true } = {}) {
    if (!isOpenFlag) return;
    if (closing && animate) return;
    closing = true;
    editingAppearance = false;
    appearanceRevision++;
    rc.previewAppearance(null);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { finishClose(); return; }
    page.classList.add('is-closing');
    closeTimer = setTimeout(finishClose, 150);
  }

  // 空白处不再关闭设置；保留关闭按钮和 Esc。
  page.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...page.querySelectorAll('button, input, select, summary, [tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    const active = document.activeElement, outsideItems = !items.includes(active);
    if (event.shiftKey && (active === first || outsideItems)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (active === last || outsideItems)) { event.preventDefault(); first?.focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); }
  });

  return { open, close, render, isOpen: () => isOpenFlag };
})();
