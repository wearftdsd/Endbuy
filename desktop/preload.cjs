/**
 * Pont sécurisé entre l'interface endBuy et l'application de bureau.
 * Seules ces fonctions sont exposées (contextIsolation + sandbox activés).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('endbuyDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  getConfig: () => ipcRenderer.invoke('endbuy:get-config'),
  setServer: (cfg) => ipcRenderer.invoke('endbuy:set-server', cfg),
  retry: () => ipcRenderer.invoke('endbuy:retry'),
  getScreenSources: () => ipcRenderer.invoke('endbuy:get-screen-sources'),
  selectScreenSource: (id, withAudio) => ipcRenderer.invoke('endbuy:select-screen-source', id, withAudio),
  setBadge: (count) => ipcRenderer.send('endbuy:set-badge', count),
  flashFrame: () => ipcRenderer.send('endbuy:flash-frame'),
  notify: (title, body) => ipcRenderer.send('endbuy:notify', title, body),
  openExternal: (url) => ipcRenderer.send('endbuy:open-external', url),
});
