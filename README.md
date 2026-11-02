# Shop Panel — پنل فروشگاه + ربات تلگرام

اپ دسکتاپ Electron برای مدیریت محصولات فروشگاه (رومیزی، کاور مبل و …) و ربات تلگرام سفارش‌گیری.
داده‌ها در `userData` ذخیره می‌شوند (JSON + پوشه `images`) — بدون دیتابیس و بدون ماژول native.

## دانلود

ریپو خصوصی است، پس فایل‌ها را با GitHub CLI بگیرید:

```bash
gh release download v1.0.1 -R alisoltanics/shop-panel -D ~/Downloads
sudo dpkg -i ~/Downloads/ShopPanel-1.0.1-linux-amd64.deb   # نصب در منوی اوبونتو
```

از بخش [Releases](https://github.com/alisoltanics/shop-panel/releases):

- **Ubuntu / Debian**: `ShopPanel-1.0.1-linux-amd64.deb` → با دوبار کلیک نصب می‌شود و آیکونش در منوی برنامه‌ها می‌آید.
  یا `ShopPanel-1.0.1-x86_64.AppImage` (بدون نصب: `chmod +x` و اجرا).
- **Windows**: `ShopPanel-Setup-1.0.1.exe` (نسخه ۶۴ بیتی). نسخه ویندوز امضای دیجیتال ندارد؛ ممکن است SmartScreen هشدار بدهد (More info → Run anyway).

## اجرا از سورس

```bash
npm install
npm start
```

### آیکون در منوی اوبونتو (اجرای از سورس)

```bash
npm run install:desktop      # ساخت فایل .desktop و آیکون در ~/.local/share
npm run uninstall:desktop    # حذف از منو
```

سپس «Shop Panel» یا «پنل فروشگاه» را در جستجوی برنامه‌ها پیدا کنید.

## راه‌اندازی ربات (یک بار)

1. در تلگرام به `@BotFather` بروید، `/newbot` بزنید و **توکن** را کپی کنید.
2. از اکانت تلگرام فروشگاه، ربات را باز کنید و `/start` بدهید.
3. دستور `/id` را بفرستید؛ عددی که می‌دهد **چت آیدی فروشگاه** است.
4. در اپ، تب «تنظیمات و ربات»: توکن + چت آیدی را وارد و ذخیره کنید. ربات خودکار روشن می‌شود.

## قابلیت‌ها

- ثبت/ویرایش/حذف محصول با نام، دسته، قیمت، موجودی، جنس، ابعاد، رنگ‌ها، توضیحات و چند عکس
- فعال/غیرفعال کردن نمایش محصول در ربات + جستجو و فیلتر دسته
- ربات: لیست صفحه‌بندی‌شده، جستجوی متنی، کارت محصول با عکس و مشخصات، سبد خرید، حذف آیتم، گرفتن نام/تلفن/آدرس و **ارسال سفارش + عکس محصولات به چت فروشگاه**
- فرمان‌های ربات: `/start`، `/products`، `/help`، `/id`

## بیلد

```bash
npm run dist:linux   # .deb + .AppImage در پوشه release
npm run dist:win     # نصب‌کننده NSIS (ترجیحاً روی ویندوز یا CI)
```

## انتشار نسخه جدید

```bash
npm version patch        # یا minor / major — تگ v می‌سازد
git push --follow-tags
```

با پوش شدن تگ، GitHub Actions (`.github/workflows/release.yml`) روی `ubuntu-latest` و `windows-latest`
بیلد می‌گیرد و فایل‌های `.deb`، `.AppImage` و `Setup.exe` را به‌صورت Release منتشر می‌کند.

## ساختار

| فایل | توضیح |
| --- | --- |
| `main.js` | فرآیند اصلی Electron، IPC، پروتکل تصاویر، مدیریت ربات |
| `preload.js` | پل امن `window.api` |
| `store.js` | ذخیره‌سازی JSON محصولات و تنظیمات |
| `bot.js` | منطق ربات تلگرام |
| `renderer/` | رابط کاربری (HTML/CSS/JS) |
| `scripts/` | آیکون و نصب در منوی اوبونتو |
| `build/icon.png` | آیکون اپ (Linux/Windows) |

