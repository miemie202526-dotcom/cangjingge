#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");

const ROOT_DOCS = path.resolve(__dirname, "..", "docs");
const ROOT_DL = path.resolve(__dirname, "..", "release");
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
  ".exe": "application/octet-stream",
  ".zip": "application/zip",
};

function getLanIPs() {
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      if (it.family === "IPv4" && !it.internal) list.push(it.address);
    }
  }
  return list;
}

function safeJoin(root, rel) {
  const p = path.join(root, rel);
  if (!p.startsWith(root)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname || "/");
  if (pathname === "/") pathname = "/index.html";

  // /dl/<filename> → release/<filename>
  let filePath;
  if (pathname.startsWith("/dl/")) {
    const rel = pathname.slice("/dl/".length);
    filePath = safeJoin(ROOT_DL, rel);
  } else {
    filePath = safeJoin(ROOT_DOCS, pathname.replace(/^\//, ""));
  }
  if (!filePath) {
    res.writeHead(403); res.end("forbidden"); return;
  }

  fs.stat(filePath, (e, st) => {
    if (e || !st.isFile()) {
      res.writeHead(404); res.end("not found: " + pathname); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": st.size,
      "Access-Control-Allow-Origin": "*",
    };
    if (pathname.startsWith("/dl/")) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[site-serve] listening on ${HOST}:${PORT}`);
  console.log(`             local : http://localhost:${PORT}/`);
  for (const ip of getLanIPs()) {
    console.log(`             lan   : http://${ip}:${PORT}/`);
  }
  console.log(`[site-serve] docs root : ${ROOT_DOCS}`);
  console.log(`[site-serve] dl   root : ${ROOT_DL}  (served at /dl/<file>)`);
});
