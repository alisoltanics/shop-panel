#!/usr/bin/env bash
# نصب اپ در منوی برنامه‌های اوبونتو (اجرا از سورس، بدون بیلد)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
DESKTOP_DIR="$HOME/.local/share/applications"
ELECTRON="$APP_DIR/node_modules/.bin/electron"

if [ ! -x "$ELECTRON" ]; then
  echo "❌ electron نصب نیست. اول در $APP_DIR دستور «npm install» را اجرا کنید."
  exit 1
fi

mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
install -m 644 "$APP_DIR/build/icon.png" "$ICON_DIR/shop-panel.png"

# ماژول ورودی کیبورد فارسی (fcitx/ibus) را در صورت نصب بودن فعال کن
IM_ENV=""
if command -v fcitx5 >/dev/null 2>&1 || command -v fcitx >/dev/null 2>&1; then
  IM_ENV="env GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx"
elif command -v ibus >/dev/null 2>&1; then
  IM_ENV="env GTK_IM_MODULE=ibus XMODIFIERS=@im=ibus"
fi

cat > "$DESKTOP_DIR/shop-panel.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Shop Panel
Name[fa]=پنل فروشگاه
GenericName=Shop Product Manager
Comment=Manage shop products and Telegram orders
Comment[fa]=مدیریت محصولات و سفارش‌های تلگرام
Exec=$IM_ENV "$ELECTRON" "$APP_DIR" --no-sandbox %U
Icon=$ICON_DIR/shop-panel.png
Terminal=false
Categories=Office;Utility;
Keywords=shop;products;store;telegram;فروشگاه;محصولات;
StartupWMClass=ShopPanel
StartupNotify=true
EOF

chmod 755 "$DESKTOP_DIR/shop-panel.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true

echo "✅ نصب شد. «Shop Panel» را در جستجوی برنامه‌های اوبونتو پیدا کنید."
