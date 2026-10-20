// 设置页：桌面挂件外观（拖动时实时预览，松手后保存并提示）、挂件位置、统一提醒选项、开机自启
const Settings = (() => {
  const page = $('settings');
  const q = id => document.getElementById(id);
  let isOpenFlag = false;
  let editingAppearance = false, appearanceRevision = 0;

  const A = RCDesktopAppearance;
  const DEFAULT_AP = A.DEFAULT;
  const SLIDERS = [
    ['panelOpacity', '玻璃不透明度', ...A.LIMITS.panelOpacity, v => `${v}%`],
    ['width', '挂件宽度', ...A.LIMITS.width, v => `${v}px`],
    ['dateFontSize', '日期字号', ...A.LIMITS.dateFontSize, v => `${v}px`],
    ['barFontSize', '甘特条字号', ...A.LIMITS.barFontSize, v => `${v}px`],
    ['barHeight', '甘特条高度', ...A.LIMITS.barHeight, v => `${v}px`],
  ];
  const sliderRows = rows => rows.map(([k, name, min, max, step]) => `<div class="srow"><label for="st_${k}">${name}</label>`
    + `<input type="range" id="st_${k}" min="${min}" max="${max}" step="${step}"><output id="st_${k}_out" for="st_${k}"></output></div>`).join('');
  const state = () => W2App.App.state;

  function build() {
    page.innerHTML = `
      <div class="page-head"><button type="button" class="ghost" id="stBack">‹ 返回</button><h2>设置</h2></div>
      <div class="group"><h3>桌面挂件外观</h3>
        ${sliderRows(SLIDERS.slice(0, 3))}
        <div class="srow"><label for="st_blur">磨砂效果</label><select id="st_blur">${A.GLASS_LEVELS.map(item => `<option value="${item.value}">${item.label}</option>`).join('')}</select><span></span></div>
        <div class="warn" id="stGlassWarn" hidden>这一版桌面挂件暂未接入磨砂，当前使用透明底板；你的磨砂设置会保留</div>
        <div class="srow"><label for="st_panelColor">玻璃底色</label><input type="color" id="st_panelColor"><span></span></div>
        <div class="srow"><label for="st_textColor">文字颜色</label><input type="color" id="st_textColor"><span></span></div>
        ${sliderRows(SLIDERS.slice(3))}
        <div class="warn" id="stBarWarn" hidden>条高太小，文字可能被裁切</div>
        <div class="btn-row"><button type="button" class="plain-btn" id="stReset">恢复默认</button></div>
      </div>
      <div class="group"><h3>桌面挂件位置</h3>
        <div class="hint" id="stW1State"></div>
        <div class="btn-row"><button type="button" class="plain-btn" id="stPin"></button>
          <button type="button" class="plain-btn" id="stResetPos">重置位置</button></div>
      </div>
      <div class="group"><h3>提醒（统一设置）</h3>
        <div class="hint">新建日程默认沿用这里的设置，也可以在日程里单独改。只按天提醒，不设具体几点。</div>
        <div class="remind-grid" style="padding-left:0">
          <label class="check"><input type="checkbox" id="gSB"> 开始前 <input type="number" id="gSBd" min="1" max="365"> 天</label>
          <label class="check"><input type="checkbox" id="gSD"> 开始当天</label>
          <label class="check"><input type="checkbox" id="gEB"> 结束前 <input type="number" id="gEBd" min="1" max="365"> 天</label>
          <label class="check"><input type="checkbox" id="gED"> 结束当天</label>
        </div>
      </div>
      <div class="group"><h3>通用</h3>
        <label class="check"><input type="checkbox" id="stAuto"> 开机自启</label>
        <div class="hint">Demo 里默认关闭；打开后会写入 Windows 的开机启动项。</div>
      </div>
      <div class="group"><h3>关于</h3><div class="hint">日程挂件 Demo 0.1.0 · 数据只保存在本机</div></div>`;
    wire();
    render();
  }

  // 从控件读出当前外观（拖动中还没保存的值）
  function current() {
    const ap = { panelColor: q('st_panelColor').value.toUpperCase(), textColor: q('st_textColor').value.toUpperCase(), blur: +q('st_blur').value };
    for (const [k] of SLIDERS) ap[k] = +q(`st_${k}`).value;
    return ap;
  }

  function updateHints(ap) {
    for (const [k, , , , , fmt] of SLIDERS) q(`st_${k}_out`).textContent = fmt(ap[k]);
    q('stGlassWarn').hidden = ap.blur === 0 || state().w1.glass?.available !== false;
    q('stBarWarn').hidden = ap.barHeight >= ap.barFontSize + 2;
  }

  async function saveAp(patch, msg) {
    const revision = ++appearanceRevision;
    editingAppearance = false;
    let res;
    try { res = await rc.saveSettings({ w1: { appearance: patch } }); }
    catch (_) { res = { ok: false }; }
    // 新一轮拖动已经开始时，不用上一轮保存的回调覆盖当前预览。
    if (revision === appearanceRevision) {
      rc.previewAppearance(null);
      render();
    }
    W2App.report(res, msg || '已保存');
    return res;
  }

  function wire() {
    q('stBack').addEventListener('click', close);
    for (const key of ['panelColor', 'textColor', 'blur', ...SLIDERS.map(s => s[0])]) {
      const el = q(`st_${key}`);
      el.addEventListener('input', () => {
        editingAppearance = true;
        appearanceRevision++;
        const ap = current();
        updateHints(ap);
        rc.previewAppearance(ap);
      });
      el.addEventListener('change', () => { const ap = current(); saveAp({ [key]: ap[key] }); });   // 松手 / 选完颜色后才保存
    }
    q('stReset').addEventListener('click', () => saveAp(DEFAULT_AP, '已恢复默认外观'));
    q('stPin').addEventListener('click', async () => {
      const pinned = state().w1.pinned;
      W2App.report(await rc.setPinned(!pinned), pinned ? '已解锁，可以拖动挂件了' : '已钉住');
    });
    q('stResetPos').addEventListener('click', async () => W2App.report(await rc.resetW1(), '已移回主显示器右上角'));
    for (const id of ['gSB', 'gSBd', 'gSD', 'gEB', 'gEBd', 'gED']) q(id).addEventListener('change', saveReminder);
    q('stAuto').addEventListener('change', async e => W2App.report(await rc.setAutoStart(e.target.checked), e.target.checked ? '已开启开机自启' : '已关闭开机自启'));
  }

  async function saveReminder() {
    const reminder = {
      startBefore: { on: q('gSB').checked, days: Math.max(1, +q('gSBd').value || 1) }, startDay: q('gSD').checked,
      endBefore: { on: q('gEB').checked, days: Math.max(1, +q('gEBd').value || 1) }, endDay: q('gED').checked,
    };
    W2App.report(await rc.saveSettings({ reminder }), '已保存');
  }

  // 用最新数据刷新控件（保存成功后主进程会推新数据过来）
  function render() {
    if (!isOpenFlag || !page.firstChild) return;
    const s = state(), ap = A.normalize(s.settings.w1.appearance), w1 = s.w1;
    if (!editingAppearance) {
      q('st_panelColor').value = ap.panelColor.toLowerCase();
      q('st_textColor').value = ap.textColor.toLowerCase();
      q('st_blur').value = String(A.glassLevel(ap.blur));
      for (const [k] of SLIDERS) q(`st_${k}`).value = ap[k];
    }
    updateHints(editingAppearance ? current() : ap);
    q('stW1State').textContent = !w1.pinned ? '摆放中：可以拖动桌面挂件，摆好后点「钉住」'
      : w1.degraded ? '桌面挂靠失败，已切换为置底显示' : '已钉住在桌面上';
    q('stPin').textContent = w1.pinned ? '解锁桌面挂件' : '钉住桌面挂件';
    const r = s.settings.reminder;
    q('gSB').checked = r.startBefore.on; q('gSBd').value = r.startBefore.days; q('gSD').checked = r.startDay;
    q('gEB').checked = r.endBefore.on; q('gEBd').value = r.endBefore.days; q('gED').checked = r.endDay;
    q('stAuto').checked = !!s.settings.general.autoStart;
  }

  function open() {
    if (isOpenFlag) return;
    W2App.clearSelection();
    isOpenFlag = true;
    page.hidden = false;
    build();
    W2App.refreshBlock();
  }

  function close() {
    if (!isOpenFlag) return;
    isOpenFlag = false;
    editingAppearance = false;
    appearanceRevision++;
    page.hidden = true;
    page.innerHTML = '';
    rc.previewAppearance(null);   // 丢掉没保存的预览
    W2App.refreshBlock();
  }

  return { open, close, render, isOpen: () => isOpenFlag };
})();
