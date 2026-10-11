const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
  onStatus: (callback) => ipcRenderer.on('status', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('error', (_event, value) => callback(value)),
});
