/// <reference types="vite/client" />

export interface KeyboardShortcutData {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  fullscreen?: boolean;
}

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  openBackupsFolder: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  quitApp: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onStatus: (callback: (msg: string) => void) => () => void;
  onError: (callback: (msg: string) => void) => () => void;
  onShortcut: (callback: (data: KeyboardShortcutData) => void) => () => void;
  isDesktop?: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
