// 系统托盘：左键唤出 / 收起下拉窗；右键菜单
const { Tray, Menu, nativeImage } = require('electron');

// 托盘图标直接用代码画：深色圆角底 + 三根彩色横条，像日历上的甘特条
function makeIcon() {
  const S = 32, buf = Buffer.alloc(S * S * 4);
  const put = (x, y, [r, g, b]) => { const i = (y * S + x) * 4; buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; };
  const inside = (x, y, r) => {
    const cx = Math.min(Math.max(x, r), S - 1 - r), cy = Math.min(Math.max(y, r), S - 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (inside(x, y, 7)) put(x, y, [30, 43, 39]);
  const bars = [[7, 5, 26, [93, 202, 165]], [14, 9, 22, [240, 153, 123]], [21, 5, 18, [133, 183, 235]]];
  for (const [y0, x0, x1, c] of bars) for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x1; x++) put(x, y, c);
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

function createTray(h) {
  const tray = new Tray(makeIcon());
  tray.on('click', () => h.toggle());
  const refresh = () => {
    tray.setToolTip(`日程挂件 · 今天有 ${h.todayCount()} 项日程`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '新建日程', click: () => h.newTask() },
      { label: h.isPinned() ? '解锁桌面挂件' : '钉住桌面挂件', click: () => h.setPinned(!h.isPinned()) },
      { label: '设置', click: () => h.settings() },
      { label: '开机自启', type: 'checkbox', checked: h.autoStart(), click: item => h.setAutoStart(item.checked) },
      { type: 'separator' },
      { label: 'Demo：载入示例日程', click: () => h.loadSamples() },
      { type: 'separator' },
      { label: '退出', click: () => h.quit() },
    ]));
  };
  refresh();
  return { tray, refresh, balloon: content => tray.displayBalloon({ title: '日程挂件', content, iconType: 'info' }) };
}

module.exports = { createTray };
