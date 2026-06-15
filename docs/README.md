# 藏经阁 · 官网（GitHub Pages 友好）

`docs/index.html` 是一个**完全自包含**的静态官网，无需任何构建工具，直接挂到任何静态托管即可。

## 一、最快上线（GitHub Pages，免费）

1. 把整个仓库 push 到 GitHub。
2. 仓库 → Settings → **Pages** → Source 选 **`Deploy from a branch`**，Branch 选 `main` / `master`，目录选 **`/docs`**。
3. 等 1 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可看到官网。

> 想要自定义域名？把你的域名写到 `docs/CNAME` 这一行（无 `http://`，例如 `cangjingge.example.com`），DNS 加 CNAME 指向 `<用户名>.github.io` 即可。

## 二、配置下载链接（必做一次）

打开 `docs/index.html`，找到底部 `SITE_CONFIG`：

```js
const SITE_CONFIG = {
  version: "v1.0.31",
  githubRepo: "https://github.com/YOUR_NAME/cangjingge",
  installerUrl: "https://github.com/YOUR_NAME/cangjingge/releases/latest/download/藏经阁-Setup-1.0.31.exe",
  portableUrl:  "https://github.com/YOUR_NAME/cangjingge/releases/latest/download/藏经阁-portable-1.0.31.zip",
  installerSize: "≈ 95 MB",
  portableSize:  "≈ 180 MB",
};
```

把 4 个 URL 改成你真实的下载链接即可。推荐采用 **GitHub Releases + `latest/download` 永久链接**：上传一次新版本，链接里 `1.0.31` 自动跟随你 Release 的 tag 变化也行（也可以用 `releases/latest/download/<filename>` 形式，filename 不变即可常年指向最新）。

## 三、生成可下载的产物

### 1. 安装版（NSIS）— 推荐

```bash
npm run dist
# 产物：release/藏经阁-Setup-<version>.exe
```

### 2. 便携版（zip）

```bash
npm run package:portable
# 产物：release/藏经阁-portable-<version>.zip（默认仅打包最新一次的 win-unpacked）
```

> 该脚本由 `scripts/package-portable.ps1` 提供，会自动找到 `release/build-*/win-unpacked/` 中**最新一次**构建并压缩。

### 3. 上传到 GitHub Release

```bash
# 用 gh CLI 一行上传
gh release create v1.0.31 release/藏经阁-Setup-1.0.31.exe release/藏经阁-portable-1.0.31.zip \
  --title "藏经阁 v1.0.31" --notes "见 CHANGELOG"
```

## 四、托管别处？也行

- **Cloudflare Pages**：直接连 GitHub 仓库，Build command 留空，Build output 填 `docs`。
- **Vercel / Netlify**：同上，Output directory 设 `docs`。
- **私网 / 自托管**：把 `docs/` 整个目录扔到任意静态服务器（Nginx / Caddy）即可。

## 五、目录说明

```
docs/
  index.html          # 官网主页（完整 SPA，复制到任意位置都能跑）
  assets/
    icon-256.png      # 网站 favicon / 导航图标
    icon-1024.png     # OG 分享大图
  README.md           # 本说明
```

没有任何外部依赖（没有 npm / 没有打包），改 HTML 即所见即所得。
