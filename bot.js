'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TelegramClient } = require('./telegram');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const money = (n) => `${Number(n || 0).toLocaleString('fa-IR')} تومان`;

function productCaption(prod) {
  const lines = [`<b>${esc(prod.name)}</b>`];
  if (prod.category) lines.push(`📦 دسته: ${esc(prod.category)}`);
  if (prod.material) lines.push(`🧵 جنس: ${esc(prod.material)}`);
  if (prod.size) lines.push(`📏 ابعاد: ${esc(prod.size)}`);
  if (prod.colors?.length) lines.push(`🎨 رنگ‌ها: ${esc(prod.colors.join('، '))}`);
  if (prod.stock > 0) lines.push(`📦 موجودی: ${prod.stock}`);
  if (prod.description) lines.push('', esc(prod.description));
  lines.push('', `💰 <b>${money(prod.price)}</b>`);
  return lines.join('\n');
}

async function startBot({ token, store, imagesDir, getShopChatId, onStatus }) {
  const bot = new TelegramClient(token);

  let me;
  try {
    me = await bot.getMe();
  } catch (err) {
    try {
      await bot.stopPolling();
    } catch {}
    throw new Error(`توکن ربات معتبر نیست (${err.message})`);
  }

  const carts = new Map(); // chatId -> Map(productId -> qty)
  const sessions = new Map(); // chatId -> { step, name, phone }

  const shopName = () => store.getSettings().shopName || 'فروشگاه';
  const cartOf = (chatId) => {
    if (!carts.has(chatId)) carts.set(chatId, new Map());
    return carts.get(chatId);
  };
  const getProduct = (id) => store.getProduct(id);
  const activeProducts = () => store.listProducts().filter((p) => p.active !== false);

  function productsView(page = 0, filter = '') {
    const all = activeProducts();
    if (!all.length) {
      return { text: '🛒 هنوز محصولی برای نمایش ثبت نشده است.', opts: {} };
    }
    const q = String(filter || '').trim().toLowerCase();
    const list = q
      ? all.filter((p) =>
          [p.name, p.category, p.description, p.material, p.size].join(' ').toLowerCase().includes(q)
        )
      : all;
    if (!list.length) {
      return {
        text: `🔎 چیزی برای «${esc(filter)}» پیدا نشد.`,
        opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 همه محصولات', callback_data: 'pg:0' }]] } },
      };
    }
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
    const rows = list
      .slice(current * perPage, current * perPage + perPage)
      .map((p) => [{ text: `${p.name} | ${money(p.price)}`, callback_data: `p:${p.id}` }]);

    if (pages > 1) {
      const nav = [];
      if (current > 0) nav.push({ text: '◀️', callback_data: `pg:${current - 1}` });
      nav.push({ text: `${current + 1} / ${pages}`, callback_data: 'noop' });
      if (current < pages - 1) nav.push({ text: '▶️', callback_data: `pg:${current + 1}` });
      rows.push(nav);
    }
    rows.push([
      { text: '🔎 جستجو', callback_data: 'search' },
      { text: '🧺 سبد خرید', callback_data: 'cart' },
    ]);

    return {
      text: `🛍 <b>${esc(shopName())}</b>\n\nلطفاً محصول مورد نظر را انتخاب کنید:`,
      opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    };
  }

  function cartView(chatId) {
    const cart = cartOf(chatId);
    const items = [];
    for (const [id, qty] of [...cart.entries()]) {
      const prod = getProduct(id);
      if (!prod) {
        cart.delete(id);
        continue;
      }
      items.push({ prod, qty });
    }

    if (!items.length) {
      return {
        text: '🧺 سبد خرید شما خالی است.',
        opts: { reply_markup: { inline_keyboard: [[{ text: '🔙 مشاهده محصولات', callback_data: 'pg:0' }]] } },
      };
    }

    const total = items.reduce((s, i) => s + Number(i.prod.price || 0) * i.qty, 0);
    const lines = items.map(
      (i, n) => `${n + 1}) ${esc(i.prod.name)} × ${i.qty} = ${money(Number(i.prod.price || 0) * i.qty)}`
    );
    const rows = items.map((i) => [{ text: `❌ حذف ${i.prod.name}`, callback_data: `rm:${i.prod.id}` }]);
    rows.push([
      { text: '➕ ادامه خرید', callback_data: 'pg:0' },
      { text: '✅ ثبت سفارش', callback_data: 'checkout' },
    ]);

    return {
      text: `🧺 <b>سبد خرید شما</b>\n\n${lines.join('\n')}\n\n💰 جمع کل: <b>${money(total)}</b>`,
      opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    };
  }

  async function sendProduct(chatId, id) {
    const prod = getProduct(id);
    if (!prod) return bot.sendMessage(chatId, 'محصول پیدا نشد.');

    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ افزودن به سبد', callback_data: `add:${prod.id}` }],
        [
          { text: '🧺 سبد خرید', callback_data: 'cart' },
          { text: '🔙 محصولات', callback_data: 'pg:0' },
        ],
      ],
    };
    const caption = productCaption(prod);
    const file = prod.images?.[0] ? path.join(imagesDir, prod.images[0]) : null;

    if (file && fs.existsSync(file)) {
      try {
        return await bot.sendPhoto(chatId, file, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch {
        /* در صورت خطای عکس، متن فرستاده می‌شود */
      }
    }
    return bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  async function placeOrder(chatId, data) {
    const cart = cartOf(chatId);
    const items = [...cart.entries()]
      .map(([id, qty]) => ({ prod: getProduct(id), qty }))
      .filter((i) => i.prod);

    if (!items.length) return bot.sendMessage(chatId, 'سبد خرید خالی است.');

    const total = items.reduce((s, i) => s + Number(i.prod.price || 0) * i.qty, 0);
    const code = String(Date.now()).slice(-6);
    const lines = items.map(
      (i, n) => `${n + 1}) ${i.prod.name} × ${i.qty} = ${money(Number(i.prod.price || 0) * i.qty)}`
    );

    const orderText = [
      `🧾 <b>سفارش جدید #${code}</b>`,
      '',
      `👤 نام: ${esc(data.name)}`,
      `📞 تلفن: ${esc(data.phone)}`,
      `📍 آدرس: ${esc(data.address)}`,
      '',
      ...lines,
      '',
      `💰 جمع کل: <b>${money(total)}</b>`,
      '',
      `🆔 چت مشتری: <code>${chatId}</code>`,
    ].join('\n');

    const shopChatId = String(getShopChatId() || '').trim();
    if (!shopChatId) {
      return bot.sendMessage(
        chatId,
        '⚠️ سفارش ثبت شد اما «چت آیدی فروشگاه» در تنظیمات اپ وارد نشده است. لطفاً با پشتیبانی تماس بگیرید.'
      );
    }

    const target = /^-?\d+$/.test(shopChatId) ? Number(shopChatId) : shopChatId;
    try {
      await bot.sendMessage(target, orderText, { parse_mode: 'HTML' });
      // ارسال عکس محصولات سفارش داده شده برای فروشگاه
      for (const item of items) {
        const image = item.prod.images?.[0];
        if (!image) continue;
        const file = path.join(imagesDir, image);
        if (!fs.existsSync(file)) continue;
        try {
          await bot.sendPhoto(target, file, { caption: `${item.prod.name} × ${item.qty}` });
        } catch {}
      }
    } catch (err) {
      return bot.sendMessage(
        chatId,
        `⚠️ ارسال سفارش به فروشگاه ناموفق بود (${esc(err.message)}). لطفاً دوباره تلاش کنید.`
      );
    }

    cart.clear();
    await bot.sendMessage(
      chatId,
      `✅ سفارش شما با کد <b>#${code}</b> ثبت شد.\nهمکاران ما به‌زودی برای هماهنگی و نهایی‌سازی خرید با شما تماس می‌گیرند.`,
      { parse_mode: 'HTML' }
    );
  }

  bot.on('message', async (msg) => {
    try {
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();

      if (text === '/id') {
        return bot.sendMessage(chatId, `🆔 چت آیدی شما: <code>${chatId}</code>`, { parse_mode: 'HTML' });
      }
      if (text === '/start' || text === '/products' || text === '/shop') {
        sessions.delete(chatId);
        const v = productsView(0);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (text === '/help' || text === '/راهنما') {
        return bot.sendMessage(
          chatId,
          [
            '📖 <b>راهنمای خرید</b>',
            '',
            '/start — نمایش لیست محصولات',
            '/products — لیست محصولات',
            'برای خرید: یک محصول را انتخاب کنید، «افزودن به سبد» را بزنید و در پایان «ثبت سفارش» را بزنید.',
            'سپس نام، شماره تماس و آدرس خود را ارسال کنید تا سفارش برای فروشگاه ثبت شود.',
          ].join('\n'),
          { parse_mode: 'HTML' }
        );
      }

      const session = sessions.get(chatId);
      if (!session) {
        return bot.sendMessage(chatId, 'برای دیدن محصولات دستور /start را بفرستید.');
      }

      if (session.step === 'search') {
        sessions.delete(chatId);
        const v = productsView(0, text);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (session.step === 'name') {
        if (text.length < 2) return bot.sendMessage(chatId, 'لطفاً نام خود را وارد کنید.');
        session.name = text;
        session.step = 'phone';
        return bot.sendMessage(chatId, '📞 شماره تماس خود را وارد کنید:');
      }

      if (session.step === 'phone') {
        if (!/^[\d+\-\s]{7,20}$/.test(text)) {
          return bot.sendMessage(chatId, 'شماره تماس معتبر نیست. مثال: 09121234567');
        }
        session.phone = text;
        session.step = 'address';
        return bot.sendMessage(chatId, '📍 آدرس کامل (شهر، خیابان، پلاک، کد پستی) را وارد کنید:');
      }

      if (session.step === 'address') {
        if (text.length < 5) return bot.sendMessage(chatId, 'آدرس را کامل‌تر وارد کنید.');
        session.address = text;
        sessions.delete(chatId);
        return placeOrder(chatId, session);
      }
    } catch (err) {
      console.error('[bot:message]', err);
    }
  });

  bot.on('callback_query', async (q) => {
    const chatId = q.message?.chat?.id;
    const [action, arg] = String(q.data || '').split(':');
    if (!chatId) return;

    try {
      if (action === 'noop') return bot.answerCallbackQuery(q.id);

      if (action === 'pg') {
        await bot.answerCallbackQuery(q.id);
        const v = productsView(Number(arg) || 0);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'p') {
        await bot.answerCallbackQuery(q.id);
        return sendProduct(chatId, arg);
      }

      if (action === 'add') {
        const prod = getProduct(arg);
        if (!prod || prod.active === false) {
          return bot.answerCallbackQuery(q.id, { text: 'این محصول موجود نیست', show_alert: true });
        }
        const cart = cartOf(chatId);
        cart.set(prod.id, (cart.get(prod.id) || 0) + 1);
        await bot.answerCallbackQuery(q.id, { text: 'به سبد اضافه شد ✅' });
        const v = cartView(chatId);
        return bot.sendMessage(chatId, v.text, v.opts);
      }

      if (action === 'rm') {
        cartOf(chatId).delete(Number(arg));
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
        sessions.set(chatId, { step: 'search' });
        return bot.sendMessage(chatId, '🔎 نام محصول یا دسته را بنویسید (مثلاً: رومیزی یا کاور مبل):');
      }

      if (action === 'checkout') {
        await bot.answerCallbackQuery(q.id);
        if (!cartOf(chatId).size) return bot.sendMessage(chatId, 'سبد خرید خالی است.');
        sessions.set(chatId, { step: 'name' });
        return bot.sendMessage(chatId, '✍️ نام و نام خانوادگی خود را وارد کنید:');
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

  bot.start();
  onStatus?.({ running: true, message: `فعال — @${me.username}` });
  return bot;
}

module.exports = { startBot };
