#!/usr/bin/env bash
# 藏经阁 · Mac 开发环境一键准备
set -euo pipefail
cd "$(dirname "$0")/.."

echo ">>> Node version:"
node -v
npm -v

echo ">>> npm install..."
npm install

echo ">>> syntax check..."
npm run check:syntax

echo ">>> 完成。启动应用: npm start"
echo ">>> 恢复用户数据见上级目录「用户数据恢复说明.md」"
