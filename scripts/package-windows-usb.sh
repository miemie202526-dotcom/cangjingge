#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="/Users/dongzi/Documents/Codex/.tools/node-v20.19.4-darwin-arm64"
USB_WINDOWS_DIR="${USB_WINDOWS_DIR:-/Volumes/U盘/葬经阁windows}"
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
WIN_SRC="release/windows-build/win-unpacked"
STAGE_PARENT="/private/tmp/cangjingge-win-package"
STAGE_NAME="Cangjingge-v${APP_VERSION}-Windows-x64"
ZIP_ZH="release/藏经阁-v${APP_VERSION}-Windows-x64.zip"
ZIP_LATEST="release/Cangjingge-latest-Windows-x64.zip"
UPDATE_MANIFEST="release/Cangjingge-latest.json"

npm run check
npx electron-builder --win dir --x64 --config.directories.output=release/windows-build

if [ ! -d "$WIN_SRC" ]; then
  echo "未找到 Windows 打包产物：$WIN_SRC" >&2
  exit 1
fi

rm -rf "$STAGE_PARENT"
mkdir -p "$STAGE_PARENT/$STAGE_NAME"
ditto "$WIN_SRC" "$STAGE_PARENT/$STAGE_NAME"
find "$STAGE_PARENT" \( -name "._*" -o -name ".DS_Store" \) -exec rm -f {} +

find release -maxdepth 1 \( \
  -name "藏经阁-v*-Windows-x64.zip" -o \
  -name "Cangjingge-latest-Windows-x64.zip" -o \
  -name "藏经阁-Setup-*.exe" -o \
  -name "藏经阁-portable-*.zip" \
\) -exec rm -f {} +

(cd "$STAGE_PARENT" && /usr/bin/zip -r -X "$ROOT_DIR/$ZIP_ZH" "$STAGE_NAME" >/dev/null)
cp -f "$ZIP_ZH" "$ZIP_LATEST"
node scripts/write-update-manifest.js

if [ -d "$USB_WINDOWS_DIR" ]; then
  find "$USB_WINDOWS_DIR" -maxdepth 1 \( \
    -name "藏经阁-v*-Windows-x64.zip" -o \
    -name "._藏经阁-v*-Windows-x64.zip" -o \
    -name "Cangjingge-latest-Windows-x64.zip" -o \
    -name "._Cangjingge-latest-Windows-x64.zip" -o \
    -name "Cangjingge-latest.json" -o \
    -name "._Cangjingge-latest.json" -o \
    -name "Cangjingge-latest-Windows-x64.sha256" -o \
    -name "._Cangjingge-latest-Windows-x64.sha256" -o \
    -name "Cangjingge-latest.sha256" -o \
    -name "._Cangjingge-latest.sha256" -o \
    -name "*Mac*.zip" -o \
    -name "*mac*.zip" -o \
    -name "*arm64-mac*" -o \
    -name "builder-debug.yml" -o \
    -name "._*" \
  \) -exec rm -f {} +
  rm -rf "$USB_WINDOWS_DIR/mac-arm64" \
    "$USB_WINDOWS_DIR/cangjingge.app" \
    "$USB_WINDOWS_DIR/cangjingge 2.app" \
    "$USB_WINDOWS_DIR/cangjingge 3.app" \
    "$USB_WINDOWS_DIR/藏经阁.app"
  cp -f "$ZIP_ZH" "$USB_WINDOWS_DIR/"
  cp -f "$ZIP_LATEST" "$USB_WINDOWS_DIR/"
  cp -f "$UPDATE_MANIFEST" "$USB_WINDOWS_DIR/Cangjingge-latest.json"
  shasum -a 256 "$USB_WINDOWS_DIR/$(basename "$ZIP_ZH")" > "$USB_WINDOWS_DIR/Cangjingge-latest-Windows-x64.sha256"
  shasum -a 256 "$USB_WINDOWS_DIR/Cangjingge-latest.json" > "$USB_WINDOWS_DIR/Cangjingge-latest.sha256"
  rm -f "$USB_WINDOWS_DIR"/._*
  echo "已同步 Windows 压缩包到U盘：$USB_WINDOWS_DIR"
else
  echo "未找到 Windows U盘同步目录，已跳过：$USB_WINDOWS_DIR"
fi

echo "已生成 Windows 压缩包：$ZIP_ZH"
echo "已生成 Windows latest：$ZIP_LATEST"
echo "已生成更新源：$UPDATE_MANIFEST"
