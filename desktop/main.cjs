/**
 * endBuy — processus principal Electron.
 *
 * Deux modes :
 *  - « remote » : l'application se connecte à un serveur endBuy hébergé (URL configurable) ;
 *  - « local »  : l'application démarre son propre serveur endBuy embarqué (API + WebSocket +
 *                 PostgreSQL embarqué via PGlite), éventuellement partagé sur le réseau local.
 * Dans les deux cas, l'interface est servie par le serveur et affichée dans une fenêtre dédiée.
 */
const { app, BrowserWindow, ipcMain, session, shell, desktopCapturer, Tray, Menu, nativeImage, Notification, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const APP_DIR = __dirname;
const ICON = path.join(APP_DIR, 'build', 'icon.png');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const buildConfig = readJson(path.join(APP_DIR, 'app-config.json'), {});
const defaults = {
  mode: buildConfig.defaultServerUrl ? 'remote' : 'local',
  serverUrl: buildConfig.defaultServerUrl || '',
  lanHosting: false,
  localPort: 3001,
  closeToTray: true,
};
let config = { ...defaults, ...readJson(CONFIG_PATH, {}) };

function saveConfig(next) {
  config = { ...config, ...next };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function normalizeUrl(u) {
  return String(u || '')
    .trim()
    .replace(/\/+$/, '');
}

// Un serveur distant en HTTP (réseau local) doit être traité comme « sécurisé » pour autoriser micro / caméra.
if (config.mode === 'remote' && /^http:\/\//.test(config.serverUrl)) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', normalizeUrl(config.serverUrl));
}
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.setAppUserModelId('com.endbuy.desktop');

/* ------------------------------------------------------------------ */
/* Instance unique                                                     */
/* ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let splash = null;
let tray = null;
let embedded = null;
let appUrl = '';
let quitting = false;
let selectedSource = null;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

/* ------------------------------------------------------------------ */
/* Serveur embarqué                                                    */
/* ------------------------------------------------------------------ */
function portFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function lanAddresses(port) {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(`http://${i.address}:${port}`);
    }
  }
  return out;
}

async function startEmbeddedServer() {
  process.env.ENDBUY_EMBEDDED = '1';
  const { startServer } = await import(pathToFileURL(path.join(APP_DIR, 'server', 'endbuy-server.mjs')).href);
  const host = config.lanHosting ? '0.0.0.0' : '127.0.0.1';
  const port = (await portFree(config.localPort, host)) ? config.localPort : 0;
  embedded = await startServer({
    port,
    host,
    dataDir: path.join(app.getPath('userData'), 'server-data'),
    clientDir: path.join(APP_DIR, 'client'),
    databaseUrl: null,
    log: true,
    allowedOrigins: [],
  });
  return `http://127.0.0.1:${embedded.port}`;
}

function setSplashText(text) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`document.querySelector('p').textContent = ${JSON.stringify(text)}`).catch(() => {});
  }
}

function checkReachable(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https:') ? https : http;
      const req = mod.get(`${url}/api/health`, { timeout: 15000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Fenêtres                                                            */
/* ------------------------------------------------------------------ */
function createSplash() {
  splash = new BrowserWindow({
    width: 340,
    height: 380,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    icon: ICON,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  splash.loadFile(path.join(APP_DIR, 'pages', 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => (splash = null));
}

function isAppUrl(target) {
  try {
    return new URL(target).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'endBuy',
    icon: ICON,
    backgroundColor: '#0b0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d10', symbolColor: '#b4bac2', height: 32 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.removeMenu();

  // Liens externes → navigateur par défaut ; navigation limitée au serveur endBuy.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isAppUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url) && !url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (splash) splash.close();
  });
  mainWindow.on('focus', () => mainWindow && mainWindow.flashFrame(false));
  mainWindow.on('close', (e) => {
    if (!quitting && config.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(APP_DIR, 'build', 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : img);
    tray.setToolTip('endBuy');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir endBuy', click: () => mainWindow && (mainWindow.show(), mainWindow.focus()) },
        { type: 'separator' },
        {
          label: 'Fermer dans la zone de notification',
          type: 'checkbox',
          checked: config.closeToTray,
          click: (item) => saveConfig({ closeToTray: item.checked }),
        },
        { type: 'separator' },
        {
          label: 'Quitter endBuy',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => mainWindow && (mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show()));
  } catch (e) {
    console.error('[endBuy] zone de notification indisponible', e);
  }
}

/* ------------------------------------------------------------------ */
/* Permissions (micro, caméra, écran, notifications)                   */
/* ------------------------------------------------------------------ */
function setupPermissions() {
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc.getURL();
    callback(allowed.has(permission) && isAppUrl(origin));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isAppUrl(requestingOrigin);
  });
  // Partage d'écran : la source est choisie dans le sélecteur endBuy (ou l'écran principal par défaut).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const choice = (selectedSource && sources.find((s) => s.id === selectedSource.id)) || sources.find((s) => s.id.startsWith('screen:')) || sources[0];
      const withAudio = selectedSource ? selectedSource.audio : false;
      selectedSource = null;
      if (!choice) return callback({});
      callback({ video: choice, audio: withAudio && process.platform === 'win32' ? 'loopback' : undefined });
    } catch (e) {
      console.error('[endBuy] partage d’écran', e);
      callback({});
    }
  });
}

/* ------------------------------------------------------------------ */
/* IPC (pont exposé par preload.cjs)                                   */
/* ------------------------------------------------------------------ */
let badgeImage = null;
function setupIpc() {
  ipcMain.handle('endbuy:get-config', () => ({
    mode: config.mode,
    serverUrl: config.serverUrl,
    lanHosting: config.lanHosting,
    lanUrls: config.mode === 'local' && config.lanHosting && embedded ? lanAddresses(embedded.port) : [],
    localUrl: config.mode === 'local' && embedded ? `http://127.0.0.1:${embedded.port}` : null,
  }));

  ipcMain.handle('endbuy:set-server', async (_e, cfg) => {
    const next = {};
    if (cfg && (cfg.mode === 'local' || cfg.mode === 'remote')) next.mode = cfg.mode;
    if (cfg && typeof cfg.serverUrl === 'string') {
      const url = normalizeUrl(cfg.serverUrl);
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('URL invalide');
      next.serverUrl = url;
    }
    if (cfg && typeof cfg.lanHosting === 'boolean') next.lanHosting = cfg.lanHosting;
    saveConfig(next);
    quitting = true;
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('endbuy:retry', () => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('endbuy:get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      isScreen: s.id.startsWith('screen:'),
    }));
  });

  ipcMain.handle('endbuy:select-screen-source', (_e, id, audio) => {
    selectedSource = { id: String(id), audio: !!audio };
  });

  ipcMain.on('endbuy:set-badge', (_e, count) => {
    if (!mainWindow) return;
    const n = Number(count) || 0;
    if (process.platform === 'win32') {
      if (!badgeImage) badgeImage = nativeImage.createFromPath(path.join(APP_DIR, 'build', 'badge.png'));
      mainWindow.setOverlayIcon(n > 0 ? badgeImage : null, n > 0 ? `${n} notification(s)` : '');
    } else {
      app.setBadgeCount(n);
    }
  });

  ipcMain.on('endbuy:flash-frame', () => {
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  });

  ipcMain.on('endbuy:notify', (_e, title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 300), icon: ICON });
    n.on('click', () => mainWindow && (mainWindow.show(), mainWindow.focus()));
    n.show();
  });

  ipcMain.on('endbuy:open-external', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
  });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
function showError(kind, message) {
  appUrl = 'file://';
  if (!mainWindow) createMainWindow();
  const q = new URLSearchParams({ kind, message: String(message || ''), url: config.serverUrl || '' });
  mainWindow.loadFile(path.join(APP_DIR, 'pages', 'error.html'), { search: q.toString() });
}

app.whenReady().then(async () => {
  createSplash();
  setupIpc();
  setupPermissions();
  createTray();
  try {
    if (config.mode === 'remote' && config.serverUrl) {
      appUrl = normalizeUrl(config.serverUrl);
      // Un serveur hébergé gratuitement s'endort après une période d'inactivité : on lui laisse le temps de se réveiller.
      let ok = false;
      const deadline = Date.now() + 120_000;
      for (let attempt = 0; !ok && Date.now() < deadline; attempt++) {
        ok = await checkReachable(appUrl);
        if (!ok) {
          setSplashText(attempt === 0 ? 'Réveil du serveur endBuy…' : `Réveil du serveur endBuy… (${Math.round((deadline - Date.now()) / 1000)} s)`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (!ok) return showError('unreachable', `Impossible de joindre ${appUrl}`);
    } else {
      appUrl = await startEmbeddedServer();
    }
    createMainWindow();
    await mainWindow.loadURL(appUrl);
  } catch (e) {
    console.error('[endBuy] démarrage impossible', e);
    showError('startup', e && e.message ? e.message : String(e));
  }
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', (e) => {
  if (embedded) {
    e.preventDefault();
    const srv = embedded;
    embedded = null;
    srv
      .close()
      .catch(() => {})
      .finally(() => app.exit(0));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (e) => {
  console.error('[endBuy] erreur', e);
  if (!app.isReady()) return;
  dialog.showErrorBox('endBuy', `Une erreur inattendue est survenue :\n${e && e.message ? e.message : e}`);
});
