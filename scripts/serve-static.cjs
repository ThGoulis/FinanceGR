#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const ROOT = fs.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PROJECT_ROOT;
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const cleanRel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, cleanRel);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  const mode = ROOT === DIST_DIR ? "dist/ (Vite production build)" : "project root (run 'npm run build' or 'npm run dev')";
  console.log(`FinanceGR static server [${mode}] listening on http://127.0.0.1:${PORT}`);
});
