'use strict';

/**
 * تست منطق ربات بدون اتصال به تلگرام (کلاینت ساختگی).
 * اجرا: npm run test:bot
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const instances = [];

class FakeClient {
  constructor(token) {
    this.token = token;
    this.handlers = {};
    this.sent = [];
    this.photos = [];
    this.albums = [];
    this.answers = [];
    this.failFor = null;
    instances.push(this);
  }
  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }
  removeAllListeners() {
    this.handlers = {};
  }
  async getMe() {
    return { username: 'test_bot' };
  }
  async call(method, params) {
    this.lastCall = { method, params };
    return true;
  }
  start() {
    this.started = true;
  }
  stopPolling() {
    return Promise.resolve();
  }
  async sendMessage(chatId, text, options = {}) {
    if (this.failFor !== null && String(chatId) === String(this.failFor)) {
      throw new Error('network down');
    }
    this.sent.push({ chatId, text, options });
    return { message_id: this.sent.length };
  }
  async sendPhoto(chatId, file, options = {}) {
    this.photos.push({ chatId, file, options });
    return { photo: [{ file_id: `cached-photo-${this.photos.length}` }] };
  }
  async sendMediaGroup(chatId, items, options = {}) {
    this.albums.push({ chatId, items, options });
    return items.map((item, index) => ({ photo: [{ file_id: item.fileId || `cached-${index}` }] }));
  }
  async sendVideo() {
    return {};
  }
  async answerCallbackQuery(id, options = {}) {
    this.answers.push({ id, options });
    return true;
  }
}

const telegramPath = require.resolve('../telegram');
require.cache[telegramPath] = {
  id: telegramPath,
  filename: telegramPath,
  loaded: true,
  exports: {
    TelegramClient: class extends FakeClient {
      constructor(token) {
        super(token);
      }
    },
  },
};

const Store = require('../store');
const { startBot } = require('../bot');

let failures = 0;
function check(label, condition, extra = '') {
  if (condition) {
    console.log(`✓ ${label}`);
  } else {
    failures++;
    console.error(`✗ ${label} ${extra}`);
  }
}

(async () => {
  const file = path.join(os.tmpdir(), `shop-bot-test-${Date.now()}.json`);
  const store = new Store(file);
  store.saveSettings({
    shopName: 'فروشگاه تست',
    shippingPrice: 25000,
    telegram: { token: 'x', shopChatId: '999', supportUsername: 'MeadowSupport' },
    bale: {},
  });
  const product = store.saveProduct({
    name: 'رومیزی تست',
    price: 100000,
    stock: 3,
    attributes: [
      { name: 'شکل', options: ['دایره‌ای', 'مستطیلی'] },
      { name: 'ظرفیت', options: ['۴ نفره', '۶ نفره'] },
    ],
    variants: { '1-1': { price: 250000, stock: 5, dims: '۲۰۰×۱۵۰' } },
  });

  let stockChanged = 0;
  const bot = await startBot({
    token: 'x',
    messenger: 'telegram',
    store,
    imagesDir: os.tmpdir(),
    videosDir: os.tmpdir(),
    getConfig: () => {
      const s = store.getSettings();
      return {
        shopName: s.shopName,
        shippingPrice: s.shippingPrice,
        shopChatId: s.telegram.shopChatId,
        supportUsername: s.telegram.supportUsername,
      };
    },
    onStatus: () => {},
    onStockChanged: () => stockChanged++,
  });
  const fake = instances[instances.length - 1];

  const msg = (text, chatId = 42) => bot.handlers.message({ chat: { id: chatId }, text });
  const cb = (data, chatId = 42, from = { username: 'customer' }) =>
    bot.handlers.callback_query({ id: `cb${Math.random().toString(36).slice(2)}`, data, message: { chat: { id: chatId } }, from });

  await cb(`p:${product.id}`);
  await msg('/start');
  await msg('/start');
  const listViews = store.listViews().filter((view) => view.chatId === '42');
  check('list views deduplicated per day', listViews.length === 1, String(listViews.length));
  await cb(`pick:${product.id}`);
  await cb(`o:${product.id}:0:1`);
  await cb(`o:${product.id}:1:1`);

  const cartMsg = fake.sent[fake.sent.length - 1];
  check('cart shows options', cartMsg.text.includes('مستطیلی') && cartMsg.text.includes('۶ نفره'), cartMsg.text);
  check('cart price uses combination price', cartMsg.text.includes('۲۵۰'), cartMsg.text);
  check('cart shows variant dimensions', cartMsg.text.includes('۲۰۰×۱۵۰'), cartMsg.text);

  await cb('checkout');
  await msg('علی رضایی');
  await msg('09121234567');
  await msg('1234567890');
  await msg('تهران، خیابان ولیعصر، پلاک ۱');

  const order = store.data.orders[0];
  check('order saved', !!order);
  check('order has postal code', order?.customer.postalCode === '1234567890');
  check('order item has size options', order?.items[0].options.join('/') === 'مستطیلی/۶ نفره');
  check('order shipping applied', order?.shipping === 25000, String(order?.shipping));
  check('order total includes shipping', order?.total === 275000, String(order?.total));
  check('customer saved for next orders', store.getCustomer(42)?.name === 'علی رضایی');

  const shopOrderMsg = fake.sent.find((m) => String(m.chatId) === '999');
  check('order sent to shop', !!shopOrderMsg);
  check('shop message has postal code', shopOrderMsg?.text.includes('کد پستی'));
  check('shop message has quantity', shopOrderMsg?.text.includes('× 1'));
  check('shop message has shipping', shopOrderMsg?.text.includes('هزینه ارسال'));

  const doneData = shopOrderMsg?.options.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data;
  check('finalize button present', String(doneData).startsWith('done:'), String(doneData));

  const userConfirm = fake.sent.find(
    (m) => m.chatId === 42 && m.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.url
  );
  const supportUrl = userConfirm?.options.reply_markup.inline_keyboard[0][0].url || '';
  check('support button opens MeadowSupport chat', supportUrl.startsWith('https://t.me/MeadowSupport?text='), supportUrl);
  check('support message prefilled', decodeURIComponent(supportUrl).includes('نهایی کردن سفارش'), supportUrl);

  await cb(doneData, 999, { username: 'shop' });
  check('stock decremented', store.getProduct(product.id).stock === 2, String(store.getProduct(product.id).stock));
  check('variant stock decremented', store.getProduct(product.id).variants['1-1'].stock === 4, String(store.getProduct(product.id).variants['1-1'].stock));
  check('order marked done', store.getOrder(order.id)?.status === 'done');
  check('app notified of stock change', stockChanged === 1, String(stockChanged));

  // سفارش دوم: اطلاعات مشتری باید از قبل نمایش داده شود
  await cb(`pick:${product.id}`);
  await cb(`o:${product.id}:0:0`);
  await cb(`o:${product.id}:1:0`);
  await cb('checkout');
  const summary = fake.sent[fake.sent.length - 1];
  check('saved customer shown', summary.text.includes('اطلاعات شما') && summary.text.includes('علی رضایی'));

  // بُعد با موجودی محدود
  const sizeProduct = store.saveProduct({
    name: 'رومیزی ساده',
    price: 500000,
    stock: 5,
    sizes: [{ label: '۱۲۰×۱۸۰', capacity: '۴ نفره', shape: 'دایره', color: 'کرم', price: null, stock: 1 }],
  });

  await cb(`p:${sizeProduct.id}`);
  const sizeCaption = fake.sent[fake.sent.length - 1]?.text || '';
  check('caption lists prices', sizeCaption.includes('قیمت‌ها:'), sizeCaption);
  check('caption hides stock from customer', !sizeCaption.includes('موجودی:'), sizeCaption);

  await cb(`pick:${sizeProduct.id}`);
  const sizeChoices = fake.sent[fake.sent.length - 1];
  const sizeButton = sizeChoices?.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.text || '';
  check('size button hides stock', !sizeButton.includes('عدد'), sizeButton);
  check(
    'size button shows full label without truncation',
    sizeButton.includes('۴ نفره') && sizeButton.includes('دایره') && sizeButton.includes('کرم') && !sizeButton.includes('…'),
    sizeButton
  );

  const sizeKeyboard = sizeChoices?.options?.reply_markup?.inline_keyboard || [];
  const cancelButton = sizeKeyboard.flat().find((b) => String(b.callback_data) === 'pg:0');
  check(
    'size message lists full option details',
    sizeChoices.text.includes('۱۲۰×۱۸۰') && sizeChoices.text.includes('کرم'),
    sizeChoices.text
  );
  check('cancel button says cancel purchase', cancelButton?.text === '✕ انصراف از خرید محصول', cancelButton?.text);
  await cb(`s:${sizeProduct.id}:0`);
  await cb(`pick:${sizeProduct.id}`);
  await cb(`s:${sizeProduct.id}:0`);
  const blocked = fake.sent[fake.sent.length - 1];
  check('size stock limit enforced', blocked.text.includes('موجودی این بُعد تمام شده'), blocked.text);

  // آلبوم + کش file_id
  fs.writeFileSync(path.join(os.tmpdir(), 'img-1.jpg'), 'x');
  fs.writeFileSync(path.join(os.tmpdir(), 'img-2.jpg'), 'x');
  const gallery = store.saveProduct({
    name: 'گالری',
    price: 1000,
    stock: 1,
    images: ['img-1.jpg', 'img-2.jpg'],
  });

  await cb(`p:${gallery.id}`);
  const album = fake.albums[fake.albums.length - 1];
  check('photos sent as one album', !!album && album.items.length === 2, JSON.stringify(album?.items?.length));

  const keyboardMessage = [...fake.sent]
    .reverse()
    .find((m) => String(m.chatId) === '42' && m.options?.reply_markup?.inline_keyboard);
  const pickButton = (keyboardMessage?.options.reply_markup.inline_keyboard || [])
    .flat()
    .find((b) => String(b.callback_data).startsWith('pick:'));
  check('add-to-cart buttons sent after album', !!pickButton);
  check(
    'file ids cached after first send',
    store.getMediaId('telegram', 'img-1.jpg') === 'cached-0',
    store.getMediaId('telegram', 'img-1.jpg')
  );

  await cb(`p:${gallery.id}`);
  const cachedAlbum = fake.albums[fake.albums.length - 1];
  check(
    'second send reuses cached file ids',
    cachedAlbum.items.every((item) => String(item.fileId).startsWith('cached-')),
    JSON.stringify(cachedAlbum.items.map((item) => item.fileId))
  );
  check('album itself has no reply markup', !cachedAlbum.options.reply_markup);

  const directOrder = store.createOrder({    chatId: '7',
    customer: store.getCustomer(42),
    items: [
      {
        productId: sizeProduct.id,
        name: 'رومیزی ساده',
        size: '۱۲۰×۱۸۰',
        capacity: '۴ نفره',
        shape: 'دایره',
        color: 'کرم',
        qty: 1,
        unitPrice: 500000,
      },
    ],
  });
  store.markOrderDone(directOrder.id);
  check(
    'size stock decremented on finalize',
    store.getProduct(sizeProduct.id).sizes[0].stock === 0,
    String(store.getProduct(sizeProduct.id).sizes[0].stock)
  );

  // صف ارسال: خطای شبکه هنگام ارسال به فروشگاه
  fake.failFor = '999';
  await cb('confirmorder');
  check('failed message queued', store.listOutbox().length === 1, String(store.listOutbox().length));

  // تشخیص اسپم و بلاک
  for (let i = 0; i < 21; i += 1) {
    await cb(`pick:${product.id}`, 77, { username: 'spammer', first_name: 'اسپم' });
  }
  const report = store.listAbuseReports().find((item) => item.chatId === '77');
  check(
    'abuse detected with reason',
    !!report && (report.reason.includes('اقدام') || report.reason.includes('تکرار')),
    report?.reason
  );

  store.blockUser('77', report?.reason);
  const answersBefore = fake.answers.length;
  await cb(`pick:${product.id}`, 77, { username: 'spammer' });
  const blockAnswer = fake.answers
    .slice(answersBefore)
    .find((answer) => String(answer.options?.text || '').includes('مسدود'));
  check('blocked user is rejected', !!blockAnswer, JSON.stringify(fake.answers.slice(answersBefore)));

  await bot.stopPolling();
  fs.unlinkSync(file);
  console.log(failures ? `❌ ${failures} test(s) failed` : '✅ BOT TEST PASSED');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
