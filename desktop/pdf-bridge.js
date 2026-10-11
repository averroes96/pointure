/**
 * ShoeDZ Desktop - Electron Chromium PDF Bridge
 *
 * Runs an in-process loopback HTTP server that receives HTML content from Django
 * and generates high-fidelity PDF documents using Chromium's native printToPDF API.
 * Provides complete support for Arabic RTL typography, custom page sizes, and barcodes.
 */
const http = require('http');
const { BrowserWindow } = require('electron');
const log = require('electron-log');

let server = null;
let bridgePort = 8746;
let bridgeToken = '';

/**
 * Start the loopback PDF bridge HTTP server.
 * @param {number} port - Port to listen on (e.g., 8746)
 * @param {string} token - Security token required in X-Bridge-Token header
 */
function startPdfBridge(port, token) {
  bridgePort = port || 8746;
  bridgeToken = token || '';

  server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/render-pdf') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    if (bridgeToken && req.headers['x-bridge-token'] !== bridgeToken) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('Unauthorized');
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const html = payload.html || '';
        const options = payload.options || {
          printBackground: true,
          preferCSSPageSize: true,
        };

        const pdfBuffer = await renderHtmlToPdf(html, options);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBuffer.length,
        });
        res.end(pdfBuffer);
      } catch (err) {
        log.error('[PDF Bridge] Render error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`PDF generation failed: ${err.message}`);
      }
    });
  });

  server.listen(bridgePort, '127.0.0.1', () => {
    log.info(`[PDF Bridge] Listening on http://127.0.0.1:${bridgePort}/render-pdf`);
  });

  return server;
}

/**
 * Render raw HTML string to a PDF buffer using a hidden BrowserWindow.
 */
function renderHtmlToPdf(html, options) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Timeout safety
    const timeout = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('PDF generation timed out after 30 seconds'));
    }, 30000);

    win.webContents.on('did-finish-load', async () => {
      try {
        // Wait a tiny moment for layout and webfonts to settle
        await new Promise(r => setTimeout(r, 100));

        const pdfData = await win.webContents.printToPDF({
          printBackground: options.printBackground !== false,
          preferCSSPageSize: options.preferCSSPageSize !== false,
          marginsType: options.marginsType || 0,
        });

        clearTimeout(timeout);
        win.destroy();
        resolve(pdfData);
      } catch (err) {
        clearTimeout(timeout);
        if (!win.isDestroyed()) win.destroy();
        reject(err);
      }
    });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function stopPdfBridge() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = {
  startPdfBridge,
  stopPdfBridge,
};
