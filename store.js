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
          price: Number(s?.price) > 0 ? Number(s.price) : null,
        }))
        .filter((s) => s.label);
      if (typeof p.video !== 'string') p.video = '';
    }
    if (changed) this.save();
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
          price: Number(s?.price) > 0 ? Number(s.price) : null,
        }))
        .filter((s) => s.label),
      video: String(input.video || '').trim(),
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

  createOrder({ chatId, customer, items }) {
    const total = items.reduce((sum, i) => sum + Number(i.unitPrice || 0) * Number(i.qty || 0), 0);
    const order = {
      id: ++this.data.nextOrderId,
      code: String(Date.now()).slice(-6),
      chatId: String(chatId),
      customer,
      items,
      total,
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

  /** سفارش را نهایی می‌کند و موجودی محصولات را کاهش می‌دهد. */
  markOrderDone(id) {
    const order = this.getOrder(id);
    if (!order || order.status === 'done') return null;

    for (const item of order.items) {
      const product = this.data.products.find((p) => p.id === Number(item.productId));
      if (product) {
        product.stock = Math.max(0, Number(product.stock || 0) - Number(item.qty || 0));
        product.updatedAt = Date.now();
      }
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
      chatId: String(item.chatId || ''),
      text: String(item.text || ''),
      markup: item.markup || null,
    };
    this.data.outbox.push(entry);
    this.save();
    return entry;
  }

  listOutbox() {
    return [...this.data.outbox];
  }

  removeOutbox(id) {
    this.data.outbox = this.data.outbox.filter((item) => item.id !== Number(id));
    this.save();
  }

  getSettings() {
    return { shopName: '', botToken: '', shopChatId: '', note: '', ...this.data.settings };
  }

  saveSettings(input = {}) {
    this.data.settings = {
      ...this.data.settings,
      shopName: String(input.shopName || '').trim(),
      botToken: String(input.botToken || '').trim(),
      shopChatId: String(input.shopChatId || '').trim(),
      note: String(input.note || '').trim(),
    };
    this.save();
    return this.getSettings();
  }
}

module.exports = Store;
