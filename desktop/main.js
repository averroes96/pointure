/**
 * ShoeDZ Desktop - Electron Main Process
 *
 * Responsibilities:
 *  - Supervise the embedded Python (Waitress/Django) backend
 *  - Run the Chromium PDF bridge
 *  - Show splash/progress, surface startup errors to the user
 *  - Write diagnostic logs to %ProgramData%\ShoeDZ\logs
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, shell, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const os = require('os');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { startPdfBridge, stopPdfBridge } = require('./pdf-bridge');

// ── Single instance ─────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// ── Low-spec & 4GB RAM Hardware Optimizations ──────────────────────────────
// Enforce aggressive V8 garbage collection at 256MB to prevent memory bloat on 4GB RAM machines
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
// Disable site isolation overhead for this single-origin desktop application
app.commandLine.appendSwitch('disable-site-isolation-trials');
// Disable background occlusion tracking and unused Chromium features to save CPU cycles
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI');
// Enable zero-copy memory transfers between CPU and integrated GPU
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-rasterization');

// ── Shared application data path ────────────────────────────────────────────
const isWindows = process.platform === 'win32';
const dataDir = isWindows && process.env.PROGRAMDATA
  ? path.join(process.env.PROGRAMDATA, 'ShoeDZ')
  : path.join(app.getPath('appData'), 'ShoeDZ');
const logsDir = path.join(dataDir, 'logs');
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (err) {
  // Directory might already exist or handled by installer permissions
}

// ── Logging ─────────────────────────────────────────────────────────────────
// desktop.log  : Electron main process, backend stdout/stderr, renderer console,
//                failed HTTP requests, crashes.
// shodz.log    : Django / Waitress application log (written by Python).
// python-faults.log : Hard Python crashes (faulthandler).
log.transports.file.resolvePathFn = () => path.join(logsDir, 'desktop.log');
log.transports.file.maxSize = 5 * 1024 * 1024; // rotate to desktop.old.log at 5 MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
Object.assign(console, log.functions);

process.on('uncaughtException', (err) => log.error('[Main] Uncaught exception:', err));
process.on('unhandledRejection', (reason) => log.error('[Main] Unhandled rejection:', reason));

// ── State ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendExited = false;
let backendStderrTail = '';
let tray = null;
let backendPort = 8745;
let pdfBridgePort = 8746;
let isQuitting = false;
const bridgeToken = crypto.randomBytes(24).toString('hex');
const isDev = !app.isPackaged;

// Max time to wait for the backend to become healthy. First launch runs all
// database migrations, which can take several minutes on slow disks or when
// antivirus scans every file write. We keep waiting as long as the backend
// process is alive, up to this ceiling.
const STARTUP_TIMEOUT_MS = 10 * 60 * 1000;

// ── Path resolution ─────────────────────────────────────────────────────────
function resolvePythonBinary() {
  if (isDev) return isWindows ? 'python' : 'python3';
  const bundled = path.join(process.resourcesPath, 'python', 'pythonw.exe');
  if (fs.existsSync(bundled)) return bundled;
  return path.join(process.resourcesPath, 'python', 'python.exe');
}

function resolveBackendRoot() {
  return isDev ? path.join(__dirname, '..', 'backend') : path.join(process.resourcesPath, 'backend');
}

function resolveDesktopPythonModule() {
  return isDev ? path.join(__dirname, 'python') : path.join(process.resourcesPath, 'python');
}

async function findFreePort(defaultPort) {
  try {
    const getPort = (await import('get-port')).default;
    return await getPort({ port: defaultPort });
  } catch (err) {
    log.warn(`[Startup] get-port failed, falling back to ${defaultPort}:`, err);
    return defaultPort;
  }
}

// ── Splash helpers ──────────────────────────────────────────────────────────
function splashStatus(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('status', msg);
  }
}

function splashError(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('error', msg);
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 340,
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
  splashWindow.on('closed', () => { splashWindow = null; });
}

// ── Main window ─────────────────────────────────────────────────────────────
function attachDiagnostics(win, label) {
  const wc = win.webContents;

  // Renderer console → desktop.log (warnings and errors only, to keep log small)
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      const fn = level >= 3 ? log.error : log.warn;
      fn(`[${label} console] ${message} (${sourceId}:${line})`);
    }
  });

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    log.error(`[${label}] did-fail-load code=${code} desc=${desc} url=${url} mainFrame=${isMainFrame}`);
  });

  wc.on('render-process-gone', (_e, details) => {
    log.error(`[${label}] Renderer process gone:`, details);
  });

  wc.on('unresponsive', () => log.warn(`[${label}] Window became unresponsive`));
  wc.on('responsive', () => log.info(`[${label}] Window responsive again`));
  wc.on('preload-error', (_e, p, err) => log.error(`[${label}] Preload error in ${p}:`, err));
}

function showLoadErrorPage(win, title, detail) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>ShoeDZ</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;display:flex;
  align-items:center;justify-content:center;height:100vh;margin:0}.c{background:#fff;border:1px solid #e2e8f0;
  border-radius:12px;padding:32px;max-width:560px}h1{font-size:20px;color:#dc2626}pre{background:#f1f5f9;
  padding:12px;border-radius:8px;white-space:pre-wrap;font-size:12px}</style></head><body><div class="c">
  <h1>${title}</h1><pre>${String(detail).replace(/</g, '&lt;')}</pre>
  <p>Journaux : ${logsDir.replace(/\\/g, '\\\\')}</p></div></body></html>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Strip native menu so Windows Chromium doesn't intercept F10 or Alt for menu navigation
  mainWindow.setMenu(null);
  if (typeof mainWindow.removeMenu === 'function') {
    mainWindow.removeMenu();
  }

  // Intercept keyboard events at the lowest Chromium level before Windows menu bar or browser defaults swallow them
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = input.key;

    // Handle F1 through F12
    if (/^F([1-9]|1[0-2])$/.test(key)) {
      // F11: Fullscreen toggle
      if (key === 'F11') {
        event.preventDefault();
        const nextFs = !mainWindow.isFullScreen();
        mainWindow.setFullScreen(nextFs);
        mainWindow.webContents.send('keyboard-shortcut', {
          key: 'F11',
          fullscreen: nextFs,
          altKey: input.alt,
          ctrlKey: input.control,
          shiftKey: input.shift,
        });
        return;
      }

      // F5: Toggle side navigation menu (suppress accidental un-modified reload)
      if (key === 'F5' && !input.control) {
        event.preventDefault();
        mainWindow.webContents.send('keyboard-shortcut', {
          key: 'F5',
          code: input.code,
          altKey: input.alt,
          ctrlKey: input.control,
          shiftKey: input.shift,
        });
        return;
      }

      // F10, F2, F1, etc.: Prevent Windows default menu/help actions and notify renderer
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.focus();
      }
      mainWindow.webContents.send('keyboard-shortcut', {
        key: key,
        code: input.code,
        altKey: input.alt,
        ctrlKey: input.control,
        shiftKey: input.shift,
      });
      return;
    }

    // Handle Alt + 1..9 quick combinations without letting Windows hijack Alt for menu mnemonics
    if (input.alt && !input.control && /^[1-9]$/.test(key)) {
      event.preventDefault();
      mainWindow.webContents.send('keyboard-shortcut', {
        key: `Alt+${key}`,
        altKey: true,
        ctrlKey: false,
        shiftKey: input.shift,
      });
      return;
    }

    // Handle Alt+P (Paramètres), Alt+S (Settings), or Ctrl+, (Settings standard)
    if (
      (input.alt && !input.control && (key === 'p' || key === 'P' || key === 's' || key === 'S')) ||
      (input.control && !input.alt && (key === ',' || input.code === 'Comma'))
    ) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.focus();
      }
      const shortcutKey = input.control ? 'Ctrl+,' : `Alt+${key.toUpperCase()}`;
      mainWindow.webContents.send('keyboard-shortcut', {
        key: shortcutKey,
        altKey: input.alt,
        ctrlKey: input.control,
        shiftKey: input.shift,
      });
      return;
    }
  });

  attachDiagnostics(mainWindow, 'MainWindow');

  const appUrl = `http://127.0.0.1:${port}/`;
  log.info(`[Startup] Loading main window: ${appUrl}`);

  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    if (splashWindow) splashWindow.close();
    mainWindow.show();
    mainWindow.maximize();
  };

  mainWindow.once('ready-to-show', reveal);
  // Safety net: never leave the user staring at the splash if ready-to-show is missed.
  setTimeout(reveal, 15000);

  mainWindow.webContents.on('did-finish-load', () => {
    log.info(`[MainWindow] did-finish-load ${mainWindow.webContents.getURL()}`);
    // Detect "white screen": React never mounted into #root.
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const mounted = await mainWindow.webContents.executeJavaScript(
          "(() => { const r = document.getElementById('root'); return !!(r && r.childElementCount > 0); })()"
        );
        if (!mounted && mainWindow.webContents.getURL().startsWith(appUrl)) {
          log.error('[MainWindow] Frontend did not mount into #root after 8s (white screen). ' +
            'Check failed requests above for missing JS/CSS assets.');
        }
      } catch (err) {
        log.warn('[MainWindow] Mount check failed:', err);
      }
    }, 8000);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* ERR_ABORTED */) {
      showLoadErrorPage(mainWindow, "Impossible de charger l'application", `${desc} (${code})\n${url}`);
      reveal();
    }
  });

  mainWindow.loadURL(appUrl);

  // Block external navigation from leaving loopback, but allow internal blob: URLs & about:blank inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url.startsWith('about:') || url.startsWith(`http://127.0.0.1:${port}`)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            plugins: true,
          },
        },
      };
    }
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Backend process ─────────────────────────────────────────────────────────
function handleBackendLine(line) {
  if (!line) return;
  log.info(`[Backend] ${line}`);
  if (line.includes('[ShoeDZ]')) {
    splashStatus(line.substring(line.indexOf('[ShoeDZ]') + 8).trim());
  }
}

function lineSplitter(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    parts.forEach((l) => onLine(l.trimEnd()));
  };
}

function spawnBackend(port, bridgePort, token) {
  const pythonExe = resolvePythonBinary();
  const backendRoot = resolveBackendRoot();
  const desktopModule = resolveDesktopPythonModule();

  log.info(`[Startup] Python: ${pythonExe} (exists=${fs.existsSync(pythonExe)})`);
  log.info(`[Startup] Backend root: ${backendRoot} (exists=${fs.existsSync(backendRoot)})`);
  log.info(`[Startup] Data dir: ${dataDir}`);

  const env = Object.assign({}, process.env, {
    SHODZ_DATA_DIR: dataDir,
    PDF_BRIDGE_URL: `http://127.0.0.1:${bridgePort}/render-pdf`,
    PDF_BRIDGE_TOKEN: token,
    DJANGO_SETTINGS_MODULE: 'config.settings.desktop',
    // Unbuffered + UTF-8 so progress lines reach us immediately and Arabic/French text is intact.
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONPATH: `${desktopModule}${path.delimiter}${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}`,
  });

  const args = ['-u', '-m', 'shodz_desktop', 'serve', '--port', String(port)];
  backendExited = false;
  backendStderrTail = '';

  backendProcess = spawn(pythonExe, args, {
    env,
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  log.info(`[Startup] Backend spawned pid=${backendProcess.pid}`);

  backendProcess.stdout.on('data', lineSplitter(handleBackendLine));
  backendProcess.stderr.on('data', lineSplitter((line) => {
    if (!line) return;
    backendStderrTail = (backendStderrTail + line + '\n').slice(-6000);
    // Python logging writes INFO to stderr too; only flag real problems as errors.
    if (/Traceback|Error|Exception|CRITICAL|\bERROR\b/.test(line)) {
      log.error(`[Backend ERR] ${line}`);
    } else {
      log.info(`[Backend] ${line}`);
    }
  }));

  backendProcess.on('error', (err) => {
    log.error('[Backend] Failed to spawn:', err);
    backendStderrTail += `\nSpawn error: ${err.message}`;
    backendExited = true;
  });

  backendProcess.on('exit', (code, signal) => {
    backendExited = true;
    log.warn(`[Backend] Process exited code=${code} signal=${signal}`);
    if (!isQuitting && mainWindow) {
      dialog.showErrorBox(
        'ShoeDZ - Service arrêté',
        `Le service interne s'est arrêté de façon inattendue (code ${code}).\n\n` +
        `Journaux : ${logsDir}\n\n${backendStderrTail.slice(-1500)}`
      );
    }
  });
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/health/', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForBackend(port) {
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
    if (backendExited) {
      throw new Error(`Le service interne s'est arrêté pendant le démarrage.\n\n${backendStderrTail.slice(-2500)}`);
    }
    if (await probeHealth(port)) {
      log.info(`[Startup] Backend healthy after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return;
    }
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log.info(`[Startup] Still waiting for backend (${Math.round((Date.now() - started) / 1000)}s elapsed)...`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Le service interne n'a pas répondu après ${STARTUP_TIMEOUT_MS / 60000} minutes.`);
}

function killBackend() {
  if (!backendProcess || backendExited) return;
  const pid = backendProcess.pid;
  log.info(`[Shutdown] Terminating backend pid=${pid}`);
  if (isWindows && pid) {
    // Kill the whole process tree; plain kill() can leave orphaned pythonw.exe holding the DB/port.
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err) => {
      if (err) log.warn('[Shutdown] taskkill failed:', err.message);
    });
  } else {
    backendProcess.kill('SIGTERM');
  }
}

// ── Auto Updater Configuration ──────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

autoUpdater.on('checking-for-update', () => {
  log.info('[Updater] Checking for updates...');
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  log.info(`[Updater] Update available: v${info.version}`);
  sendUpdateStatus('available', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
  });
});

autoUpdater.on('update-not-available', (info) => {
  log.info(`[Updater] Up to date (v${app.getVersion()})`);
  sendUpdateStatus('not-available', { currentVersion: app.getVersion() });
});

function formatUpdaterError(msg) {
  if (!msg) return 'Erreur lors de la vérification des mises à jour.';
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('ENOTFOUND') || msg.includes('SimpleURLLoaderWrapper')) {
    return 'Connexion impossible à GitHub : problème de résolution DNS ou pas d\'accès Internet sur cette machine.';
  }
  if (msg.includes('ERR_INTERNET_DISCONNECTED') || msg.includes('NETWORK_CHANGED')) {
    return 'Aucune connexion Internet active sur cette machine.';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('ERR_TIMED_OUT')) {
    return 'Délai d\'attente dépassé lors de la connexion aux serveurs de mise à jour.';
  }
  return msg;
}

autoUpdater.on('error', (err) => {
  const msg = err ? err.message : '';
  if (msg.includes('No published versions on GitHub') || msg.includes('404')) {
    log.info('[Updater] No published releases found on GitHub — app is currently up to date.');
    sendUpdateStatus('not-available', { currentVersion: app.getVersion() });
    return;
  }
  log.warn('[Updater] Error:', msg);
  sendUpdateStatus('error', { message: formatUpdaterError(msg) });
});

autoUpdater.on('download-progress', (progressObj) => {
  sendUpdateStatus('downloading', {
    percent: Math.round(progressObj.percent),
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  log.info(`[Updater] Update downloaded: v${info.version}`);
  sendUpdateStatus('downloaded', { version: info.version });

  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour prête',
      message: `La mise à jour ShoeDZ ${info.version} a été téléchargée.`,
      detail: 'Souhaitez-vous redémarrer maintenant pour l\'installer ? Vos magasins et données sont conservés.',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        quitAndInstallUpdate();
      }
    });
  }
});

function quitAndInstallUpdate() {
  log.info('[Updater] Terminating services & launching installer...');
  isQuitting = true;
  stopPdfBridge();
  killBackend();
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 500);
}

// ── Tray ────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  if (!fs.existsSync(iconPath)) return;
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ouvrir ShoeDZ', click: () => { if (mainWindow) mainWindow.show(); } },
    {
      label: 'Vérifier les mises à jour',
      click: () => {
        if (app.isPackaged) {
          autoUpdater.checkForUpdates();
        } else {
          dialog.showMessageBox({
            type: 'info',
            title: 'Mode développement',
            message: 'La mise à jour automatique est active uniquement dans l\'application installée.',
          });
        }
      },
    },
    { label: 'Ouvrir dossier des sauvegardes', click: () => shell.openPath(path.join(dataDir, 'backups')) },
    { label: 'Ouvrir dossier des journaux', click: () => shell.openPath(logsDir) },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setToolTip('ShoeDZ - Pointure');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (mainWindow) mainWindow.show(); });
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('open-backups-folder', () => shell.openPath(path.join(dataDir, 'backups')));
ipcMain.handle('open-logs-folder', () => shell.openPath(logsDir));
ipcMain.handle('resync-system-clock', async () => {
  if (process.platform === 'win32') {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('w32tm /resync /nowait', (error, stdout, stderr) => {
        resolve({ success: !error, output: (stdout || stderr || '').trim() });
      });
    });
  }
  return { success: false, output: 'Supported on Windows platforms' };
});
ipcMain.handle('quit-app', () => app.quit());
ipcMain.handle('focus-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.focus();
    return true;
  }
  return false;
});
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  }
  return false;
});
ipcMain.handle('is-fullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

// ── Native Printing IPC ──────────────────────────────────────────────────
ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers;
  } catch (err) {
    log.error('[Printers] Failed to query system printers:', err);
    return [];
  }
});

ipcMain.handle('print-html', async (_event, options) => {
  const { html, deviceName, silent, pageSize, copies } = options || {};
  return new Promise((resolve) => {
    try {
      const printWin = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      printWin.webContents.on('did-finish-load', () => {
        const printOptions = {
          silent: !!silent,
          printBackground: true,
          deviceName: deviceName || '',
          copies: copies || 1,
        };
        if (pageSize) {
          printOptions.pageSize = pageSize;
        }

        printWin.webContents.print(printOptions, (success, failureReason) => {
          printWin.destroy();
          resolve({ success, failureReason });
        });
      });

      printWin.webContents.on('did-fail-load', (_e, code, desc) => {
        printWin.destroy();
        resolve({ success: false, failureReason: `${desc} (${code})` });
      });

      const encoded = Buffer.from(html || '', 'utf8').toString('base64');
      printWin.loadURL(`data:text/html;charset=utf-8;base64,${encoded}`);
    } catch (err) {
      log.error('[Printers] print-html error:', err);
      resolve({ success: false, failureReason: err.message });
    }
  });
});

// ── Native PDF Document Viewer IPC ──────────────────────────────────────
ipcMain.handle('view-pdf', async (_event, options) => {
  const { base64, title, filename } = options || {};
  if (!base64) return { success: false, error: 'Données PDF manquantes' };

  try {
    const tempDir = path.join(os.tmpdir(), 'ShoeDZ_PDFs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const safeName = (filename || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
    const tempPath = path.join(tempDir, `${safeName}_${Date.now()}.pdf`);
    fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));

    const pdfWin = new BrowserWindow({
      title: title || 'ShoeDZ — Document PDF',
      width: 1024,
      height: 850,
      autoHideMenuBar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true,
        sandbox: false,
      },
    });

    const menuTemplate = [
      {
        label: 'Fichier',
        submenu: [
          {
            label: 'Imprimer... (Ctrl+P)',
            accelerator: 'CmdOrCtrl+P',
            click: () => {
              pdfWin.webContents.print();
            },
          },
          {
            label: 'Ouvrir avec le lecteur Windows (Edge / Acrobat)',
            click: () => {
              shell.openPath(tempPath);
            },
          },
          { type: 'separator' },
          {
            label: 'Fermer',
            accelerator: 'CmdOrCtrl+W',
            click: () => {
              pdfWin.close();
            },
          },
        ],
      },
      {
        label: 'Affichage',
        submenu: [
          { role: 'zoomIn', label: 'Zoomer (+)' },
          { role: 'zoomOut', label: 'Dézoomer (-)' },
          { role: 'resetZoom', label: 'Taille normale (100%)' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
    ];
    pdfWin.setMenu(Menu.buildFromTemplate(menuTemplate));

    const fileUrl = pathToFileURL(tempPath).href;
    await pdfWin.loadURL(fileUrl);

    pdfWin.on('closed', () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {}
      }, 5000);
    });

    return { success: true };
  } catch (err) {
    log.error('[PDF] view-pdf error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-pdf-external', async (_event, options) => {
  const { base64, filename } = options || {};
  if (!base64) return { success: false, error: 'Données PDF manquantes' };
  try {
    const tempDir = path.join(os.tmpdir(), 'ShoeDZ_PDFs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const safeName = (filename || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
    const tempPath = path.join(tempDir, `${safeName}_${Date.now()}.pdf`);
    fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));
    await shell.openPath(tempPath);
    return { success: true };
  } catch (err) {
    log.error('[PDF] open-pdf-external error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { status: 'dev-mode', message: 'Mises à jour actives uniquement dans l\'application installée.' };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    return { status: 'ok', updateInfo: res?.updateInfo };
  } catch (err) {
    if (err?.message?.includes('No published versions on GitHub') || err?.message?.includes('404')) {
      sendUpdateStatus('not-available', { currentVersion: app.getVersion() });
      return { status: 'ok', updateInfo: null, message: 'Application à jour.' };
    }
    return { status: 'error', message: formatUpdaterError(err.message) };
  }
});

ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) return;
  return await autoUpdater.downloadUpdate();
});

ipcMain.handle('install-update', () => {
  quitAndInstallUpdate();
});

app.on('second-instance', () => {
  const win = mainWindow || splashWindow;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// ── Startup ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Completely disable Electron default application menu so Windows never intercepts F10 or Alt
  Menu.setApplicationMenu(null);

  log.info('='.repeat(70));
  log.info(`[Startup] ShoeDZ ${app.getVersion()} | Electron ${process.versions.electron} | ` +
    `${os.type()} ${os.release()} ${os.arch()} | packaged=${app.isPackaged}`);
  log.info(`[Startup] Logs: ${logsDir}`);

  // Log every failed HTTP request from any window (catches missing JS/CSS → white screen).
  session.defaultSession.webRequest.onCompleted({ urls: ['http://127.0.0.1/*', 'http://localhost/*'] }, (d) => {
    if (d.statusCode >= 400) {
      log.warn(`[HTTP ${d.statusCode}] ${d.method} ${d.url} (${d.resourceType})`);
    }
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['http://127.0.0.1/*', 'http://localhost/*'] }, (d) => {
    if (d.error !== 'net::ERR_ABORTED') {
      log.warn(`[HTTP ERR] ${d.method} ${d.url} ${d.error}`);
    }
  });

  createSplashWindow();
  createTray();

  try {
    backendPort = await findFreePort(8745);
    pdfBridgePort = await findFreePort(8746);
    log.info(`[Startup] Ports: backend=${backendPort} pdfBridge=${pdfBridgePort}`);

    startPdfBridge(pdfBridgePort, bridgeToken);

    splashStatus('Démarrage du service...');
    spawnBackend(backendPort, pdfBridgePort, bridgeToken);
    await waitForBackend(backendPort);

    splashStatus("Ouverture de l'application...");
    createMainWindow(backendPort);

    // Check for updates in the background after startup
    if (app.isPackaged) {
      setTimeout(() => {
        log.info('[Startup] Initiating background update check...');
        autoUpdater.checkForUpdates().catch((err) => {
          log.warn('[Updater] Background check failed:', err.message);
        });
      }, 5000);
    }
  } catch (err) {
    log.error('[Startup] Failure:', err);
    splashError(`${err.message}\n\nJournaux : ${logsDir}`);
    if (splashWindow) splashWindow.setAlwaysOnTop(false);

    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Erreur de démarrage',
      message: 'ShoeDZ n\'a pas pu démarrer.',
      detail: `${String(err.message).slice(0, 1500)}\n\nJournaux : ${logsDir}`,
      buttons: ['Ouvrir les journaux', 'Quitter'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await shell.openPath(logsDir);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  log.info('[Shutdown] Application quitting');
  stopPdfBridge();
  killBackend();
});
