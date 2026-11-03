'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * ذخیره‌سازی ساده روی فایل JSON (بدون وابستگی native).
 */
class Store {
  constructor(filePath) {
    this.file = filePath;
    this.data = {
      products: [],
      settings: {},
      categories: [],
      options: { capacity: [], shape: [], color: [] },
      customers: {},
      orders: [],
      outbox: [],
      nextId: 1,
      nextOrderId: 0,
      nextOutboxId: 0,
    };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        products: Array.isArray(raw.products) ? raw.products : [],
        settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
        categories: Array.isArray(raw.categories) ? raw.categories : [],
        options: {
          capacity: Array.isArray(raw.options?.capacity) ? raw.options.capacity.map(String) : [],
          shape: Array.isArray(raw.options?.shape) ? raw.options.shape.map(String) : [],
          color: Array.isArray(raw.options?.color) ? raw.options.color.map(String) : [],
        },
        customers: raw.customers && typeof raw.customers === 'object' ? raw.customers : {},
        orders: Array.isArray(raw.orders) ? raw.orders : [],
        outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
        nextId: Number(raw.nextId) || 1,
        nextOrderId: Number(raw.nextOrderId) || 0,
        nextOutboxId: Number(raw.nextOutboxId) || 0,
      };
    } catch {
      this.save();
    }
    this.migrate();
  }

  /** داده‌های قدیمی را با ساختار جدید سازگار می‌کند. */
  migrate() {
    let changed = false;
    for (const p of this.data.products) {
      if (!Array.isArray(p.sizes)) {
        p.sizes = p.size ? [{ label: String(p.size), price: null }] : [];
        changed = true;
      }
      p.sizes = p.sizes
        .map((s) => ({
          label: String(s?.label ?? s ?? '').trim(),
          capacity: String(s?.capacity ?? '').trim(),
          shape: String(s?.shape ?? '').trim(),
          color: String(s?.color ?? '').trim(),
          price: Number(s?.price) > 0 ? Number(s.price) : null,
          stock:
            s?.stock === null || s?.stock === undefined || s?.stock === ''
              ? null
              : Math.max(0, Number(s.stock) || 0),
        }))
        .filter((s) => s.label);
      if (typeof p.video !== 'string') p.video = '';
      if (!Array.isArray(p.attributes)) {
        p.attributes = [];
        changed = true;
      }
      p.attributes = p.attributes
        .map((a) => ({
          name: String(a?.name ?? '').trim(),
          options: (Array.isArray(a?.options) ? a.options : []).map((o) => String(o ?? '').trim()).filter(Boolean),
        }))
        .filter((a) => a.name && a.options.length);
      if (!p.variantPrices || typeof p.variantPrices !== 'object') p.variantPrices = {};
      if (!p.variants || typeof p.variants !== 'object') {
        p.variants = {};
        for (const [key, price] of Object.entries(p.variantPrices)) {
          if (Number(price) > 0) p.variants[key] = { price: Number(price), stock: null, dims: '' };
        }
        changed = true;
      }
      for (const variant of Object.values(p.variants)) {
        if (!variant || typeof variant !== 'object') continue;
        variant.price = Number(variant.price) > 0 ? Number(variant.price) : null;
        variant.stock =
          variant.stock === null || variant.stock === undefined || variant.stock === ''
            ? null
            : Math.max(0, Number(variant.stock) || 0);
        variant.dims = String(variant.dims || '').trim();
      }
    }
    for (const p of this.data.products) {
      if (this.convertLegacyAttributes(p)) changed = true;
    }

    if (changed) this.save();
  }

  /** ترکیب‌های ویژگی‌های نسخه‌های قبلی را به ردیف‌های ابعاد تبدیل می‌کند. */
  convertLegacyAttributes(product) {
    const attrs = Array.isArray(product.attributes)
      ? product.attributes.filter((a) => a && a.name && Array.isArray(a.options) && a.options.length)
      : [];
    if (!attrs.length || (product.sizes && product.sizes.length)) return false;

    const combos = [{ key: '', labels: [] }];
    for (const attr of attrs) {
      const next = [];
      for (const combo of combos) {
        attr.options.forEach((option, index) => {
          next.push({
            key: combo.key ? `${combo.key}-${index}` : String(index),
            labels: [...combo.labels, String(option)],
            names: [...(combo.names || []), attr.name],
          });
        });
      }
      combos.length = 0;
      combos.push(...next);
    }

    const pick = (combo, pattern) => {
      const index = (combo.names || []).findIndex((name) => pattern.test(name));
      return index >= 0 ? combo.labels[index] : '';
    };

    product.sizes = combos.map((combo) => {
      const variant = (product.variants && product.variants[combo.key]) || {};
      return {
        label: variant.dims || combo.labels.join(' / '),
        capacity: pick(combo, /ظرفیت|تعداد|نفره|نفرات/),
        shape: pick(combo, /شکل/),
        price: Number(variant.price) > 0 ? Number(variant.price) : null,
        stock: variant.stock === undefined ? null : variant.stock,
      };
    });

    for (const size of product.sizes) {
      if (size.capacity && !this.data.options.capacity.includes(size.capacity)) {
        this.data.options.capacity.push(size.capacity);
      }
      if (size.shape && !this.data.options.shape.includes(size.shape)) {
        this.data.options.shape.push(size.shape);
      }
    }

    product.attributes = [];
    product.variants = {};
    product.variantPrices = {};
    return true;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  listProducts() {
    return [...this.data.products].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getProduct(id) {
    return this.data.products.find((p) => p.id === Number(id)) || null;
  }

  saveProduct(input = {}) {
    const now = Date.now();
    const clean = {
      name: String(input.name || '').trim(),
      category: String(input.category || '').trim(),
      price: Number(input.price) || 0,
      stock: Number(input.stock) || 0,
      material: String(input.material || '').trim(),
      sizes: (Array.isArray(input.sizes) ? input.sizes : [])
        .map((s) => ({
          label: String(s?.label ?? '').trim(),
          capacity: String(s?.capacity ?? '').trim(),
          shape: String(s?.shape ?? '').trim(),
          color: String(s?.color ?? '').trim(),
          price: Number(s?.price) > 0 ? Number(s.price) : null,
          stock:
            s?.stock === null || s?.stock === undefined || s?.stock === ''
              ? null
              : Math.max(0, Number(s.stock) || 0),
        }))
        .filter((s) => s.label),
      video: String(input.video || '').trim(),
      attributes: (Array.isArray(input.attributes) ? input.attributes : [])
        .map((a) => ({
          name: String(a?.name ?? '').trim(),
          options: (Array.isArray(a?.options) ? a.options : []).map((o) => String(o ?? '').trim()).filter(Boolean),
        }))
        .filter((a) => a.name && a.options.length),
      variantPrices: Object.fromEntries(
        Object.entries(input.variantPrices && typeof input.variantPrices === 'object' ? input.variantPrices : {})
          .map(([key, value]) => [String(key), Number(value)])
          .filter(([, value]) => value > 0)
      ),
      variants: Object.fromEntries(
        Object.entries(input.variants && typeof input.variants === 'object' ? input.variants : {})
          .map(([key, variant]) => {
            const stock =
              variant?.stock === null || variant?.stock === undefined || variant?.stock === ''
                ? null
                : Math.max(0, Number(variant.stock) || 0);
            return [
              String(key),
              {
                price: Number(variant?.price) > 0 ? Number(variant.price) : null,
                stock,
                dims: String(variant?.dims || '').trim(),
              },
            ];
          })
          .filter(([, variant]) => variant.price !== null || variant.stock !== null || variant.dims)
      ),
      colors: Array.isArray(input.colors)
        ? input.colors.map((c) => String(c).trim()).filter(Boolean)
        : String(input.colors || '')
            .split(/[,،]/)
            .map((c) => c.trim())
            .filter(Boolean),
      description: String(input.description || '').trim(),
      images: Array.isArray(input.images) ? input.images.filter(Boolean) : [],
      active: input.active !== false,
      updatedAt: now,
    };

    if (!clean.name) throw new Error('نام محصول الزامی است');

    // گزینه‌های جدید واردشده در فرم را به لیست‌های دائمی اضافه کن
    for (const size of clean.sizes) {
      if (size.capacity && !this.data.options.capacity.includes(size.capacity)) {
        this.data.options.capacity.push(size.capacity);
      }
      if (size.shape && !this.data.options.shape.includes(size.shape)) {
        this.data.options.shape.push(size.shape);
      }
      if (size.color && !this.data.options.color.includes(size.color)) {
        this.data.options.color.push(size.color);
      }
    }

    // اگر برای ابعاد موجودی ثبت شده باشد، موجودی کل = جمع موجودی ابعاد
    const sizedStock = clean.sizes.filter((s) => s.stock !== null && s.stock !== undefined);
    if (sizedStock.length) {
      clean.stock = sizedStock.reduce((sum, s) => sum + Number(s.stock || 0), 0);
    }

    if (input.id) {
      const idx = this.data.products.findIndex((p) => p.id === Number(input.id));
      if (idx === -1) throw new Error('محصول پیدا نشد');
      this.data.products[idx] = { ...this.data.products[idx], ...clean };
      this.save();
      return this.data.products[idx];
    }

    const product = { id: this.data.nextId++, ...clean, createdAt: now };
    this.data.products.push(product);
    this.save();
    return product;
  }

  deleteProduct(id) {
    const before = this.data.products.length;
    this.data.products = this.data.products.filter((p) => p.id !== Number(id));
    this.save();
    return before !== this.data.products.length;
  }

  /* ---------- دسته‌بندی‌ها ---------- */

  listCategories() {
    return [...this.data.categories];
  }

  addCategory(name) {
    const value = String(name || '').trim();
    if (!value) throw new Error('نام دسته‌بندی الزامی است');
    if (!this.data.categories.includes(value)) {
      this.data.categories.push(value);
      this.save();
    }
    return this.listCategories();
  }

  removeCategory(name) {
    this.data.categories = this.data.categories.filter((c) => c !== String(name));
    this.save();
    return this.listCategories();
  }

  /* ---------- گزینه‌های تعداد نفرات و شکل ---------- */

  listOptions(kind) {
    return [...(this.data.options[kind] || [])];
  }

  addOption(kind, value) {
    const list = this.data.options[kind] || (this.data.options[kind] = []);
    const v = String(value || '').trim();
    if (v && !list.includes(v)) {
      list.push(v);
      this.save();
    }
    return [...list];
  }

  removeOption(kind, value) {
    this.data.options[kind] = (this.data.options[kind] || []).filter((o) => o !== String(value));
    this.save();
    return [...this.data.options[kind]];
  }

  renameOption(kind, from, to) {
    const list = this.data.options[kind] || (this.data.options[kind] = []);
    const value = String(to || '').trim();
    const index = list.indexOf(String(from));
    if (value && index !== -1) {
      list[index] = value;
      for (const product of this.data.products) {
        for (const size of product.sizes || []) {
          if (kind === 'capacity' && size.capacity === from) size.capacity = value;
          if (kind === 'shape' && size.shape === from) size.shape = value;
        }
      }
      this.save();
    }
    return [...list];
  }

  /* ---------- مشتری‌ها ---------- */

  getCustomer(chatId) {
    return this.data.customers[String(chatId)] || null;
  }

  saveCustomer(chatId, customer = {}) {
    const previous = this.getCustomer(chatId) || {};
    this.data.customers[String(chatId)] = {
      name: String(customer.name ?? previous.name ?? '').trim(),
      phone: String(customer.phone ?? previous.phone ?? '').trim(),
      postalCode: String(customer.postalCode ?? previous.postalCode ?? '').trim(),
      address: String(customer.address ?? previous.address ?? '').trim(),
      updatedAt: Date.now(),
    };
    this.save();
    return this.getCustomer(chatId);
  }

  /* ---------- سفارش‌ها ---------- */

  createOrder({ chatId, customer, items, shipping = 0 }) {
    const itemsTotal = items.reduce((sum, i) => sum + Number(i.unitPrice || 0) * Number(i.qty || 0), 0);
    const shippingFee = Math.max(0, Number(shipping) || 0);
    const order = {
      id: ++this.data.nextOrderId,
      code: String(Date.now()).slice(-6),
      chatId: String(chatId),
      customer,
      items,
      itemsTotal,
      shipping: shippingFee,
      total: itemsTotal + shippingFee,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.data.orders.push(order);
    this.save();
    return order;
  }

  getOrder(id) {
    return this.data.orders.find((o) => o.id === Number(id)) || null;
  }

  /** لغو سفارش در انتظار (موجودی تغییر نمی‌کند) */
  cancelOrder(id) {
    const order = this.getOrder(id);
    if (!order || order.status === 'done' || order.status === 'canceled') return null;
    order.status = 'canceled';
    order.canceledAt = Date.now();
    this.save();
    return order;
  }

  listOrders() {
    return [...this.data.orders].sort((a, b) => b.id - a.id);
  }

  /** سفارش را نهایی می‌کند و موجودی محصولات را کاهش می‌دهد. */
  markOrderDone(id) {
    const order = this.getOrder(id);
    if (!order || order.status === 'done') return null;

    for (const item of order.items) {
      const product = this.data.products.find((p) => p.id === Number(item.productId));
      if (!product) continue;

      const size = (product.sizes || []).find(
        (s) =>
          s.label === item.size &&
          (s.capacity || '') === (item.capacity || '') &&
          (s.shape || '') === (item.shape || '') &&
          (s.color || '') === (item.color || '')
      );
      if (size && size.stock !== null && size.stock !== undefined) {
        size.stock = Math.max(0, Number(size.stock) - Number(item.qty || 0));
      }

      const variant = item.variantKey ? product.variants?.[item.variantKey] : null;
      if (variant && variant.stock !== null && variant.stock !== undefined) {
        variant.stock = Math.max(0, Number(variant.stock) - Number(item.qty || 0));
      }

      product.stock = Math.max(0, Number(product.stock || 0) - Number(item.qty || 0));
      product.updatedAt = Date.now();
    }

    order.status = 'done';
    order.doneAt = Date.now();
    this.save();
    return order;
  }

  /* ---------- صف ارسال ---------- */

  enqueueOutbox(item) {
    const entry = {
      id: ++this.data.nextOutboxId,
      createdAt: Date.now(),
      messenger: String(item.messenger || ''),
      chatId: String(item.chatId || ''),
      text: String(item.text || ''),
      markup: item.markup || null,
    };
    this.data.outbox.push(entry);
    this.save();
    return entry;
  }

  listOutbox(messenger) {
    if (!messenger) return [...this.data.outbox];
    return this.data.outbox.filter((item) => !item.messenger || item.messenger === messenger);
  }

  removeOutbox(id) {
    this.data.outbox = this.data.outbox.filter((item) => item.id !== Number(id));
    this.save();
  }

  getSettings() {
    const s = this.data.settings || {};
    const legacy = {
      token: String(s.botToken || '').trim(),
      shopChatId: String(s.shopChatId || '').trim(),
      supportUsername: String(s.supportUsername || 'MeadowSupport').replace(/^@/, '').trim(),
    };

    const telegram = s.telegram && typeof s.telegram === 'object' ? s.telegram : s.messenger === 'bale' ? {} : legacy;
    const bale = s.bale && typeof s.bale === 'object' ? s.bale : s.messenger === 'bale' ? legacy : {};

    return {
      shopName: String(s.shopName || '').trim(),
      note: String(s.note || ''),
      shippingPrice: Math.max(0, Number(s.shippingPrice) || 0),
      telegram: {
        token: String(telegram?.token || '').trim(),
        shopChatId: String(telegram?.shopChatId || '').trim(),
        supportUsername: String(telegram?.supportUsername || 'MeadowSupport').replace(/^@/, '').trim(),
      },
      bale: {
        token: String(bale?.token || '').trim(),
        shopChatId: String(bale?.shopChatId || '').trim(),
        supportUsername: String(bale?.supportUsername || '').replace(/^@/, '').trim(),
      },
    };
  }

  saveSettings(input = {}) {
    const normalize = (value, fallbackSupport) => ({
      token: String(value?.token || '').trim(),
      shopChatId: String(value?.shopChatId || '').trim(),
      supportUsername: String(value?.supportUsername ?? fallbackSupport).replace(/^@/, '').trim(),
    });

    this.data.settings = {
      ...this.data.settings,
      shopName: String(input.shopName || '').trim(),
      note: String(input.note || ''),
      shippingPrice: Math.max(0, Number(input.shippingPrice) || 0),
      telegram: normalize(input.telegram, 'MeadowSupport'),
      bale: normalize(input.bale, ''),
    };
    this.save();
    return this.getSettings();
  }
}

module.exports = Store;
