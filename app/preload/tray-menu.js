const { contextBridge, ipcRenderer } = require('electron');

const on = channel => callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('trayMenu', {
  onState: on('tray-menu:state'),
  onOpen: on('tray-menu:open'),
  ready: () => ipcRenderer.send('tray-menu:ready'),
  action: action => ipcRenderer.invoke('tray-menu:action', action),
  close: () => ipcRenderer.send('tray-menu:close'),
});
