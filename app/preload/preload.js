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
  w1Drag: () => ipcRenderer.send('w1:drag'),
  setPinned: pinned => ipcRenderer.invoke('w1:pin', pinned),
  resetW1: () => ipcRenderer.invoke('w1:reset'),

  // W2 下拉窗
  onCommand: on('w2:cmd'),
  w2Drag: () => ipcRenderer.send('w2:drag'),
  setBlock: blocked => ipcRenderer.send('w2:block', blocked),
  hideW2: () => ipcRenderer.send('w2:hide'),
  createTask: task => ipcRenderer.invoke('task:create', task),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  deleteTask: id => ipcRenderer.invoke('task:delete', id),
  confirmReminder: id => ipcRenderer.invoke('reminder:confirm', id),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  previewAppearance: ap => ipcRenderer.send('appearance:preview', ap),
  setAutoStart: on => ipcRenderer.invoke('autostart:set', on),
});
