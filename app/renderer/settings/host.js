// 设置自己的状态和提示，不依赖主面板 DOM，也不改主面板尺寸。
const $ = id => document.getElementById(id);
let settingsState = null, toastTimer = null;
const SettingsHost = {
  state: () => settingsState,
  report(result, message) {
    const toast = $('toast');
    toast.textContent = result?.ok ? message : '保存失败，已恢复原来的状态';
    toast.classList.toggle('bad', !result?.ok);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2000);
  },
  closed: () => rc.closeSettings(),
  enableDragging(sheet) {
    const header = sheet.querySelector('.settings-header');
    let drag = null, layoutFrame = 0;
    const place = (x, y) => {
      const box = sheet.getBoundingClientRect();
      const left = Math.max(20, Math.min(x, innerWidth - box.width - 20));
      const top = Math.max(24, Math.min(y, innerHeight - box.height - 24));
      sheet.style.setProperty('--settings-x', `${left}px`);
      sheet.style.setProperty('--settings-y', `${top}px`);
      sheet.classList.add('is-positioned');
    };
    const keepVisible = () => {
      if (layoutFrame || !sheet.classList.contains('is-positioned')) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        const box = sheet.getBoundingClientRect();
        place(box.left, box.top);
      });
    };
    const down = event => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest('button, input, select, a')) return;
      event.preventDefault();
      const box = sheet.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
      header.setPointerCapture(event.pointerId);
    };
    const move = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!sheet.classList.contains('is-dragging') && Math.hypot(dx, dy) < 4) return;
      sheet.classList.add('is-dragging');
      place(drag.left + dx, drag.top + dy);
    };
    const end = () => {
      if (!drag) return;
      const id = drag.id;
      drag = null;
      if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
      sheet.classList.remove('is-dragging');
    };
    header.addEventListener('pointerdown', down);
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    header.addEventListener('lostpointercapture', end);
    const observer = new ResizeObserver(keepVisible);
    observer.observe(sheet);
    addEventListener('resize', keepVisible);
    return () => {
      end();
      cancelAnimationFrame(layoutFrame);
      observer.disconnect();
      removeEventListener('resize', keepVisible);
      header.removeEventListener('pointerdown', down);
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      header.removeEventListener('lostpointercapture', end);
    };
  },
};

rc.onState(state => { settingsState = state; Settings.render(); });
rc.onSettingsReopen(() => Settings.open());
addEventListener('DOMContentLoaded', async () => {
  try {
    settingsState = await rc.getState();
    Settings.open();
    await document.fonts.ready;
    requestAnimationFrame(() => rc.settingsReady());
  } catch (_) { rc.closeSettings(); }
});
