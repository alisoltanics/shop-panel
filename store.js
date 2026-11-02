'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * ذخیره‌سازی ساده روی فایل JSON (بدون وابستگی native).
 */
class Store {
  constructor(filePath) {
    this.file = filePath;
    this.data = { products: [], settings: {}, nextId: 1 };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        products: Array.isArray(raw.products) ? raw.products : [],
        settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
        nextId: Number(raw.nextId) || 1,
      };
    } catch {
      this.save();
    }
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
      size: String(input.size || '').trim(),
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
