// 自测：用单独的数据目录（.data-selftest）跑一遍关键流程，
// 把两个窗口的画面截图和检查结果存到 .data-selftest/shots，跑完自动退出
const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');
const P = require('./paths');
const W = require('./win32');

const wait = ms => new Promise(r => setTimeout(r, ms));

async function run({ store, w1, w2, broadcast }) {
  const log = [];
  const note = (k, v) => { log.push([k, v]); console.log('[selftest]', k, JSON.stringify(v)); };
  const shot = async (win, name) => fs.writeFileSync(path.join(P.SHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const js = (win, code) => win.webContents.executeJavaScript(code);
  fs.mkdirSync(P.SHOTS, { recursive: true });

  try {
    await wait(2000);
    if (!store.tasks.length) note('载入示例日程', store.loadSamples());
    await wait(800);

    // 桌面挂件：摆放中
    await shot(w1.win, 'w1-loose');
    note('W1 窗口大小', w1.size);

    // 模拟光标悬停在「备注有换行」的那根条上
    const bar = await js(w1.win, `(() => {
      const t = [...document.querySelectorAll('.cal-bar')].find(b => b.textContent.includes('出差')) || document.querySelector('.cal-bar');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.left + 6, y: r.top + r.height / 2, text: t.textContent };
    })()`);
    note('悬停的条', bar);
    if (bar) {
      w1.send('w1:cursor', bar);
      await wait(500);
      await shot(w1.win, 'w1-hover');
      note('悬停后 W1 窗口大小（底边应变长）', w1.size);
      w1.send('w1:cursor', { x: -1, y: -1 });
      await wait(400);
      note('移开后 W1 窗口大小（应缩回）', w1.size);
    }

    // 钉住：嵌进桌面
    note('钉住', w1.setPinned(true));
    broadcast();
    await wait(1000);
    note('嵌入结果', {
      embedded: w1.embedded, degraded: w1.degraded,
      parentIsWorkerW: W.parentOf(w1.hwnd) === w1.workerw, rect: W.windowRect(w1.hwnd), pos: w1.pos,
    });
    await shot(w1.win, 'w1-pinned');

    // 下拉窗
    w2.show();
    await wait(900);
    await shot(w2.win, 'w2-main');
    const picked = await js(w2.win, `(() => {
      const t = W2App.App.state.tasks.find(x => x.note && x.note.includes('\\n')) || W2App.App.state.tasks[0];
      W2App.select(t.id); return t.title;
    })()`);
    note('选中', picked);
    await wait(300);
    await shot(w2.win, 'w2-selected');

    // 新建弹窗 → 保存
    const before = store.tasks.length;
    await js(w2.win, `(() => {
      const s = W2App.App.state;
      TaskDialog.open({ mode: 'new', start: s.today, end: RCDates.addDays(s.today, 2) });
      const t = document.getElementById('dlgTitle'); t.value = '自测新建'; t.dispatchEvent(new Event('input'));
      document.getElementById('dlgNote').value = '第一行\\n第二行';
    })()`);
    await wait(300);
    await shot(w2.win, 'w2-dialog');
    const closed = await js(w2.win, `new Promise(r => { document.getElementById('dlgSave').click(); setTimeout(() => r(document.getElementById('modal').hidden), 700); })`);
    note('保存后弹窗已关闭', closed);
    note('日程数（应多 1 条）', { before, after: store.tasks.length });

    // 空标题保存：应提示且不关闭
    const emptyCheck = await js(w2.win, `new Promise(r => {
      TaskDialog.open({ mode: 'new', start: W2App.App.state.today, end: W2App.App.state.today });
      document.getElementById('dlgSave').click();
      setTimeout(() => { const e = document.getElementById('errTitle'); r({ shown: !e.hidden, text: e.textContent, stillOpen: !document.getElementById('modal').hidden }); TaskDialog.close(); }, 300);
    })`);
    note('空标题校验', emptyCheck);

    // 设置页
    await js(w2.win, 'Settings.open()');
    await wait(500);
    await shot(w2.win, 'w2-settings');
    await js(w2.win, 'Settings.close()');

    // 透明无边框窗口还能不能拖边缩放：直接问系统，鼠标落在窗口边缘算什么区域
    {
      const koffi = require('koffi');
      const SendMessageW = koffi.load('user32.dll').func('intptr __stdcall SendMessageW(intptr hwnd, uint msg, uintptr wParam, intptr lParam)');
      const NAMES = { 1: '客户区', 2: '标题栏', 10: '左边', 11: '右边', 12: '上边', 13: '左上角', 14: '右上角', 15: '下边', 16: '左下角', 17: '右下角' };
      const hwnd = W.hwndOf(w2.win), r = W.windowRect(hwnd);
      const probe = (x, y) => { const v = Number(SendMessageW(hwnd, 0x0084, 0, ((y & 0xFFFF) << 16) | (x & 0xFFFF))); return NAMES[v] || v; };
      note('边缘命中测试', {
        右下角: probe(r.right - 2, r.bottom - 2), 下边: probe((r.left + r.right) / 2 | 0, r.bottom - 2),
        右边: probe(r.right - 2, (r.top + r.bottom) / 2 | 0), 左边: probe(r.left + 1, (r.top + r.bottom) / 2 | 0),
        上边: probe((r.left + r.right) / 2 | 0, r.top + 1),
      });
    }

    // 吸附到顶边 → 收起 → 滑出
    const wa = screen.getPrimaryDisplay().workArea;
    w2.win.setBounds({ x: wa.x + 300, y: wa.y + 10, width: 480, height: 640 });
    w2.afterMove();
    note('吸附', { dock: w2.dock, bounds: w2.win.getBounds() });
    w2.collapse();
    await wait(400);
    note('收起后（只露 3px）', w2.win.getBounds());
    w2.expand();
    await wait(400);
    note('滑出后', w2.win.getBounds());

    // 解锁
    note('解锁', w1.setPinned(false));
    broadcast();
    await wait(600);
    note('解锁后', { embedded: w1.embedded, parent: W.parentOf(w1.hwnd) });
  } catch (e) {
    note('出错', String((e && e.stack) || e));
  }
  fs.writeFileSync(path.join(P.SHOTS, 'result.json'), JSON.stringify(log, null, 2));
  app.quit();
}

module.exports = { run };
