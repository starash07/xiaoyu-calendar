// 用模拟时钟和窗口检查吸附动画，不创建窗口、不访问系统鼠标或真实数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main/w2.js'), 'utf8');
const results = [];
function harness(edge = 'top') {
  let clock = 1000, nextTimer = 0, pressed = false;
  let cursor = { x: 200, y: 200 };
  const timers = new Map(), moves = [];
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const display = { id: 1, bounds: area, workArea: area };
  const screen = { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayMatching: () => display, getCursorScreenPoint: () => cursor };
  class Window {
    constructor(options) { this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; this.visible = true; this.webContents = { send() {} }; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; moves.push({ time: clock, ...this.bounds }); }
    setMenu() {} loadFile() {} once() {} on() {} setAlwaysOnTop() {} focus() {}
    isDestroyed() { return false; } isVisible() { return this.visible; }
    showInactive() { this.visible = true; } show() { this.visible = true; } hide() { this.visible = false; }
  }
  const context = {
    module: { exports: {} }, performance: { now: () => clock }, Date: { now: () => clock },
    require: name => name === 'electron' ? { BrowserWindow: Window, screen } : name === './win32' ? { leftButtonDown: () => pressed } : name === './paths' ? { PRELOAD: '', RENDERER: '.' } : require(name),
    setInterval: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms, at: clock + ms }); return id; },
    clearInterval: id => timers.delete(id),
  };
  vm.runInNewContext(source, context);
  const w2 = new context.module.exports.W2({ settings: { w2: { x: 120, y: 0, width: 480, height: 500, dock: edge } }, saveSettings() {} });
  w2.create(false);
  w2.setBounds(w2.dockBounds(false));
  function advance(ms) {
    const end = clock + ms;
    while (true) {
      const entry = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      clock = timer.at;
      if (timers.has(id)) { timer.at += timer.ms; timer.fn(); }
    }
    clock = end;
  }
  return { w2, moves, advance, now: () => clock, cursor: point => { cursor = point; }, press: value => { pressed = value; } };
}
for (const edge of ['top', 'left', 'right']) {
  const h = harness(edge), start = h.w2.win.getBounds();
  h.cursor({ x: 900, y: 900 });
  const leave = h.now();
  h.advance(128);
  assert.equal(h.w2.collapsed, false, '误触保护期间不能收起');
  h.advance(32);
  assert.equal(h.w2.collapsed, true);
  h.advance(32);
  const moving = h.w2.win.getBounds();
  assert.ok(Math.abs(moving.x - start.x) + Math.abs(moving.y - start.y) > 100, '收起开头仍然过慢');
  h.advance(160);
  const end = h.w2.win.getBounds();
  if (edge === 'top') assert.equal(end.y + end.height, 3);
  if (edge === 'left') assert.equal(end.x + end.width, 3);
  if (edge === 'right') assert.equal(end.x, 1917);
  assert.ok(h.moves.find(m => m.time > leave).time - leave <= 180);
  results.push(`${edge}：离开后及时起步、平滑移动并准确保留 3px 边缘`);
}
{
  const h = harness();
  h.cursor({ x: 900, y: 900 }); h.advance(160); h.advance(32);
  const before = h.w2.win.getBounds();
  h.cursor({ x: before.x + 20, y: 1 }); h.w2.poll();
  assert.equal(h.w2.collapsed, false);
  assert.deepEqual(h.w2.win.getBounds(), before, '反向展开不能跳回原位置');
  h.advance(200);
  assert.equal(h.w2.win.getBounds().y, 0);
  results.push('鼠标返回时从当前动画位置反向展开，不跳动');
}
{
  const h = harness();
  h.cursor({ x: 900, y: 900 }); h.advance(64);
  h.cursor({ x: 200, y: 200 }); h.advance(400);
  assert.equal(h.w2.collapsed, false);
  results.push('短暂移出后返回，取消收起计时');
}
for (const mode of ['blocked', 'dragging', 'pressed', 'hidden']) {
  const h = harness();
  h.cursor({ x: 900, y: 900 });
  if (mode === 'pressed') h.press(true);
  else if (mode === 'hidden') h.w2.win.visible = false;
  else h.w2[mode] = true;
  h.advance(1000);
  assert.equal(h.w2.collapsed, false);
  results.push(`${mode}：不自动收起`);
}
{
  const h = harness();
  h.w2.collapse(); h.advance(400);
  assert.equal(h.w2.collapsed, true, '主动收起不能因鼠标仍在原位置而反向展开');
  h.w2.resizeToContent(650);
  assert.equal(h.w2.win.getBounds().y + h.w2.win.getBounds().height, 3);
  results.push('主动收起不被误打断，收起后内容增高仍保留 3px 边缘');
}
{
  const h = harness();
  h.cursor({ x: 900, y: 900 }); h.advance(64);
  h.w2.setSettingsOpen(true);
  h.w2.blocked = false;
  h.advance(1000);
  assert.equal(h.w2.collapsed, false, '主页面失焦不能覆盖设置窗的锁');
  h.w2.setSettingsOpen(false); h.advance(64);
  assert.equal(h.w2.collapsed, false, '关闭设置后重新开始离开计时');
  h.advance(350); assert.equal(h.w2.collapsed, true);
  results.push('设置打开保持展开；关闭后鼠标在外侧才自然收起');
}
{
  const h = harness();
  h.w2.setSettingsOpen(true); h.advance(300);
  h.w2.setSettingsOpen(false); h.advance(500);
  assert.equal(h.w2.collapsed, false, '关闭设置时鼠标在主面板内不能收起');
  h.cursor({ x: 900, y: 900 }); h.w2.blocked = true;
  h.w2.setSettingsOpen(true); h.w2.setSettingsOpen(false); h.advance(500);
  assert.equal(h.w2.collapsed, false, '关闭设置不能解除其他填写/拖选锁');
  h.w2.blocked = false; h.advance(400); assert.equal(h.w2.collapsed, true);
  results.push('关闭设置保留鼠标悬停及填写阻止收起，离开且无其他锁才收起');
}
{
  const h = harness();
  h.cursor({ x: 900, y: 900 }); h.advance(192);
  h.w2.setSettingsOpen(true); h.advance(300);
  assert.equal(h.w2.collapsed, false); assert.equal(h.w2.win.getBounds().y, 0);
  results.push('收起途中打开设置，主面板顺势展开并保持');
}
const output = path.join(__dirname, '../.data-selftest/shots/w2-motion-result.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ passed: true, simulatedClock: true, visibleWindows: 0, osMouseInput: false, realDataAccess: false, results }, null, 2));
console.log(`Panel motion: ${results.length} checks passed.`);
