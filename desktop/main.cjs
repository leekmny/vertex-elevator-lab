const { app, BrowserWindow, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolveAssetPath, isAppUrl } = require('./paths.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vertex',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let window;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 760,
    minHeight: 600,
    title: 'VERTEX · 엘리베이터 시뮬레이터',
    backgroundColor: '#10141d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    window = undefined;
  });
  window.loadURL('vertex://app/index.html');
}

if (hasLock) {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const distRoot = path.resolve(__dirname, '..', 'dist');
    protocol.handle('vertex', async (request) => {
      const assetPath = resolveAssetPath(request.url, distRoot);
      if (!assetPath) return new Response('Not found', { status: 404 });
      try {
        if (!fs.statSync(assetPath).isFile()) return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(assetPath).toString());
        const headers = new Headers(response.headers);
        headers.set(
          'Content-Security-Policy',
          "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'",
        );
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on('window-all-closed', () => app.quit());
