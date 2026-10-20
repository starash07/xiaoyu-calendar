// 只在独立自测中使用自己的色块窗口，验证真实合成后的透光，不截取整张桌面。
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BrowserWindow, screen, nativeImage } = require('electron');
const koffi = require('koffi');
const P = require('./paths');
const W = require('./win32');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function captureOwnedArea(win) {
  assert.ok(P.SELFTEST && win.isVisible(), '只允许截取本程序独立测试窗口');
  const r = W.windowRect(W.hwndOf(win)), width = r.right - r.left, height = r.bottom - r.top;
  const u = koffi.load('user32.dll'), g = koffi.load('gdi32.dll');
  const getDC = u.func('intptr __stdcall GetDC(intptr hwnd)');
  const releaseDC = u.func('int __stdcall ReleaseDC(intptr hwnd, intptr dc)');
  const createDC = g.func('intptr __stdcall CreateCompatibleDC(intptr dc)');
  const deleteDC = g.func('int __stdcall DeleteDC(intptr dc)');
  const createBitmap = g.func('intptr __stdcall CreateCompatibleBitmap(intptr dc, int w, int h)');
  const select = g.func('intptr __stdcall SelectObject(intptr dc, intptr object)');
  const destroy = g.func('int __stdcall DeleteObject(intptr object)');
  const blt = g.func('int __stdcall BitBlt(intptr dest, int x, int y, int w, int h, intptr src, int sx, int sy, uint op)');
  const getBits = g.func('int __stdcall GetDIBits(intptr dc, intptr bitmap, uint start, uint lines, void *bits, void *info, uint usage)');
  const dc = getDC(0), mem = createDC(dc), bmp = createBitmap(dc, width, height);
  try {
    const old = select(mem, bmp);
    try { assert.ok(blt(mem, 0, 0, width, height, dc, r.left, r.top, 0x40cc0020)); }
    finally { select(mem, old); }
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40); header.writeInt32LE(width, 4); header.writeInt32LE(-height, 8);
    header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
    const bits = Buffer.alloc(width * height * 4);
    assert.equal(getBits(mem, bmp, 0, height, bits, header, 0), height);
    for (let i = 3; i < bits.length; i += 4) bits[i] = 255;
    return nativeImage.createFromBitmap(bits, {width, height});
  } finally { destroy(bmp); deleteDC(mem); releaseDC(0, dc); }
}

async function run({store, w1, broadcast, note}) {
  assert.ok(P.SELFTEST);
  assert.ok(!w1.surface, '原生透明表面尚未接入背景磨砂，不能运行旧版玻璃合成检查');
  const saved = {...store.settings.w1.appearance}, b = w1.win.getBounds();
  const back = new BrowserWindow({x:b.x-12, y:b.y-12, width:b.width+24, height:b.height+24,
    frame:false, show:false, focusable:false, skipTaskbar:true, alwaysOnTop:true, hasShadow:false, resizable:false, thickFrame:false});
  const js = code => w1.win.webContents.executeJavaScript(code);
  const update = async patch => { assert.ok(store.saveSettings({w1:{appearance:patch}}).ok); broadcast(); await wait(260); };
  const paint = async color => {
    await back.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(color)}`);
    await wait(230);
  };
  try {
    await back.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>小鱼玻璃自测色块</title><style>html,body{width:100%;height:100%;margin:0;background:#ef9262}</style>'));
    back.showInactive();
    w1.win.setAlwaysOnTop(false); w1.win.setAlwaysOnTop(true); w1.win.showInactive(); w1.applyGlass(true);
    await wait(220);
    // 标题与星期之间的留白：没有文字，适合检验背景像素。
    const sample = await js(`(() => {const h=document.querySelector('.head').getBoundingClientRect(); return {x:Math.round(h.left+h.width/2),y:Math.round(h.bottom+7)};})()`);
    const scale = screen.getDisplayMatching(b).scaleFactor;
    const pixel = (img, x, y) => {
      const size=img.getSize(), xx=Math.round(x), yy=Math.round(y), i=(yy*size.width+xx)*4;
      const data=img.toBitmap(); return [data[i+2],data[i+1],data[i],data[i+3]];
    };
    const sampleColor = () => pixel(captureOwnedArea(back), (sample.x+12)*scale, (sample.y+12)*scale);
    const orange=sampleColor();
    await paint('#508cdb');
    const blue=sampleColor();
    assert.ok(orange[0]-blue[0]>65 && blue[2]-orange[2]>55, '挂件没有跟随背后的实际色块改变');
    note('真实透底', {orange, blue, result:'底下窗口换色后，挂件内的背景跟随变化'});

    await update({panelOpacity:0,blur:0});
    const transparentPage=await w1.win.webContents.capturePage();
    const p0=pixel(transparentPage,sample.x,sample.y);
    assert.ok(p0[3]<60,'零不透明度仍有不透明图片底层');
    assert.equal(w1.glass.status.mode,'none');
    await update({panelOpacity:100});
    const p100=pixel(await w1.win.webContents.capturePage(),sample.x,sample.y);
    assert.equal(p100[3],255);
    note('不透明度两端', {zeroAlpha:p0[3],fullAlpha:p100[3]});

    await paint('repeating-linear-gradient(90deg,#224070 0 6px,#e6eff8 6px 12px)');
    await update({panelOpacity:14,blur:0});
    const variation = img => {
      const row=[];
      for(let x=-60;x<60;x++) row.push(pixel(img,(sample.x+12+x)*scale,(sample.y+12)*scale)[0]);
      const avg=row.reduce((a,b)=>a+b,0)/row.length;
      return Math.sqrt(row.reduce((sum,n)=>sum+(n-avg)**2,0)/row.length);
    };
    const clear=variation(captureOwnedArea(back));
    await update({blur:14});
    const light=variation(captureOwnedArea(back));
    await update({blur:40});
    const soft=variation(captureOwnedArea(back));
    fs.writeFileSync(path.join(P.SHOTS,'w1-glass-stripes.png'),captureOwnedArea(back).toPNG());
    note('条纹场景', {back: await back.webContents.executeJavaScript('getComputedStyle(document.body).background'),
      tint: await js('getComputedStyle(document.getElementById("tint")).backgroundColor')});
    note('真实磨砂', {clear,light,soft});
    assert.ok(clear>40 && light<clear*.65 && soft<clear*.65,'原生磨砂没有柔化真实窗口条纹');

    // 磨砂必须局限在圆角卡片内，透明留白和圆角缺口仍显示清晰条纹。
    const checkEdges = () => {
      const image=captureOwnedArea(back), row=[];
      for(let x=40;x<160;x++) row.push(pixel(image,(12+x)*scale,(12+3)*scale)[0]);
      const avg=row.reduce((a,b)=>a+b,0)/row.length;
      const outside=Math.sqrt(row.reduce((sum,n)=>sum+(n-avg)**2,0)/row.length);
      assert.ok(outside>40,'磨砂溢出到卡片外的透明留白');
      return outside;
    };
    const softOutside=checkEdges();
    await update({blur:14});
    const lightOutside=checkEdges();
    note('磨砂边界', {lightOutside,softOutside});

    await update(saved);
    await paint('linear-gradient(135deg,#e7f2ef 0%,#d6e4f6 50%,#e9dff0 100%)');
    fs.writeFileSync(path.join(P.SHOTS,'w1-real-glass.png'),captureOwnedArea(back).toPNG());
  } finally {
    store.saveSettings({w1:{appearance:saved}}); broadcast();
    back.destroy();
  }
}

module.exports={run};
