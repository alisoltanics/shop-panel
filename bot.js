'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TelegramClient } = require('./telegram');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;

const MENU = {
  keyboard: [[{ text: '🛍 محصولات' }, { text: '🧺 سبد خرید' }], [{ text: '📖 راهنما' }]],
  resize_keyboard: true,
  is_persistent: true,
};

const STEP_LABELS = {
  name: 'نام و نام خانوادگی',
  phone: 'شماره تماس',
  postalCode: 'کد پستی (۱۰ رقم)',
  address: 'آدرس کامل (شهر، خیابان، پلاک)',
};

const OUTBOX_MAX_AGE = 2 * 60 * 60 * 1000; // ۲ ساعت

function sizesOf(product) {
  return Array.isArray(product.sizes) ? product.sizes.filter((s) => s && s.label) : [];
}

function priceOf(product, sizeLabel) {
  const size = sizesOf(product).find((s) => s.label === sizeLabel);
  if (size && Number(size.price) > 0) return Number(size.price);
  return Number(product.price) || 0;
}

function productCaption(product) {
  const sizes = sizesOf(product);
  const lines = [`<b>${esc(product.name)}</b>`];
  if (product.category) lines.push(`📦 دسته: ${esc(product.category)}`);
  if (product.material) lines.push(`🧵 جنس: ${esc(product.material)}`);
  if (product.colors?.length) lines.push(`🎨 رنگ‌ها: ${esc(product.colors.join('، '))}`);
  if (sizes.length) lines.push(`📏 ابعاد: ${esc(sizes.map((s) => s.label).join(' | '))}`);
  lines.push(`📦 موجودی: ${Number(product.stock) || 0}`);
  if (product.description) lines.push('', esc(product.description));

  const prices = [Number(product.price) || 0, ...sizes.map((s) => Number(s.price) || 0)].filter((p) => p > 0);
  const perSize = sizes.some((s) => Number(s.price) > 0);
  lines.push('', `💰 <b>${money(prices.length ? Math.min(...prices) : 0)}</b>${perSize ? ' (بسته به بُعد)' : ''}`);
  return lines.join('\n');
}

async function startBot({ token, store, imagesDir, videosDir, getShopChatId, onStatus, onStockChanged }) {
  const bot = new TelegramClient(token);

  let me;
  try {
    me = await bot.getMe();
  } catch (err) {
    throw new Error(`توکن ربات معتبر نیست (${err.message})`);
  }

  const carts = new Map(); // chatId -> Map(key -> { id, size, qty })
  const sessions = new Map(); // chatId -> { step, data }

  const shopName = () => store.getSettings().shopName || 'فروشگاه';
  const shopChatId = () => String(getShopChatId() || '').trim();

  const shopTarget = () => {
    const value = shopChatId();
    if (!value) return null;
    return /^-?\d+$/.test(value) ? Number(value) : value;
  };

  const cartOf = (chatId) => {
    if (!carts.has(chatId)) carts.set(chatId, new Map());
    return carts.get(chatId);
  };

  const cartItems = (chatId) => {
    const cart = cartOf(chatId);
    const items = [];
    for (const [key, item] of [...cart.entries()]) {
      const product = store.getProduct(item.id);
      if (!product) {
        cart.delete(key);
        continue;
      }
      items.push({ key, product, size: item.size || '', qty: item.qty, unitPrice: priceOf(product, item.size) });
    }
    return items;
  };

  /* ------------------------- نمای محصولات ------------------------- */

  function productsView(page = 0, filter = '') {
    const all = store.listProducts().filter((p) => p.active !== false);
    if (!all.length) return { text: '🛒 هنوز محصولی برای نمایش ثبت نشده است.', opts: { reply_markup: MENU } };

    const q = String(filter || '').trim().toLowerCase();
    const list = q
      ? all.filter((p) => [p.name, p.category, p.description, p.material].join(' ').toLowerCase().includes(q))
      : all;

    if (!list.length) {
      return {
        text: `🔎 چیزی برای «${esc(filter)}» پیدا نشد.`,
        opts: {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🔙 همه محصولات', callback_data: 'pg:0' }]] },
        },
      };
    }

    const perPage = 6;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
    const rows = list
      .slice(current * perPage, current * perPage + perPage)
      .map((p) => {
        const prices = [Number(p.price) || 0, ...sizesOf(p).map((s) => Number(s.price) || 0)].filter((v) => v > 0);
        const cheapest = prices.length ? Math.min(...prices) : 0;
        return [{ text: `${p.name} | ${money(cheapest)}`, callback_data: `p:${p.id}` }];
      });

    if (pages > 1) {
      const nav = [];
      if (current > 0) nav.push({ text: '◀️', callback_data: `pg:${current - 1}` });
      nav.push({ text: `${current + 1} / ${pages}`, callback_data: 'noop' });
      if (current < pages - 1) nav.push({ text: '▶️', callback_data: `pg:${current + 1}` });
      rows.push(nav);
    }
    rows.push([{ text: '🔎 جستجو', callback_data: 'search' }, { text: '🧺 سبد خرید', callback_data: 'cart' }]);

    return {
      text: `🛍 <b>${esc(shopName())}</b>\n\nلطفاً محصول مورد نظر را انتخاب کنید:`,
      opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    };
  }

  async function sendProduct(chatId, id) {
    const product = store.getProduct(id);
    if (!product) return bot.sendMessage(chatId, 'محصول پیدا نشد.');

    const sizes = sizesOf(product);
    const rows = sizes.length
      ? sizes.map((size, index) => [
          {
            text: `➕ ${size.label} — ${money(Number(size.price) > 0 ? size.price : product.price)}`,
            callback_data: `add:${product.id}:${index}`,
          },
        ])
      : [[{ text: '➕ افزودن به سبد', callback_data: `add:${product.id}:` }]];
    rows.push([{ text: '🧺 سبد خرید', callback_data: 'cart' }, { text: '🔙 محصولات', callback_data: 'pg:0' }]);
    const keyboard = { inline_keyboard: rows };

    if (product.video) {
      const videoFile = path.join(videosDir, product.video);
      if (fs.existsSync(videoFile)) {
        try {
          await bot.sendVideo(chatId, videoFile);
        } catch {}
      }
    }

    const photo = product.images?.[0] ? path.join(imagesDir, product.images[0]) : null;
    if (photo && fs.existsSync(photo)) {
      try {
        return await bot.sendPhoto(chatId, photo, {
          caption: productCaption(product),
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch {}
    }
    return bot.sendMessage(chatId, productCaption(product), { parse_mode: 'HTML', reply_markup: keyboard });
  }

  /* ------------------------- سبد خرید ------------------------- */

  function cartView(chatId) {
    const items = cartItems(chatId);
    if (!items.length) {
      return {
        text: '🧺 سبد خرید شما خالی است.',
        opts: { reply_markup: { inline_keyboard: [[{ text: '🔙 مشاهده محصولات', callback_data: 'pg:0' }]] } },
      };
    }

    const total = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
    const lines = items.map(
      (i, n) =>
        `${n + 1}) ${esc(i.product.name)}${i.size ? ` — ${esc(i.size)}` : ''} × ${i.qty} = ${money(i.unitPrice * i.qty)}`
    );
    const rows = items.map((i, n) => [
      { text: `❌ حذف ${i.product.name}${i.size ? ` (${i.size})` : ''}`, callback_data: `rm:${n}` },
    ]);
    rows.push([{ text: '➕ ادامه خرید', callback_data: 'pg:0' }, { text: '✅ ثبت سفارش', callback_data: 'checkout' }]);

    return {
      text: `🧺 <b>سبد خرید شما</b>\n\n${lines.join('\n')}\n\n💰 جمع کل: <b>${money(total)}</b>`,
      opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    };
  }

  /* ------------------------- سفارش ------------------------- */

  function orderText(order) {
    const c = order.customer;
    return [
      `🧾 <b>سفارش جدید #${order.code}</b>`,
      '',
      `👤 نام: ${esc(c.name)}`,
      `📞 تلفن: ${esc(c.phone)}`,
      `📮 کد پستی: ${esc(c.postalCode)}`,
      `📍 آدرس: ${esc(c.address)}`,
      '',
      '<b>اقلام سفارش:</b>',
      ...order.items.map(
        (i, n) =>
          `${n + 1}) ${esc(i.name)}${i.size ? ` — بُعد: ${esc(i.size)}` : ''} × ${i.qty} = ${money(i.unitPrice * i.qty)}`
      ),
      '',
      `💰 جمع کل: <b>${money(order.total)}</b>`,
      '',
      `🆔 چت مشتری: <code>${order.chatId}</code>`,
    ].join('\n');
  }

  function doneMarkup(order) {
    return { inline_keyboard: [[{ text: '✅ نهایی کردن سفارش', callback_data: `done:${order.id}` }]] };
  }

  async function sendToShop(text, markup) {
    const target = shopTarget();
    if (!target) return false;
    try {
      await bot.sendMessage(target, text, { parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) });
      return true;
    } catch {
      // آفلاین یا خطای شبکه → صف ارسال
      store.enqueueOutbox({ chatId: String(target), text, markup: markup || null });
      return false;
    }
  }

  async function sendOrderToShop(order) {
    const sent = await sendToShop(orderText(order), doneMarkup(order));
    if (!sent) return false;

    for (const item of order.items) {
      const product = store.getProduct(item.productId);
      const image = product?.images?.[0];
      if (!image) continue;
      const file = path.join(imagesDir, image);
      if (!fs.existsSync(file)) continue;
      try {
        await bot.sendPhoto(shopTarget(), file, { caption: `${item.name}${item.size ? ` — ${item.size}` : ''} × ${item.qty}` });
      } catch {}
    }
    return true;
  }

  async function flushOutbox() {
    const now = Date.now();
    for (const item of store.listOutbox()) {
      if (now - item.createdAt > OUTBOX_MAX_AGE) {
        store.removeOutbox(item.id);
        continue;
      }
      try {
        const target = /^-?\d+$/.test(String(item.chatId)) ? Number(item.chatId) : item.chatId;
        await bot.sendMessage(target, item.text, {
          parse_mode: 'HTML',
          ...(item.markup ? { reply_markup: item.markup } : {}),
        });
        store.removeOutbox(item.id);
      } catch {
        /* در تلاش بعدی */
      }
    }
  }

  function customerSummary(chatId, customer) {
    const items = cartItems(chatId);
    const total = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
    const lines = items.map(
      (i, n) =>
        `${n + 1}) ${esc(i.product.name)}${i.size ? ` — ${esc(i.size)}` : ''} × ${i.qty} = ${money(i.unitPrice * i.qty)}`
    );
    return [
      '🧾 <b>بازبینی سفارش</b>',
      '',
      ...lines,
      `💰 جمع کل: <b>${money(total)}</b>`,
      '',
      '📋 <b>اطلاعات شما</b>',
      `👤 ${esc(customer.name)}`,
      `📞 ${esc(customer.phone)}`,
      `📮 کد پستی: ${esc(customer.postalCode)}`,
      `📍 ${esc(customer.address)}`,
      '',
      'اگر اطلاعات درست است تأیید کنید، در غیر این صورت ویرایش کنید.',
    ].join('\n');
  }

  function askStep(chatId, step, current = '') {
    const extra = current ? `\nمقدار فعلی: <b>${esc(current)}</b>` : '';
    return bot.sendMessage(chatId, `${STEP_LABELS[step]} را وارد کنید:${extra}`, { parse_mode: 'HTML' });
  }

  async function startCheckout(chatId) {
    if (!cartItems(chatId).length) return bot.sendMessage(chatId, 'سبد خرید خالی است.');

    const customer = store.getCustomer(chatId);
    if (customer && customer.name && customer.phone && customer.postalCode && customer.address) {
      return bot.sendMessage(chatId, customerSummary(chatId, customer), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ تأیید و ثبت سفارش', callback_data: 'confirmorder' }],
            [{ text: '✏️ ویرایش اطلاعات', callback_data: 'editinfo' }],
          ],
        },
      });
    }

    sessions.set(chatId, { step: 'name', data: {} });
    return askStep(chatId, 'name');
  }

  async function placeOrder(chatId, customer) {
    const items = cartItems(chatId);
    if (!items.length) return bot.sendMessage(chatId, 'سبد خرید خالی است.');

    const order = store.createOrder({
      chatId,
      customer,
      items: items.map((i) => ({
        productId: i.product.id,
        name: i.product.name,
        size: i.size || null,
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
    });
    store.saveCustomer(chatId, customer);
    carts.delete(chatId);
    sessions.delete(chatId);

    const sent = await sendOrderToShop(order);

    await bot.sendMessage(
      chatId,
      [
        `✅ سفارش شما با کد <b>#${order.code}</b> ثبت شد و برای فروشگاه ارسال شد.`,
        '',
        'برای نهایی کردن خرید، با دکمه زیر به فروشگاه پیام بدهید:',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📨 ارسال پیام به فروشگاه برای نهایی کردن سفارش', callback_data: `notify:${order.id}` }],
          ],
        },
      }
    );

    if (!sent) {
      await bot.sendMessage(chatId, '⚠️ ارسال به فروشگاه با تأخیر انجام می‌شود؛ سفارش شما در صف ارسال است.', {
        reply_markup: MENU,
      });
    }
  }

  /* ------------------------- پیام‌ها ------------------------- */

  bot.on('message', async (msg) => {
    try {
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();

      if (text === '/id') {
        return bot.sendMessage(chatId, `🆔 چت آیدی شما: <code>${chatId}</code>`, { parse_mode: 'HTML' });
      }

      if (text === '/start') {
        sessions.delete(chatId);
        await bot.sendMessage(chatId, `🛍 <b>${esc(shopName())}</b>\nاز منوی زیر انتخاب کنید:`, {
          parse_mode: 'HTML',
          reply_markup: MENU,
        });
        const v = productsView(0);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (text === '/products' || text === '🛍 محصولات') {
        sessions.delete(chatId);
        const v = productsView(0);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (text === '/cart' || text === '🧺 سبد خرید') {
        sessions.delete(chatId);
        const v = cartView(chatId);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (text === '/help' || text === '📖 راهنما' || text === '/راهنما') {
        return bot.sendMessage(
          chatId,
          [
            '📖 <b>راهنمای خرید</b>',
            '',
            '🛍 محصولات — نمایش لیست محصولات',
            '🧺 سبد خرید — مشاهده و حذف اقلام',
            '/start — منوی اصلی',
            '/id — نمایش چت آیدی شما',
            '',
            'برای خرید: محصول را انتخاب کنید، بُعد مورد نظر را بزنید تا به سبد اضافه شود، سپس «ثبت سفارش» را بزنید.',
          ].join('\n'),
          { parse_mode: 'HTML', reply_markup: MENU }
        );
      }

      const session = sessions.get(chatId);

      if (session?.step === 'search') {
        sessions.delete(chatId);
        const v = productsView(0, text);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (!session) {
        return bot.sendMessage(chatId, 'برای دیدن محصولات دستور /start را بفرستید.', { reply_markup: MENU });
      }

      if (session.step === 'name') {
        if (text.length < 2) return bot.sendMessage(chatId, 'لطفاً نام خود را وارد کنید.');
        session.data.name = text;
        session.step = 'phone';
        return askStep(chatId, 'phone');
      }

      if (session.step === 'phone') {
        if (!/^[\d+\-\s]{7,20}$/.test(text)) {
          return bot.sendMessage(chatId, 'شماره تماس معتبر نیست. مثال: 09121234567');
        }
        session.data.phone = text;
        session.step = 'postalCode';
        return askStep(chatId, 'postalCode');
      }

      if (session.step === 'postalCode') {
        if (!/^\d{10}$/.test(text)) return bot.sendMessage(chatId, 'کد پستی باید ۱۰ رقم باشد. مثال: 1234567890');
        session.data.postalCode = text;
        session.step = 'address';
        return askStep(chatId, 'address');
      }

      if (session.step === 'address') {
        if (text.length < 5) return bot.sendMessage(chatId, 'آدرس را کامل‌تر وارد کنید.');
        session.data.address = text;
        return placeOrder(chatId, session.data);
      }
    } catch (err) {
      console.error('[bot:message]', err);
    }
  });

  /* ------------------------- دکمه‌ها ------------------------- */

  bot.on('callback_query', async (q) => {
    const chatId = q.message?.chat?.id;
    const [action, arg1, arg2] = String(q.data || '').split(':');
    if (!chatId) return;

    try {
      if (action === 'noop') return bot.answerCallbackQuery(q.id);

      if (action === 'pg') {
        await bot.answerCallbackQuery(q.id);
        const v = productsView(Number(arg1) || 0);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'p') {
        await bot.answerCallbackQuery(q.id);
        return sendProduct(chatId, arg1);
      }

      if (action === 'add') {
        const product = store.getProduct(arg1);
        if (!product || product.active === false) {
          return bot.answerCallbackQuery(q.id, { text: 'این محصول موجود نیست', show_alert: true });
        }
        const sizes = sizesOf(product);
        const sizeIndex = arg2 === '' || arg2 === undefined ? -1 : Number(arg2);
        const size = sizes[sizeIndex]?.label || '';
        if (sizes.length && !size) {
          return bot.answerCallbackQuery(q.id, { text: 'ابتدا بُعد مورد نظر را انتخاب کنید', show_alert: true });
        }

        const cart = cartOf(chatId);
        const key = `${product.id}|${size}`;
        const entry = cart.get(key);
        cart.set(key, { id: product.id, size, qty: (entry?.qty || 0) + 1 });

        await bot.answerCallbackQuery(q.id, { text: 'به سبد اضافه شد ✅' });
        const v = cartView(chatId);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'rm') {
        const items = cartItems(chatId);
        const target = items[Number(arg1)];
        if (target) cartOf(chatId).delete(target.key);
        await bot.answerCallbackQuery(q.id, { text: 'حذف شد' });
        const v = cartView(chatId);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'cart') {
        await bot.answerCallbackQuery(q.id);
        const v = cartView(chatId);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'search') {
        await bot.answerCallbackQuery(q.id);
        sessions.set(chatId, { step: 'search', data: {} });
        return bot.sendMessage(chatId, '🔎 نام محصول یا دسته را بنویسید (مثلاً: رومیزی یا کاور مبل):');
      }

      if (action === 'checkout') {
        await bot.answerCallbackQuery(q.id);
        return startCheckout(chatId);
      }

      if (action === 'confirmorder') {
        await bot.answerCallbackQuery(q.id);
        const customer = store.getCustomer(chatId);
        if (!customer) return startCheckout(chatId);
        return placeOrder(chatId, customer);
      }

      if (action === 'editinfo') {
        await bot.answerCallbackQuery(q.id);
        const customer = store.getCustomer(chatId);
        sessions.set(chatId, { step: 'name', data: {} });
        return askStep(chatId, 'name', customer?.name || '');
      }

      if (action === 'notify') {
        const order = store.getOrder(arg1);
        if (!order) {
          return bot.answerCallbackQuery(q.id, { text: 'سفارش پیدا نشد', show_alert: true });
        }
        await bot.answerCallbackQuery(q.id, { text: 'پیام شما برای فروشگاه ارسال شد' });

        const ok = await sendToShop(
          [
            `🔔 <b>درخواست نهایی‌سازی سفارش #${order.code}</b>`,
            '',
            `👤 ${esc(order.customer.name)} — ${esc(order.customer.phone)}`,
            `📍 ${esc(order.customer.address)}`,
            '',
            `💰 جمع کل: ${money(order.total)}`,
          ].join('\n'),
          doneMarkup(order)
        );

        if (!ok) {
          return bot.sendMessage(chatId, '⚠️ ارسال پیام با تأخیر انجام می‌شود (در صف ارسال).');
        }
        return;
      }

      if (action === 'done') {
        const order = store.getOrder(arg1);
        if (!order) return bot.answerCallbackQuery(q.id, { text: 'سفارش پیدا نشد', show_alert: true });
        if (order.status === 'done') {
          return bot.answerCallbackQuery(q.id, { text: 'این سفارش قبلاً نهایی شده است', show_alert: true });
        }

        const shop = shopChatId();
        const isShop =
          !shop ||
          String(chatId) === shop ||
          (shop.startsWith('@') && q.from?.username && q.from.username.toLowerCase() === shop.slice(1).toLowerCase());
        if (!isShop) {
          return bot.answerCallbackQuery(q.id, { text: 'این دکمه مخصوص فروشگاه است', show_alert: true });
        }

        const done = store.markOrderDone(order.id);
        if (!done) return bot.answerCallbackQuery(q.id, { text: 'امکان نهایی‌سازی نبود', show_alert: true });

        onStockChanged?.();
        await bot.answerCallbackQuery(q.id, { text: 'سفارش نهایی شد ✅' });
        await bot.sendMessage(
          chatId,
          `✅ سفارش <b>#${done.code}</b> نهایی شد و موجودی ${done.items.length} قلم کالا کاهش یافت.`,
          { parse_mode: 'HTML' }
        );
        try {
          await bot.sendMessage(
            done.chatId,
            `✅ سفارش شما با کد <b>#${done.code}</b> توسط فروشگاه نهایی شد.\nممنون از خرید شما 🌸`,
            { parse_mode: 'HTML' }
          );
        } catch {}
        return;
      }
    } catch (err) {
      console.error('[bot:callback]', err);
      try {
        await bot.answerCallbackQuery(q.id);
      } catch {}
    }
  });

  bot.on('polling_error', (err) => {
    onStatus?.({ running: true, message: `خطای اتصال: ${String(err.message).slice(0, 80)}` });
  });

  // صف ارسال: هر دقیقه تلاش مجدد، پیام‌های قدیمی‌تر از ۲ ساعت حذف می‌شوند
  const outboxTimer = setInterval(() => {
    flushOutbox().catch(() => {});
  }, 60 * 1000);
  const originalStop = bot.stopPolling.bind(bot);
  bot.stopPolling = async () => {
    clearInterval(outboxTimer);
    await originalStop();
  };

  await flushOutbox();

  bot.start();
  await bot.call('setMyCommands', {
    commands: [
      { command: 'start', description: 'منوی اصلی' },
      { command: 'products', description: 'لیست محصولات' },
      { command: 'cart', description: 'سبد خرید' },
      { command: 'help', description: 'راهنما' },
    ],
  }).catch(() => {});

  onStatus?.({ running: true, message: `فعال — @${me.username}` });
  return bot;
}

module.exports = { startBot };
