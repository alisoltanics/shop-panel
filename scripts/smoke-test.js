'use strict';

/**
 * تست دودی رابط کاربری: بارگذاری صفحه، کلیک روی تب تنظیمات و بررسی نبود خطای جاوااسکریپت.
 * اجرا: npm run test:smoke
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const consoleErrors = [];

ipcMain.handle('products:list', () => []);
ipcMain.handle('categories:list', () => ['رومیزی', 'کاور مبل']);
ipcMain.handle('settings:get', () => ({ shopName: '', botToken: '', shopChatId: '', note: '' }));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: '/tmp', platform: process.platform }));
ipcMain.handle('bot:start', () => ({ running: false, message: 'test' }));
ipcMain.handle('bot:stop', () => ({ running: false, message: 'test' }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 600));

  const result = await win.webContents.executeJavaScript(`(() => {
    const out = { hasApi: !!window.api, tabs: 0, settingsVisible: false, clickedButtons: 0 };
    document.querySelectorAll('.tab').forEach(() => out.tabs++);
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) { settingsTab.click(); out.clickedButtons++; }
    out.settingsVisible = document.getElementById('panel-settings').classList.contains('active');
    const newBtn = document.getElementById('btnNew');
    if (newBtn) { newBtn.click(); out.clickedButtons++; }
    out.modalOpened = !document.getElementById('modal').classList.contains('hidden');
    out.hasSizeEditor = !!document.getElementById('btnAddSize');
    out.hasVideoPicker = !!document.getElementById('btnAddVideo');
    out.categoryOptions = document.getElementById('f-category').options.length;
    out.categoryChips = document.querySelectorAll('#categoryList .chip').length;
    const addSize = document.getElementById('btnAddSize');
    if (addSize) { addSize.click(); out.clickedButtons++; }
    out.sizeRows = document.querySelectorAll('.size-row').length;

    const addAttr = document.getElementById('btnAddAttr');
    if (addAttr) { addAttr.click(); out.clickedButtons++; }
    const attrName = document.querySelector('.attr-row .attr-name');
    const attrOptions = document.querySelector('.attr-row .attr-options');
    if (attrName && attrOptions) {
      attrName.value = 'شکل';
      attrName.dispatchEvent(new Event('input'));
      attrOptions.value = 'دایره‌ای، مستطیلی';
      attrOptions.dispatchEvent(new Event('input'));
    }
    out.attrRows = document.querySelectorAll('.attr-row').length;
    out.variantRows = document.querySelectorAll('.variant-row').length;
    return out;
  })()`);

  const ok =
    result.hasApi &&
    result.tabs === 2 &&
    result.settingsVisible &&
    result.modalOpened &&
    result.hasSizeEditor &&
    result.hasVideoPicker &&
    result.categoryOptions >= 3 &&
    result.categoryChips === 2 &&
    result.sizeRows === 1 &&
    result.attrRows === 1 &&
    result.variantRows === 2 &&
    consoleErrors.length === 0;

  console.log('SMOKE RESULT', JSON.stringify({ ...result, consoleErrors }));
  console.log(ok ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED');

  await win.close();
  app.exit(ok ? 0 : 1);
});
