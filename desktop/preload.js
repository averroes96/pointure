const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
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
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printHtml: (options) => ipcRenderer.invoke('print-html', options),
  isDesktop: true,
});

