'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProducts: () => ipcRenderer.invoke('products:list'),
  saveProduct: (product) => ipcRenderer.invoke('products:save', product),
  deleteProduct: (id) => ipcRenderer.invoke('products:delete', id),
  pickImages: () => ipcRenderer.invoke('images:pick'),
  removeImage: (name) => ipcRenderer.invoke('images:remove', name),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  botStart: () => ipcRenderer.invoke('bot:start'),
  botStop: () => ipcRenderer.invoke('bot:stop'),
  onBotStatus: (cb) => ipcRenderer.on('bot:status', (_event, status) => cb(status)),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
});
