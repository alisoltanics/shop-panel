'use strict';

/**
 * کلاینت سبک Telegram Bot API بدون هیچ وابستگی خارجی.
 * فقط getUpdates / sendMessage / sendPhoto / answerCallbackQuery را پوشش می‌دهد.
 */

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

class TelegramClient {
  constructor(token, options = {}) {
    this.token = String(token || '').trim();
    this.base = options.baseUrl || `https://api.telegram.org/bot${this.token}`;
    this.handlers = {};
    this.running = false;
    this.offset = 0;
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  removeAllListeners() {
    this.handlers = {};
  }

  async call(method, params = {}) {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      throw new Error(data.description || `خطای تلگرام (${res.status})`);
    }
    return data.result;
  }

  getMe() {
    return this.call('getMe');
  }

  sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, ...options });
  }

  answerCallbackQuery(id, options = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...options });
  }

  async sendFile(method, field, chatId, filePath, options = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (options.caption) form.append('caption', options.caption);
    if (options.parse_mode) form.append('parse_mode', options.parse_mode);
    if (options.reply_markup) form.append('reply_markup', JSON.stringify(options.reply_markup));

    const buffer = fs.readFileSync(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    form.append(field, new Blob([buffer], { type }), path.basename(filePath));

    const res = await fetch(`${this.base}/${method}`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `خطای ارسال فایل (${res.status})`);
    return data.result;
  }

  sendPhoto(chatId, filePath, options = {}) {
    return this.sendFile('sendPhoto', 'photo', chatId, filePath, options);
  }

  sendVideo(chatId, filePath, options = {}) {
    return this.sendFile('sendVideo', 'video', chatId, filePath, options);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  async loop() {
    while (this.running) {
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 30 });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          const payload = update.message || update.callback_query;
          const handler = update.message
            ? this.handlers.message
            : update.callback_query
              ? this.handlers.callback_query
              : null;
          if (!handler) continue;
          Promise.resolve()
            .then(() => handler(payload))
            .catch((err) => console.error('[telegram:handler]', err));
        }
      } catch (err) {
        if (!this.running) break;
        this.handlers.polling_error?.(err);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  stopPolling() {
    this.running = false;
    return Promise.resolve();
  }
}

module.exports = { TelegramClient };
