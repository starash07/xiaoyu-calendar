const api = window.trayMenu;
const buttons = [...document.querySelectorAll('[data-action]')];
let busy = false;

function focusItem(index) {
  buttons.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1; });
  buttons[index].focus({ preventScroll: true });
}

function setBusy(value) {
  busy = value;
  buttons.forEach(button => { button.disabled = value; });
}

api.onState(({ pinned }) => {
  document.getElementById('pinLabel').textContent = pinned ? '解锁桌面挂件' : '钉住桌面挂件';
  document.getElementById('pinIcon').innerHTML = pinned
    ? '<path d="M6.3 8V5.8a3.7 3.7 0 0 1 7.2-1.1"/><rect x="4.7" y="8" width="10.6" height="8.5" rx="2.5"/><path d="M10 11.3v2"/>'
    : '<path d="m7.1 3.2 6.9 2.5-2.3 2.9-.4 3.5-6.6-2.4 2-2.9.4-3.6ZM8 11l-2.1 5.8"/>';
});

api.onOpen(() => {
  setBusy(false);
  focusItem(0);
});

buttons.forEach(button => {
  button.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await api.action(button.dataset.action); }
    catch (_) { /* 主进程负责执行操作和报告失败。 */ }
    finally { setBusy(false); }
  });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); api.close(); return; }
  if (busy) return;
  const current = Math.max(0, buttons.indexOf(document.activeElement));
  const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length
    : event.key === 'ArrowUp' ? (current + buttons.length - 1) % buttons.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
  if (next !== null) { event.preventDefault(); focusItem(next); }
});

document.addEventListener('click', event => {
  if (event.target === document.body || event.target === document.documentElement) api.close();
});
document.addEventListener('contextmenu', event => event.preventDefault());
api.ready();
