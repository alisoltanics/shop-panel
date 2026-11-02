#!/usr/bin/env bash
# حذف اپ از منوی برنامه‌های اوبونتو
set -euo pipefail

rm -f "$HOME/.local/share/applications/shop-panel.desktop"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/shop-panel.png"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

echo "🗑 حذف شد."
