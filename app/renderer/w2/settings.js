// 设置页：桌面挂件外观（拖动时实时预览，松手后保存并提示）、挂件位置、统一提醒选项、开机自启
const Settings = (() => {
  const page = $('settings');
  const q = id => document.getElementById(id);
  let isOpenFlag = false;

  // 恢复默认用；和主进程 store.js 里的默认外观保持一致
  const DEFAULT_AP = { panelColor: '#000000', panelOpacity: 28, blur: 14, textColor: '#FFFFFF', barFontSize: 10, barHeight: 12, width: 420 };
  const SLIDERS = [
    ['panelOpacity', '底板不透明度', 0, 100, 1, v => `${v}%`],
    ['blur', '模糊强度', 0, 40, 1, v => `${v}px`],
    ['barFontSize', '甘特条字号', 7, 12, 0.5, v => `${v}px`],
    ['barHeight', '甘特条高度', 6, 18, 1, v => `${v}px`],
    ['width', '挂件宽度', 320, 600, 10, v => `${v}px`],
  ];
  const state = () => W2App.App.state;

  function build() {
    page.innerHTML = `
      <div class="page-head"><button type="button" class="ghost" id="stBack">‹ 返回</button><h2>设置</h2></div>
      <div class="group"><h3>桌面挂件外观</h3>
        <div class="srow"><label for="st_panelColor">底板颜色</label><input type="color" id="st_panelColor"><span></span></div>
        ${SLIDERS.map(([k, name, min, max, step]) => `<div class="srow"><label for="st_${k}">${name}</label>`
          + `<input type="range" id="st_${k}" min="${min}" max="${max}" step="${step}"><output id="st_${k}_out"></output></div>`).join('')}
        <div class="srow"><label for="st_textColor">字体颜色</label><input type="color" id="st_textColor"><output id="stContrast"></output></div>
        <div class="warn" id="stContrastWarn" hidden>对比度偏低，小字可能看不清</div>
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
    const ap = { panelColor: q('st_panelColor').value.toUpperCase(), textColor: q('st_textColor').value.toUpperCase() };
    for (const [k] of SLIDERS) ap[k] = +q(`st_${k}`).value;
    return ap;
  }

  function updateHints(ap) {
    for (const [k, , , , , fmt] of SLIDERS) q(`st_${k}_out`).textContent = fmt(ap[k]);
    const c = C.panelContrast(ap.textColor, ap.panelColor, ap.panelOpacity / 100, state().w1.wallAvg);
    q('stContrast').textContent = `对比度 ${c.toFixed(1)}`;
    q('stContrastWarn').hidden = c >= 4.5;
    q('stBarWarn').hidden = ap.barHeight >= ap.barFontSize + 2;
  }

  const saveAp = (patch, msg) => rc.saveSettings({ w1: { appearance: patch } }).then(res => W2App.report(res, msg || '已保存'));

  function wire() {
    q('stBack').addEventListener('click', close);
    for (const key of ['panelColor', 'textColor', ...SLIDERS.map(s => s[0])]) {
      const el = q(`st_${key}`);
      el.addEventListener('input', () => { const ap = current(); updateHints(ap); rc.previewAppearance(ap); });
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
    const s = state(), ap = s.settings.w1.appearance, w1 = s.w1;
    q('st_panelColor').value = ap.panelColor.toLowerCase();
    q('st_textColor').value = ap.textColor.toLowerCase();
    for (const [k] of SLIDERS) q(`st_${k}`).value = ap[k];
    updateHints(ap);
    q('stW1State').textContent = !w1.pinned ? '摆放中：可以拖动桌面挂件，摆好后点「钉住」'
      : w1.degraded ? '桌面嵌入失败，已切换为置底显示' : '已钉住在桌面上';
    q('stPin').textContent = w1.pinned ? '解锁桌面挂件' : '钉住桌面挂件';
    const r = s.settings.reminder;
    q('gSB').checked = r.startBefore.on; q('gSBd').value = r.startBefore.days; q('gSD').checked = r.startDay;
    q('gEB').checked = r.endBefore.on; q('gEBd').value = r.endBefore.days; q('gED').checked = r.endDay;
    q('stAuto').checked = !!s.settings.general.autoStart;
  }

  function open() {
    if (isOpenFlag) return;
    if (W2App.App.newMode) W2App.exitNewMode();
    isOpenFlag = true;
    page.hidden = false;
    build();
    W2App.refreshBlock();
  }

  function close() {
    if (!isOpenFlag) return;
    isOpenFlag = false;
    page.hidden = true;
    page.innerHTML = '';
    rc.previewAppearance(null);   // 丢掉没保存的预览
    W2App.refreshBlock();
  }

  return { open, close, render, isOpen: () => isOpenFlag };
})();
