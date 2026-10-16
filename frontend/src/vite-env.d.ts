/// <reference types="vite/client" />

export interface KeyboardShortcutData {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  fullscreen?: boolean;
}

export interface UpdateStatusData {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  currentVersion?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

export interface PrinterInfo {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
}

export interface PrintHtmlOptions {
  html: string;
  deviceName?: string;
  silent?: boolean;
  pageSize?: any;
  copies?: number;
}

export interface ElectronAPI {
  getVersion: () => Promise<string>;
  openBackupsFolder: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  quitApp: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  checkForUpdates: () => Promise<{ status: string; updateInfo?: any; message?: string }>;
  downloadUpdate: () => Promise<any>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (callback: (data: UpdateStatusData) => void) => () => void;
  onStatus: (callback: (msg: string) => void) => () => void;
  onError: (callback: (msg: string) => void) => () => void;
  onShortcut: (callback: (data: KeyboardShortcutData) => void) => () => void;
  getPrinters?: () => Promise<PrinterInfo[]>;
  printHtml?: (options: PrintHtmlOptions) => Promise<{ success: boolean; failureReason?: string }>;
  isDesktop?: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
