#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="/Users/dongzi/Documents/Codex/.tools/node-v20.19.4-darwin-arm64"
DESKTOP_APP="$HOME/Desktop/藏经阁.app"
USER_APP="$HOME/Applications/藏经阁.app"
USB_EXPORT_DIR="${USB_EXPORT_DIR:-/Volumes/U盘/葬经阁111}"
APP_SRC=""
BUMP_VERSION=0

for arg in "$@"; do
  case "$arg" in
    --bump) BUMP_VERSION=1 ;;
  esac
done

export PATH="$NODE_DIR/bin:$PATH"
export HOME="${HOME:-/Users/dongzi}"
export npm_config_cache="/Users/dongzi/Documents/Codex/.npm-cache"
export ELECTRON_CACHE="/Users/dongzi/Documents/Codex/.electron-cache"
export npm_config_electron_cache="$ELECTRON_CACHE"
export ELECTRON_BUILDER_CACHE="/Users/dongzi/Documents/Codex/.electron-builder-cache"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

cd "$ROOT_DIR"

if [ "$BUMP_VERSION" = "1" ]; then
  node scripts/bump-version.js
fi

APP_VERSION="$(node -p "require('./package.json').version")"

npm run check
npx electron-builder --mac dir

if [ -d "release/mac-arm64/cangjingge.app" ]; then
  APP_SRC="release/mac-arm64/cangjingge.app"
elif [ -d "release/mac-arm64/藏经阁.app" ]; then
  APP_SRC="release/mac-arm64/藏经阁.app"
else
  echo "未找到打包产物 release/mac-arm64/*.app" >&2
  exit 1
fi

codesign --force --deep --sign - "$APP_SRC"

mkdir -p "$HOME/Applications"
install_app() {
  local src="$1"
  local dest="$2"
  local fallback="$3"

  if [ -d "$dest" ] && ! rm -rf "$dest" 2>/dev/null; then
    echo "覆盖失败，改用新文件名：$fallback"
    dest="$fallback"
    rm -rf "$dest" 2>/dev/null || true
  fi
  ditto "$src" "$dest"
  echo "$dest"
}

USER_INSTALLED="$(install_app "$APP_SRC" "$USER_APP" "$HOME/Applications/藏经阁-v$APP_VERSION.app")"

if [ -d "$HOME/Desktop" ]; then
  DESKTOP_INSTALLED="$(install_app "$APP_SRC" "$DESKTOP_APP" "$HOME/Desktop/藏经阁-v$APP_VERSION.app")"
fi

ZIP_ZH="release/藏经阁-v$APP_VERSION-Mac-arm64.zip"
ZIP_ASCII="release/Cangjingge-v$APP_VERSION-Mac-arm64.zip"
ZIP_LATEST="release/Cangjingge-latest-Mac-arm64.zip"
UPDATE_MANIFEST="release/Cangjingge-latest.json"

find release -maxdepth 1 \( \
  -name "藏经阁-v*-Mac-arm64.zip" -o \
  -name "Cangjingge-v*-Mac-arm64.zip" -o \
  -name "Cangjingge-latest-Mac-arm64.zip" -o \
  -name "藏经阁-*-arm64-mac.zip" -o \
  -name "藏经阁-*-arm64-mac.zip.blockmap" \
\) -exec rm -f {} +

ditto -c -k --sequesterRsrc --keepParent "$APP_SRC" "$ZIP_ZH"
cp -f "$ZIP_ZH" "$ZIP_ASCII"
cp -f "$ZIP_ZH" "$ZIP_LATEST"
node scripts/write-update-manifest.js

if [ -d "$USB_EXPORT_DIR" ]; then
  find "$USB_EXPORT_DIR" -maxdepth 1 \( \
    -name "藏经阁-v*-Mac-arm64.zip" -o \
    -name "._藏经阁-v*-Mac-arm64.zip" -o \
    -name "Cangjingge-v*-Mac-arm64.zip" -o \
    -name "._Cangjingge-v*-Mac-arm64.zip" -o \
    -name "Cangjingge-latest-Mac-arm64.zip" -o \
    -name "._Cangjingge-latest-Mac-arm64.zip" -o \
    -name "Cangjingge-latest.json" -o \
    -name "._Cangjingge-latest.json" -o \
    -name "Cangjingge-latest-Mac-arm64.sha256" -o \
    -name "._Cangjingge-latest-Mac-arm64.sha256" -o \
    -name "Cangjingge-latest.sha256" -o \
    -name "._Cangjingge-latest.sha256" -o \
    -name "藏经阁-*-arm64-mac.zip" -o \
    -name "._藏经阁-*-arm64-mac.zip" -o \
    -name "藏经阁-*-arm64-mac.zip.blockmap" -o \
    -name "._藏经阁-*-arm64-mac.zip.blockmap" -o \
    -name "*Windows*.zip" -o \
    -name "*windows*.zip" -o \
    -name "*Setup*.exe" -o \
    -name "builder-debug.yml" -o \
    -name "._*" \
  \) -exec rm -f {} +
  rm -rf "$USB_EXPORT_DIR/mac-arm64" \
    "$USB_EXPORT_DIR/cangjingge.app" \
    "$USB_EXPORT_DIR/cangjingge 2.app" \
    "$USB_EXPORT_DIR/cangjingge 3.app" \
    "$USB_EXPORT_DIR/藏经阁.app"
  cp -f "$ZIP_ZH" "$USB_EXPORT_DIR/"
  cp -f "$ZIP_ZH" "$USB_EXPORT_DIR/Cangjingge-latest-Mac-arm64.zip"
  cp -f "$UPDATE_MANIFEST" "$USB_EXPORT_DIR/Cangjingge-latest.json"
  shasum -a 256 "$USB_EXPORT_DIR/$(basename "$ZIP_ZH")" > "$USB_EXPORT_DIR/Cangjingge-latest-Mac-arm64.sha256"
  shasum -a 256 "$USB_EXPORT_DIR/Cangjingge-latest.json" > "$USB_EXPORT_DIR/Cangjingge-latest.sha256"
  rm -f "$USB_EXPORT_DIR/._$(basename "$ZIP_ZH")" \
    "$USB_EXPORT_DIR/._Cangjingge-latest-Mac-arm64.zip" \
    "$USB_EXPORT_DIR/._Cangjingge-latest-Mac-arm64.sha256" \
    "$USB_EXPORT_DIR/._Cangjingge-latest.json" \
    "$USB_EXPORT_DIR/._Cangjingge-latest.sha256"
  echo "已同步压缩包到U盘：$USB_EXPORT_DIR"
else
  echo "未找到U盘同步目录，已跳过：$USB_EXPORT_DIR"
fi

echo "已打包：$APP_SRC"
echo "已生成压缩包：$ZIP_ZH"
echo "已生成更新源：$UPDATE_MANIFEST"
echo "已安装：$USER_INSTALLED"
if [ -n "${DESKTOP_INSTALLED:-}" ]; then
  echo "已复制到桌面：$DESKTOP_INSTALLED"
fi
