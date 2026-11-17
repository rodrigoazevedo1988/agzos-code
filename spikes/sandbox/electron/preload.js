'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  paths: () => ipcRenderer.invoke('spike:paths'),
  result: (r) => ipcRenderer.send('spike:result', r),
});
