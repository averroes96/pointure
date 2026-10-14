const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onStatus: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('status', handler);
    return () => ipcRenderer.removeListener('status', handler);
  },
  onError: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('error', handler);
    return () => ipcRenderer.removeListener('error', handler);
  },
  onShortcut: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('keyboard-shortcut', handler);
    return () => ipcRenderer.removeListener('keyboard-shortcut', handler);
  },
  isDesktop: true,
});

