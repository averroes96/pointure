/**
 * ShoeDZ Desktop - Electron Main Process
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');
const { startPdfBridge, stopPdfBridge } = require('./pdf-bridge');

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Shared application data path
const isWindows = process.platform === 'win32';
let dataDir;
if (isWindows && process.env.PROGRAMDATA) {
  dataDir = path.join(process.env.PROGRAMDATA, 'ShoeDZ');
} else {
  dataDir = path.join(app.getPath('appData'), 'ShoeDZ');
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Configure logging
const logsDir = path.join(dataDir, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
log.transports.file.resolvePathFn = () => path.join(logsDir, 'desktop.log');
Object.assign(console, log.functions);

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let tray = null;
let backendPort = 8745;
let pdfBridgePort = 8746;
const bridgeToken = crypto.randomBytes(24).toString('hex');

const isDev = !app.isPackaged;

function resolvePythonBinary() {
  if (isDev) {
    // In development, use active python interpreter
    return process.platform === 'win32' ? 'python' : 'python3';
  }
  // In packaged build, bundled embedded Python is inside resources/python/
  const bundled = path.join(process.resourcesPath, 'python', 'pythonw.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return path.join(process.resourcesPath, 'python', 'python.exe');
}

function resolveBackendRoot() {
  if (isDev) {
    return path.join(__dirname, '..', 'backend');
  }
  return path.join(process.resourcesPath, 'backend');
}

function resolveDesktopPythonModule() {
  if (isDev) {
    return path.join(__dirname, 'python');
  }
  return path.join(process.resourcesPath, 'python');
}

async function findFreePort(defaultPort = 8745) {
  try {
    const getPort = (await import('get-port')).default;
    return await getPort({ port: defaultPort });
  } catch {
    return defaultPort;
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Navigate to local Waitress server
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
    }
    mainWindow.show();
    mainWindow.maximize();
  });

  // Block external navigation from leaving loopback
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBackendServer(port, bridgePort, token) {
  return new Promise(async (resolve, reject) => {
    const pythonExe = resolvePythonBinary();
    const backendRoot = resolveBackendRoot();
    const desktopModule = resolveDesktopPythonModule();

    log.info(`[Startup] Launching backend: ${pythonExe}`);
    log.info(`[Startup] Target data directory: ${dataDir}`);

    const env = Object.assign({}, process.env, {
      SHODZ_DATA_DIR: dataDir,
      PDF_BRIDGE_URL: `http://127.0.0.1:${bridgePort}/render-pdf`,
      PDF_BRIDGE_TOKEN: token,
      DJANGO_SETTINGS_MODULE: 'config.settings.desktop',
      PYTHONPATH: `${desktopModule}${path.delimiter}${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}`,
    });

    const args = ['-m', 'shodz_desktop', 'serve', '--port', String(port)];

    backendProcess = spawn(pythonExe, args, {
      env,
      cwd: backendRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let errorLog = '';

    backendProcess.stdout.on('data', data => {
      const msg = data.toString().trim();
      log.info(`[Backend] ${msg}`);
      if (splashWindow && msg.includes('[ShoeDZ]')) {
        splashWindow.webContents.send('status', msg.replace('[ShoeDZ] ', ''));
      }
    });

    backendProcess.stderr.on('data', data => {
      const msg = data.toString();
      errorLog += msg;
      if (errorLog.length > 4000) errorLog = errorLog.slice(-4000);
      log.error(`[Backend ERR] ${msg.trim()}`);
    });

    backendProcess.on('close', code => {
      log.info(`Backend process terminated with code: ${code}`);
      if (code !== 0 && code !== null) {
        if (splashWindow) {
          splashWindow.webContents.send('error', errorLog || `Erreur processus (code ${code})`);
        }
      }
    });

    // Wait for the backend health endpoint to respond
    const waitOn = (await import('wait-on')).default;
    try {
      if (splashWindow) {
        splashWindow.webContents.send('status', 'Vérification du service...');
      }

      await waitOn({
        resources: [`http-get://127.0.0.1:${port}/api/v1/health/`],
        timeout: 45000,
        interval: 400,
        window: 800,
      });

      log.info('[Startup] Backend is healthy and ready.');
      resolve();
    } catch (err) {
      log.error('[Startup] Timeout waiting for backend:', err);
      reject(err);
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(iconPath)) {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Ouvrir ShoeDZ', click: () => { if (mainWindow) mainWindow.show(); } },
      {
        label: 'Ouvrir dossier des sauvegardes',
        click: () => shell.openPath(path.join(dataDir, 'backups')),
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]);
    tray.setToolTip('ShoeDZ - Pointure');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) mainWindow.show();
    });
  }
}

// IPC Handlers
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('open-backups-folder', () => {
  return shell.openPath(path.join(dataDir, 'backups'));
});

// Second instance focus
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  createSplashWindow();
  createTray();

  try {
    // 1. Assign ports
    backendPort = await findFreePort(8745);
    pdfBridgePort = await findFreePort(8746);

    // 2. Start PDF bridge
    startPdfBridge(pdfBridgePort, bridgeToken);

    // 3. Start backend WSGI server
    await startBackendServer(backendPort, pdfBridgePort, bridgeToken);

    // 4. Open Main Window
    createMainWindow(backendPort);

  } catch (err) {
    log.error('Startup failure:', err);
    if (!splashWindow) {
      dialog.showErrorBox('Erreur de démarrage', `Impossible de démarrer ShoeDZ: ${err.message}`);
      app.quit();
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(backendPort);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPdfBridge();
  if (backendProcess) {
    log.info('Terminating backend process...');
    backendProcess.kill('SIGTERM');
  }
});
