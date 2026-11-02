'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const Store = require('./store');
const { startBot } = require('./bot');

let store = null;
let mainWindow = null;
let bot = null;
let botStatus = { running: false, message: 'غیرفعال' };

const imagesDir = () => path.join(app.getPath('userData'), 'images');
const videosDir = () => path.join(app.getPath('userData'), 'videos');

app.setName('ShopPanel');
app.setAppUserModelId('ir.alisoltani.shoppanel');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'appimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

function setBotStatus(status) {
  botStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:status', status);
  }
}

async function startBotFromSettings() {
  if (bot) return botStatus;

  const { botToken } = store.getSettings();
  if (!botToken) {
    setBotStatus({ running: false, message: 'توکن ربات تنظیم نشده است' });
    return botStatus;
  }

  setBotStatus({ running: false, message: 'در حال اتصال...' });
  try {
    bot = await startBot({
      token: botToken,
      messenger: store.getSettings().messenger,
      store,
      imagesDir: imagesDir(),
      videosDir: videosDir(),
      getShopChatId: () => store.getSettings().shopChatId,
      onStatus: setBotStatus,
      onStockChanged: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('products:changed');
        }
      },
    });
  } catch (err) {
    bot = null;
    setBotStatus({ running: false, message: err.message });
  }
  return botStatus;
}

async function stopBot() {
  if (bot) {
    try {
      await bot.stopPolling({ cancel: true });
    } catch {}
    try {
      bot.removeAllListeners();
    } catch {}
    bot = null;
  }
  setBotStatus({ running: false, message: 'غیرفعال' });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0f1115',
    title: 'پنل فروشگاه',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('bot:status', botStatus);
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  fs.mkdirSync(imagesDir(), { recursive: true });
  fs.mkdirSync(videosDir(), { recursive: true });
  store = new Store(path.join(app.getPath('userData'), 'data.json'));

  // سرو کردن عکس‌های محصولات با پروتکل امن داخلی
  protocol.handle('appimg', async (request) => {
    try {
      const url = new URL(request.url);
      const baseDir = url.hostname === 'video' ? videosDir() : imagesDir();
      const name = path.basename(decodeURIComponent(url.pathname));
      const file = path.join(baseDir, name);
      if (!file.startsWith(baseDir) || !fs.existsSync(file)) {
        return new Response('not found', { status: 404 });
      }
      const ext = path.extname(file).toLowerCase();
      const data = fs.readFileSync(file);
      return new Response(data, {
        status: 200,
        headers: { 'content-type': MIME[ext] || 'application/octet-stream' },
      });
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  registerIpc();
  createWindow();

  // اگر توکن ذخیره شده بود، ربات خودکار بالا بیاید
  if (store.getSettings().botToken) {
    startBotFromSettings();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (bot) {
    try {
      bot.stopPolling({ cancel: true });
    } catch {}
  }
});

function registerIpc() {
  ipcMain.handle('products:list', () => store.listProducts());

  ipcMain.handle('products:save', (_e, product) => store.saveProduct(product || {}));

  ipcMain.handle('products:delete', (_e, id) => store.deleteProduct(id));

  ipcMain.handle('images:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'انتخاب عکس‌های محصول',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'تصاویر', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled || !result.filePaths.length) return [];

    const out = [];
    for (const src of result.filePaths) {
      const ext = (path.extname(src) || '.jpg').toLowerCase();
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.copyFileSync(src, path.join(imagesDir(), name));
      out.push(name);
    }
    return out;
  });

  ipcMain.handle('images:remove', (_e, name) => {
    try {
      const file = path.join(imagesDir(), path.basename(String(name)));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('videos:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'انتخاب ویدیو محصول',
      properties: ['openFile'],
      filters: [{ name: 'ویدیو', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv'] }],
    });
    if (result.canceled || !result.filePaths.length) return '';

    const src = result.filePaths[0];
    const ext = (path.extname(src) || '.mp4').toLowerCase();
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.mkdirSync(videosDir(), { recursive: true });
    fs.copyFileSync(src, path.join(videosDir(), name));
    return name;
  });

  ipcMain.handle('videos:remove', (_e, name) => {
    try {
      const file = path.join(videosDir(), path.basename(String(name)));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('categories:list', () => store.listCategories());
  ipcMain.handle('categories:add', (_e, name) => store.addCategory(name));
  ipcMain.handle('categories:remove', (_e, name) => store.removeCategory(name));

  ipcMain.handle('orders:list', () => store.listOrders());

  ipcMain.handle('options:list', (_e, kind) => store.listOptions(kind));
  ipcMain.handle('options:add', (_e, kind, value) => store.addOption(kind, value));
  ipcMain.handle('options:remove', (_e, kind, value) => store.removeOption(kind, value));
  ipcMain.handle('options:rename', (_e, kind, from, to) => store.renameOption(kind, from, to));

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:save', async (_e, settings) => {
    const saved = store.saveSettings(settings || {});
    if (bot) {
      await stopBot();
      await startBotFromSettings();
    } else if (saved.botToken) {
      await startBotFromSettings();
    }
    return { settings: saved, botStatus };
  });

  ipcMain.handle('bot:start', async () => {
    if (!store.getSettings().botToken) {
      setBotStatus({ running: false, message: 'اول توکن ربات را ذخیره کنید' });
      return botStatus;
    }
    await startBotFromSettings();
    return botStatus;
  });

  ipcMain.handle('bot:stop', async () => {
    await stopBot();
    return botStatus;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    platform: process.platform,
  }));

  ipcMain.handle('app:openDataDir', () => shell.openPath(app.getPath('userData')));
}
