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
ipcMain.handle('orders:list', () => [
  {
    id: 1,
    code: '123456',
    status: 'done',
    total: 1000000,
    shipping: 0,
    createdAt: Date.now(),
    chatId: '42',
    customer: { name: 'علی', phone: '09120000000', postalCode: '1234567890', address: 'تهران' },
    items: [{ name: 'رومیزی', size: '۱۲۰×۱۸۰', qty: 1, unitPrice: 1000000 }],
  },
  {
    id: 2,
    code: '654321',
    status: 'pending',
    total: 500000,
    shipping: 0,
    createdAt: Date.now(),
    chatId: '43',
    trackingCode: '',
    customer: { name: 'مریم', phone: '09121111111', postalCode: '1111111111', address: 'اصفهان' },
    items: [{ name: 'کاور مبل', qty: 1, unitPrice: 500000 }],
  },
]);
ipcMain.handle('orders:cancel', () => ({}));
const deletedOrderIds = [];
ipcMain.handle('orders:delete', (_e, id) => {
  deletedOrderIds.push(Number(id));
  return true;
});
ipcMain.handle('orders:tracking', () => ({ order: {}, sent: false }));
ipcMain.handle('views:list', () => []);
ipcMain.handle('abuse:list', () => [
  {
    chatId: '77',
    name: 'کاربر مزاحم',
    username: 'spammer',
    reason: '21 اقدام در ۱۰ ثانیه (اسپم دکمه‌ها)',
    count: 21,
    at: Date.now(),
    blocked: false,
  },
]);
ipcMain.handle('abuse:block', () => []);
ipcMain.handle('abuse:unblock', () => []);
ipcMain.handle('options:list', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
ipcMain.handle('options:add', (_e, kind, value) => (kind === 'capacity' ? ['۴ نفره', value] : ['دایره', value]));
ipcMain.handle('options:remove', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
ipcMain.handle('options:rename', (_e, kind) => (kind === 'capacity' ? ['۴ نفره'] : ['دایره']));
ipcMain.handle('settings:get', () => ({
  shopName: '',
  note: '',
  shippingPrice: 0,
  telegram: { token: '', shopChatId: '', supportUsername: 'MeadowSupport' },
  bale: { token: '', shopChatId: '', supportUsername: '' },
}));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: '/tmp', platform: process.platform }));
ipcMain.handle('bot:start', () => ({ running: false, message: 'test' }));
ipcMain.handle('bot:stop', () => ({ running: false, message: 'test' }));
ipcMain.handle('bot:statuses', () => ({
  telegram: { running: false, message: 'test' },
  bale: { running: false, message: 'test' },
}));

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
    out.hasColorField = !!document.getElementById('colorList');
    out.capacityOptionCount = document.querySelector('.size-row select')?.options.length || 0;
    out.hasOldAttrsSection = !!document.getElementById('btnAddAttr');
    out.hasVideoPicker = !!document.getElementById('btnAddVideo');

    const category = document.getElementById('f-category');
    category.value = 'رومیزی';
    category.dispatchEvent(new Event('change'));
    out.priceHiddenForTablecloth =
      document.getElementById('priceField').classList.contains('hidden') &&
      document.getElementById('stockField').classList.contains('hidden');

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
    out.orderCards = document.querySelectorAll('.order-card').length;
    out.trackInputs = document.querySelectorAll('.track-row input').length;
    out.orderActionButtons = document.querySelectorAll('#ordersList .order-actions .btn').length;
    out.deleteButtons = [...document.querySelectorAll('#ordersList .order-actions .btn')].filter(
      (btn) => btn.textContent === 'حذف سفارش'
    ).length;
    out.hasCancelModal = !!document.getElementById('cancelConfirm');

    const firstDelete = [...document.querySelectorAll('#ordersList .order-actions .btn')].find(
      (btn) => btn.textContent === 'حذف سفارش'
    );
    firstDelete.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    out.confirmModalOpen = !document.getElementById('confirmModal').classList.contains('hidden');
    out.confirmTitle = document.getElementById('confirmTitle').textContent;
    out.confirmDetail = document.getElementById('confirmDetail').textContent;
    out.confirmDanger = document.querySelector('#confirmModal .confirm-box').classList.contains('danger');
    document.getElementById('confirmCancel').click();
    out.confirmModalClosed = document.getElementById('confirmModal').classList.contains('hidden');

    firstDelete.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    document.getElementById('confirmOk').click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    out.confirmModalClosedAfterOk = document.getElementById('confirmModal').classList.contains('hidden');

    document.querySelector('[data-tab="customers"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.customersVisible = document.getElementById('panel-customers').classList.contains('active');
    out.customerCards = document.querySelectorAll('#customersList .customer-card').length;
    const toggle = document.querySelector('#customersList .customer-card .btn');
    if (toggle) { toggle.click(); out.clickedButtons++; }
    out.customerDetailsOpen = !document
      .querySelector('#customersList .cust-details')
      ?.classList.contains('hidden');

    document.querySelector('[data-tab="views"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.viewsVisible = document.getElementById('panel-views').classList.contains('active');
    out.viewsEmptyShown = !document.getElementById('viewsEmpty').classList.contains('hidden');
    out.hasViewsStats = !!document.getElementById('statViewsToday');

    document.querySelector('[data-tab="abuse"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.abuseVisible = document.getElementById('panel-abuse').classList.contains('active');
    out.abuseCards = document.querySelectorAll('#abuseList .customer-card').length;
    out.abuseBlockButtons = document.querySelectorAll('#abuseList .order-actions .btn').length;
    out.hasShippingField = !!document.getElementById('s-shipping');
    out.hasTelegramFields = !!document.getElementById('tg-token') && !!document.getElementById('tg-chat');
    out.hasBaleFields = !!document.getElementById('bale-token') && !!document.getElementById('bale-chat');
    out.hasSupportField = !!document.getElementById('tg-support');
    return out;
  })()`);

  const ok =
    result.hasApi &&
    result.tabs === 6 &&
    result.modalOpened &&
    result.sizeRows === 1 &&
    result.sizeInputs === 3 &&
    result.sizeSelects === 3 &&
    result.hasColorField &&
    result.capacityOptionCount >= 3 &&
    result.hasOldAttrsSection === false &&
    result.priceHiddenForTablecloth &&
    result.hasVideoPicker &&
    result.settingsVisible &&
    result.categoryChipsAfterAdd === 3 &&
    result.capacityChipsBefore === 1 &&
    result.capacityChipsAfter === 2 &&
    result.ordersVisible &&
    result.ordersEmptyShown === false &&
    result.orderCards === 2 &&
    result.trackInputs === 2 &&
    result.orderActionButtons === 3 &&
    result.deleteButtons === 2 &&
    result.hasCancelModal &&
    result.confirmModalOpen &&
    result.confirmTitle === 'حذف سفارش' &&
    result.confirmDetail.includes('علی') &&
    result.confirmDanger &&
    result.confirmModalClosed &&
    result.confirmModalClosedAfterOk &&
    deletedOrderIds.length === 1 &&
    deletedOrderIds[0] === 1 &&
    result.viewsVisible &&
    result.viewsEmptyShown &&
    result.hasViewsStats &&
    result.abuseVisible &&
    result.abuseCards === 1 &&
    result.abuseBlockButtons === 1 &&
    result.customersVisible &&
    result.customerCards === 1 &&
    result.customerDetailsOpen &&
    result.hasShippingField &&
    result.hasTelegramFields &&
    result.hasBaleFields &&
    result.hasSupportField &&
    consoleErrors.length === 0;

  console.log('SMOKE RESULT', JSON.stringify({ ...result, consoleErrors }));
  console.log(ok ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED');

  await win.close();
  app.exit(ok ? 0 : 1);
});
