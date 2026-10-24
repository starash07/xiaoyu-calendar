// 页面能用的接口：只开放需要的这些，页面本身碰不到 Node
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => cb => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('rc', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: on('state'),

  // W1 桌面挂件
  w1Ready: () => ipcRenderer.send('w1:ready'),
  onW1Info: on('w1:info'),
  onCursor: on('w1:cursor'),
  onPreview: on('w1:preview'),
  reportSize: (w, h) => ipcRenderer.send('w1:size', { w, h }),
  reportW1Controls: controls => ipcRenderer.send('w1:controls', controls),
  w1Drag: () => ipcRenderer.send('w1:drag'),
  setPinned: pinned => ipcRenderer.invoke('w1:pin', pinned),
  resetW1: () => ipcRenderer.invoke('w1:reset'),

  // W2 下拉窗
  w2Ready: () => ipcRenderer.send('w2:ready'),
  onW2Layout: on('w2:layout'),
  onW2Preview: on('w2:preview'),
  onW2Retracted: on('w2:retracted'),
  reportW2Height: height => ipcRenderer.send('w2:height', height),
  onCommand: on('w2:cmd'),
  w2Drag: () => ipcRenderer.send('w2:drag'),
  setBlock: blocked => ipcRenderer.send('w2:block', blocked),
  hideW2: () => ipcRenderer.send('w2:hide'),

  // 屏幕中央的独立设置浮窗
  openSettings: () => ipcRenderer.invoke('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  settingsReady: () => ipcRenderer.send('settings:ready'),
  onSettingsVisibility: on('settings:visibility'),
  onSettingsReopen: on('settings:reopen'),
  onSettingsError: on('settings:error'),
  createTask: task => ipcRenderer.invoke('task:create', task),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  deleteTask: id => ipcRenderer.invoke('task:delete', id),
  confirmReminder: id => ipcRenderer.invoke('reminder:confirm', id),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  previewAppearance: ap => ipcRenderer.send('appearance:preview', ap),
  setAutoStart: on => ipcRenderer.invoke('autostart:set', on),
});
