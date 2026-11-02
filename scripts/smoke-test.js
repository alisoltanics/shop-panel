'use strict';

/**
 * تست دودی رابط کاربری: تب‌ها، فرم محصول، ستون‌های ابعاد، گزینه‌ها، دسته‌بندی و سفارش‌ها.
 * اجرا: npm run test:smoke
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const consoleErrors = [];

ipcMain.handle('products:list', () => []);
ipcMain.handle('categories:list', () => ['رومیزی', 'کاور مبل']);
ipcMain.handle('categories:add', (_e, name) => ['رومیزی', 'کاور مبل', name]);
ipcMain.handle('categories:remove', () => ['رومیزی']);
ipcMain.handle('orders:list', () => []);
ipcMain.handle('options:list', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
ipcMain.handle('options:add', (_e, kind, value) => (kind === 'capacity' ? ['۴ نفره', value] : ['دایره', value]));
ipcMain.handle('options:remove', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
ipcMain.handle('options:rename', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
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

  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = { hasApi: !!window.api, tabs: 0, clickedButtons: 0 };

    document.querySelectorAll('.tab').forEach(() => out.tabs++);

    document.querySelector('[data-tab="products"]').click();
    const newBtn = document.getElementById('btnNew');
    if (newBtn) { newBtn.click(); out.clickedButtons++; }
    out.modalOpened = !document.getElementById('modal').classList.contains('hidden');

    const addSize = document.getElementById('btnAddSize');
    if (addSize) { addSize.click(); out.clickedButtons++; }
    out.sizeRows = document.querySelectorAll('.size-row:not(.size-head)').length;
    out.sizeInputs = document.querySelectorAll('.size-row:not(.size-head) input').length;
    out.sizeSelects = document.querySelectorAll('.size-row:not(.size-head) select').length;
    out.capacityOptionCount = document.querySelector('.size-row select')?.options.length || 0;
    out.hasOldAttrsSection = !!document.getElementById('btnAddAttr');
    out.hasVideoPicker = !!document.getElementById('btnAddVideo');

    document.getElementById('modal').classList.add('hidden');

    document.querySelector('[data-tab="settings"]').click();
    out.settingsVisible = document.getElementById('panel-settings').classList.contains('active');

    const newCategory = document.getElementById('newCategory');
    newCategory.value = 'پرده';
    document.getElementById('btnAddCategory').click();
    out.clickedButtons++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.categoryChipsAfterAdd = document.querySelectorAll('#categoryList .chip').length;

    out.capacityChipsBefore = document.querySelectorAll('#capacityList .chip').length;
    const newCapacity = document.getElementById('newCapacity');
    newCapacity.value = '۶ نفره';
    document.getElementById('btnAddCapacity').click();
    out.clickedButtons++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.capacityChipsAfter = document.querySelectorAll('#capacityList .chip').length;

    document.querySelector('[data-tab="orders"]').click();
    out.ordersVisible = document.getElementById('panel-orders').classList.contains('active');
    out.ordersEmptyShown = !document.getElementById('ordersEmpty').classList.contains('hidden');
    out.hasShippingField = !!document.getElementById('s-shipping');
    out.hasMessengerSelect = document.getElementById('s-messenger').options.length === 2;
    out.hasSupportField = !!document.getElementById('s-support');
    return out;
  })()`);

  const ok =
    result.hasApi &&
    result.tabs === 3 &&
    result.modalOpened &&
    result.sizeRows === 1 &&
    result.sizeInputs === 3 &&
    result.sizeSelects === 2 &&
    result.capacityOptionCount >= 3 &&
    result.hasOldAttrsSection === false &&
    result.hasVideoPicker &&
    result.settingsVisible &&
    result.categoryChipsAfterAdd === 3 &&
    result.capacityChipsBefore === 1 &&
    result.capacityChipsAfter === 2 &&
    result.ordersVisible &&
    result.ordersEmptyShown &&
    result.hasShippingField &&
    result.hasMessengerSelect &&
    result.hasSupportField &&
    consoleErrors.length === 0;

  console.log('SMOKE RESULT', JSON.stringify({ ...result, consoleErrors }));
  console.log(ok ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED');

  await win.close();
  app.exit(ok ? 0 : 1);
});
