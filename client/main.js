const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    serverUrl: 'http://localhost:3000',
    hotkey: 'CommandOrControl+Enter',
    token: null,
    nickname: null,
    bounds: null,
    opacity: 0.85
  }
});

let mainWindow = null;
let locked = false;
let clickThroughActive = false;

function createWindow() {
  const saved = store.get('bounds');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const defaults = {
    width: 380,
    height: 520,
    x: Math.max(0, sw - 400),
    y: Math.max(0, Math.floor(sh / 2 - 260))
  };

  mainWindow = new BrowserWindow({
    width: saved?.width || defaults.width,
    height: saved?.height || defaults.height,
    x: saved?.x ?? defaults.x,
    y: saved?.y ?? defaults.y,
    minWidth: 280,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setOpacity(store.get('opacity') || 0.85);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    if (!mainWindow.isDestroyed()) {
      store.set('bounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = store.get('hotkey') || 'CommandOrControl+Enter';
  try {
    const ok = globalShortcut.register(hotkey, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.setAlwaysOnTop(true, locked ? 'screen-saver' : 'floating');
      mainWindow.focus();
      mainWindow.webContents.send('focus-input');
    });
    if (!ok) console.warn('Не удалось зарегистрировать хоткей:', hotkey);
  } catch (e) {
    console.warn('Ошибка хоткея:', e.message);
  }
}

ipcMain.handle('get-settings', () => ({
  serverUrl: store.get('serverUrl'),
  hotkey: store.get('hotkey'),
  token: store.get('token'),
  nickname: store.get('nickname'),
  opacity: store.get('opacity'),
  locked
}));

ipcMain.handle('set-settings', (_e, partial) => {
  if (partial.serverUrl != null) store.set('serverUrl', String(partial.serverUrl).replace(/\/$/, ''));
  if (partial.hotkey != null) {
    store.set('hotkey', partial.hotkey);
    registerHotkey();
  }
  if (partial.opacity != null) {
    const o = Math.min(1, Math.max(0.4, Number(partial.opacity)));
    store.set('opacity', o);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(o);
  }
  if (partial.token !== undefined) store.set('token', partial.token);
  if (partial.nickname !== undefined) store.set('nickname', partial.nickname);
  return {
    serverUrl: store.get('serverUrl'),
    hotkey: store.get('hotkey'),
    token: store.get('token'),
    nickname: store.get('nickname'),
    opacity: store.get('opacity'),
    locked
  };
});

ipcMain.handle('set-locked', (_e, value) => {
  locked = !!value;
  if (!mainWindow || mainWindow.isDestroyed()) return { locked };

  if (locked) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setResizable(false);
    // Start with click-through; renderer will toggle off over interactive elements
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    clickThroughActive = true;
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    mainWindow.setIgnoreMouseEvents(false);
    clickThroughActive = false;
  }
  return { locked };
});

ipcMain.handle('set-ignore-mouse', (_e, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed() || !locked) return;
  if (ignore && !clickThroughActive) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    clickThroughActive = true;
  } else if (!ignore && clickThroughActive) {
    mainWindow.setIgnoreMouseEvents(false);
    clickThroughActive = false;
  }
});

ipcMain.handle('blur-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Blur so focus returns to previously active (game) window
  mainWindow.blur();
  if (process.platform === 'win32') {
    // On Windows, briefly hide from focus without destroying
    try { mainWindow.setFocusable(false); mainWindow.setFocusable(true); } catch (_) {}
  }
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();
  registerHotkey();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
