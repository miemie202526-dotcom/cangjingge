# 藏经阁

藏经阁是一款 Electron 桌面端智能文件库与 AI 工作台，面向本地资料沉淀、聊天记录阅读、关键字检索、AI 分析、文件生成、导出交付和金句库管理。

## 核心能力

- 文件库：上传、解析、预览、阅读、搜索、定位、标签、收藏、原文件打开。
- AI 分析：基于文件或自定义问题生成结构化报告。
- 文件生成：生成 Word、PDF、Excel、CSV、HTML、PPTX 等交付文件。
- 金句库：沉淀高价值话术、摘录、标签与复用。
- 本地数据：IndexedDB + 磁盘文件库，本机存储，支持导入导出备份。
- 手动更新：读取 `Cangjingge-latest.json`，按当前系统选择 Mac 或 Windows 下载包。

## 本地开发

要求：Node.js 20+

```bash
npm ci
npm start
```

检查：

```bash
npm run check
npm run check:syntax
```

## 本机打包

Mac 打包并同步到 U 盘 `葬经阁111`：

```bash
npm run desktop:mac
```

Mac 不升版本打包：

```bash
npm run desktop:mac:noBump
```

Windows x64 压缩包并同步到 U 盘 `葬经阁windows`：

```bash
npm run desktop:windows
```

Windows 不升版本打包：

```bash
npm run desktop:windows:noBump
```

U 盘目录规则：

- `/Volumes/U盘/葬经阁111` 只放 Mac 下载压缩包。
- `/Volumes/U盘/葬经阁windows` 只放 Windows 下载压缩包。

## GitHub 发版

推送 tag 后，GitHub Actions 会自动构建双系统 Release：

```bash
git tag v1.1.2
git push origin v1.1.2
```

Release 会生成：

- `藏经阁-vX.Y.Z-Mac-arm64.zip`
- `Cangjingge-latest-Mac-arm64.zip`
- `藏经阁-vX.Y.Z-Windows-x64.zip`
- `Cangjingge-latest-Windows-x64.zip`
- `Cangjingge-latest.json`
- `.sha256` 校验文件

用户软件设置页里的“更新源 JSON”应填写 GitHub Release 中 `Cangjingge-latest.json` 的固定下载地址。Mac 和 Windows 使用同一个 JSON，软件会自动选择当前系统对应的下载包。

## 安全说明

- OpenAI API Key 通过系统安全存储或会话输入保存，不提交到仓库。
- `.gitignore` 排除了 `node_modules/`、`release/`、本地缓存、环境变量文件和本机密钥文件。
- 发布包由 GitHub Actions 构建，默认未做 Apple Developer ID 或 Windows 代码签名。
