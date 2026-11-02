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

function attributesOf(product) {
  return Array.isArray(product.attributes)
    ? product.attributes.filter((a) => a && a.name && Array.isArray(a.options) && a.options.length)
    : [];
}

/** اولویت قیمت: قیمت ترکیب گزینه‌ها ← قیمت بُعد ← قیمت پایه */
function priceFor(product, sizeLabel, indices = []) {
  const key = (indices || []).join('-');
  const variantPrice = Number(product.variants?.[key]?.price);
  if (variantPrice > 0) return variantPrice;
  const combo = Number(product.variantPrices?.[key]);
  if (combo > 0) return combo;
  return priceOf(product, sizeLabel);
}

function variantOf(product, indices = []) {
  const key = (indices || []).join('-');
  const variant = product.variants?.[key];
  if (variant && typeof variant === 'object') {
    return {
      key,
      price: Number(variant.price) > 0 ? Number(variant.price) : null,
      stock: variant.stock === null || variant.stock === undefined ? null : Number(variant.stock),
      dims: String(variant.dims || '').trim(),
    };
  }
  return { key, price: null, stock: null, dims: '' };
}

function productCaption(product) {
  const sizes = sizesOf(product);
  const lines = [`<b>${esc(product.name)}</b>`];
  if (product.category) lines.push(`📦 دسته: ${esc(product.category)}`);
  if (product.material) lines.push(`🧵 جنس: ${esc(product.material)}`);
  if (product.colors?.length) lines.push(`🎨 رنگ‌ها: ${esc(product.colors.join('، '))}`);
  if (sizes.length) lines.push(`📏 ابعاد: ${esc(sizes.map((s) => s.label).join(' | '))}`);
  attributesOf(product).forEach((attr) => lines.push(`⚙️ ${esc(attr.name)}: ${esc(attr.options.join(' | '))}`));
  lines.push(`📦 موجودی: ${Number(product.stock) || 0}`);
  if (product.description) lines.push('', esc(product.description));

  const prices = [
    Number(product.price) || 0,
    ...sizes.map((s) => Number(s.price) || 0),
    ...Object.values(product.variantPrices || {}).map((v) => Number(v) || 0),
  ].filter((p) => p > 0);
  const perSize = sizes.some((s) => Number(s.price) > 0);
  lines.push('', `💰 <b>${money(prices.length ? Math.min(...prices) : 0)}</b>${perSize ? ' (بسته به بُعد)' : ''}`);
  return lines.join('\n');
}

async function startBot({ token, messenger = 'telegram', store, imagesDir, videosDir, getShopChatId, onStatus, onStockChanged }) {
  const baseUrl = messenger === 'bale' ? `https://tapi.bale.ai/bot${String(token).trim()}` : undefined;
  const bot = new TelegramClient(token, { baseUrl });

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
  const shippingFee = () => Math.max(0, Number(store.getSettings().shippingPrice) || 0);

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
      items.push({
        key,
        product,
        size: item.size || '',
        options: item.options || [],
        indices: item.indices || [],
        variantKey: item.variantKey || '',
        dims: item.dims || '',
        qty: item.qty,
        unitPrice: priceFor(product, item.size, item.indices),
      });
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
        const prices = [
          Number(p.price) || 0,
          ...sizesOf(p).map((s) => Number(s.price) || 0),
          ...Object.values(p.variantPrices || {}).map((v) => Number(v) || 0),
        ].filter((v) => v > 0);
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

    const hasChoices = sizesOf(product).length > 0 || attributesOf(product).length > 0;
    const rows = [
      [
        {
          text: hasChoices ? '➕ انتخاب گزینه‌ها و افزودن' : '➕ افزودن به سبد',
          callback_data: `pick:${product.id}`,
        },
      ],
    ];
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
    const lines = items.map(cartLine);
    const rows = items.map((i, n) => [
      { text: `❌ حذف ${i.product.name}${i.size ? ` (${i.size})` : ''}`, callback_data: `rm:${n}` },
    ]);
    rows.push([{ text: '➕ ادامه خرید', callback_data: 'pg:0' }, { text: '✅ ثبت سفارش', callback_data: 'checkout' }]);

    const shipping = shippingFee();
    return {
      text: `🧺 <b>سبد خرید شما</b>\n\n${lines.join('\n')}\n\n🚚 ارسال: ${
        shipping > 0 ? money(shipping) : 'رایگان'
      }\n💰 قابل پرداخت: <b>${money(total + shipping)}</b>`,
      opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    };
  }

  /* ------------------------- انتخاب گزینه‌ها ------------------------- */

  const pickers = new Map(); // chatId -> { productId, sizeIndex, sizeLabel, attrIndex, indices, labels }

  function cartLine(item, index) {
    const parts = [item.product.name];
    if (item.size) parts.push(`بُعد: ${item.size}`);
    if (item.options?.length) parts.push(`گزینه‌ها: ${item.options.join(' / ')}`);
    if (item.dims) parts.push(`ابعاد: ${item.dims}`);
    return `${index + 1}) ${esc(parts.join(' — '))} × ${item.qty} = ${money(item.unitPrice * item.qty)}`;
  }

  async function addToCart(chatId, product, size, indices, labels) {
    const variant = variantOf(product, indices);
    const cart = cartOf(chatId);
    const key = `${product.id}|${size}|${(indices || []).join('-')}`;
    const entry = cart.get(key);

    if (variant.stock !== null && variant.stock <= (entry?.qty || 0)) {
      pickers.delete(chatId);
      return bot.sendMessage(chatId, '⚠️ موجودی این گزینه تمام شده است.');
    }

    cart.set(key, {
      id: product.id,
      size,
      indices: indices || [],
      options: labels || [],
      variantKey: variant.key,
      dims: variant.dims,
      qty: (entry?.qty || 0) + 1,
    });
    pickers.delete(chatId);
    const v = cartView(chatId);
    return bot.sendMessage(chatId, v.text, v.opts);
  }

  async function sendAttributeStep(chatId) {
    const picker = pickers.get(chatId);
    if (!picker) return bot.sendMessage(chatId, 'برای دیدن محصولات /start را بزنید.', { reply_markup: MENU });

    const product = store.getProduct(picker.productId);
    if (!product) {
      pickers.delete(chatId);
      return bot.sendMessage(chatId, 'محصول پیدا نشد.');
    }

    const attrs = attributesOf(product);
    if (picker.attrIndex >= attrs.length) {
      return addToCart(chatId, product, picker.sizeLabel, picker.indices, picker.labels);
    }

    const attr = attrs[picker.attrIndex];
    const rows = attr.options.map((option, index) => [
      { text: option, callback_data: `o:${product.id}:${picker.attrIndex}:${index}` },
    ]);
    rows.push([{ text: '✕ انصراف', callback_data: 'pg:0' }]);

    return bot.sendMessage(chatId, `⚙️ <b>${esc(attr.name)}</b> را انتخاب کنید:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
    });
  }

  async function startPick(chatId, productId, sizeIndex = null) {
    const product = store.getProduct(productId);
    if (!product || product.active === false) return bot.sendMessage(chatId, 'این محصول موجود نیست.');

    const sizes = sizesOf(product);
    const attrs = attributesOf(product);
    if (!sizes.length && !attrs.length) return addToCart(chatId, product, '', [], []);

    const picker = { productId: product.id, sizeIndex: -1, sizeLabel: '', attrIndex: 0, indices: [], labels: [] };
    pickers.set(chatId, picker);

    if (typeof sizeIndex === 'number' && sizeIndex >= 0 && sizes[sizeIndex]) {
      picker.sizeIndex = sizeIndex;
      picker.sizeLabel = sizes[sizeIndex].label;
      return sendAttributeStep(chatId);
    }

    if (sizes.length) {
      const rows = sizes.map((size, index) => [
        {
          text: `${size.label} — ${money(Number(size.price) > 0 ? size.price : product.price)}`,
          callback_data: `s:${product.id}:${index}`,
        },
      ]);
      rows.push([{ text: '✕ انصراف', callback_data: 'pg:0' }]);
      return bot.sendMessage(chatId, `📏 <b>${esc(product.name)}</b>\nبُعد را انتخاب کنید:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
    }

    return sendAttributeStep(chatId);
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
          `${n + 1}) ${esc(i.name)}${i.size ? ` — بُعد: ${esc(i.size)}` : ''}${
            i.options?.length ? ` — گزینه‌ها: ${esc(i.options.join(' / '))}` : ''
          }${i.dims ? ` — ابعاد: ${esc(i.dims)}` : ''} × ${i.qty} = ${money(i.unitPrice * i.qty)}`
      ),
      '',
      `� هزینه ارسال: ${Number(order.shipping) > 0 ? money(order.shipping) : 'رایگان'}`,
      `�💰 جمع کل: <b>${money(order.total)}</b>`,
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
        const extra = [item.size, ...(item.options || [])].filter(Boolean).join(' / ');
        await bot.sendPhoto(shopTarget(), file, { caption: `${item.name}${extra ? ` — ${extra}` : ''} × ${item.qty}` });
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
    const lines = items.map(cartLine);
    const shipping = shippingFee();
    return [
      '🧾 <b>بازبینی سفارش</b>',
      '',
      ...lines,
      `🚚 ارسال: ${shipping > 0 ? money(shipping) : 'رایگان'}`,
      `💰 مبلغ کل: <b>${money(total + shipping)}</b>`,
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
        options: i.options || [],
        variantKey: i.variantKey || '',
        dims: i.dims || '',
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
      shipping: shippingFee(),
    });
    store.saveCustomer(chatId, customer);
    carts.delete(chatId);
    sessions.delete(chatId);

    const sent = await sendOrderToShop(order);

    // دکمه لینک: چت پشتیبانی فروشگاه با پیام آماده باز می‌شود
    const support = String(store.getSettings().supportUsername || 'MeadowSupport').replace(/^@/, '').trim();
    const supportText = `سلام، برای نهایی کردن سفارش #${order.code} پیام می‌دهم.\nمبلغ کل: ${money(order.total)}`;
    const supportUrl =
      messenger === 'bale'
        ? `https://ble.ir/${support}`
        : `https://t.me/${support}?text=${encodeURIComponent(supportText)}`;

    await bot.sendMessage(
      chatId,
      [
        `✅ سفارش شما با کد <b>#${order.code}</b> ثبت شد و برای فروشگاه ارسال شد.`,
        '',
        'برای نهایی کردن خرید، با دکمه زیر به فروشگاه پیام بدهید (متن آماده است، فقط ارسال کنید):',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📨 ارسال پیام به فروشگاه برای نهایی کردن سفارش', url: supportUrl }],
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
            'برای خرید: محصول را انتخاب کنید، ابعاد و ویژگی‌های مورد نظر را بزنید تا به سبد اضافه شود، سپس «ثبت سفارش» را بزنید.',
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
    const [action, arg1, arg2, arg3] = String(q.data || '').split(':');
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

      if (action === 'pick' || action === 'add') {
        await bot.answerCallbackQuery(q.id);
        const sizeIndex = action === 'add' && arg2 !== '' && arg2 !== undefined ? Number(arg2) : null;
        return startPick(chatId, arg1, sizeIndex);
      }

      if (action === 's') {
        const picker = pickers.get(chatId);
        const product = store.getProduct(arg1);
        if (!picker || !product || picker.productId !== product.id) {
          await bot.answerCallbackQuery(q.id, { text: 'دوباره محصول را انتخاب کنید' });
          return startPick(chatId, arg1);
        }
        const sizes = sizesOf(product);
        const index = Number(arg2);
        if (!sizes[index]) return bot.answerCallbackQuery(q.id, { text: 'گزینه نامعتبر' });

        picker.sizeIndex = index;
        picker.sizeLabel = sizes[index].label;
        await bot.answerCallbackQuery(q.id, { text: sizes[index].label });
        return sendAttributeStep(chatId);
      }

      if (action === 'o') {
        const picker = pickers.get(chatId);
        const product = store.getProduct(arg1);
        if (!picker || !product || picker.productId !== product.id) {
          await bot.answerCallbackQuery(q.id, { text: 'دوباره محصول را انتخاب کنید' });
          return startPick(chatId, arg1);
        }

        const attrs = attributesOf(product);
        const attrIndex = Number(arg2);
        const optionIndex = Number(arg3);
        const attr = attrs[attrIndex];
        if (!attr || !attr.options[optionIndex]) {
          return bot.answerCallbackQuery(q.id, { text: 'گزینه نامعتبر' });
        }

        picker.indices[attrIndex] = optionIndex;
        picker.labels[attrIndex] = attr.options[optionIndex];
        picker.attrIndex = attrIndex + 1;
        await bot.answerCallbackQuery(q.id, { text: attr.options[optionIndex] });
        return sendAttributeStep(chatId);
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
