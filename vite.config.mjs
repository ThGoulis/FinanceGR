import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAIN_APP_SCRIPTS = [
  "js/state.js",
  "js/firebase-config.js",
  "js/telemetry.js",
  "js/firebase-auth.js",
  "js/cloud-sync.js",
  "js/periods-ui.js",
  "js/transactions.js",
  "js/bank-import.js",
  "js/planning.js",
  "js/wealth.js",
  "js/overview.js",
  "js/settings-backup.js",
  "js/events.js",
  "js/app.js"
];

const ADMIN_CONSOLE_SCRIPTS = [
  "js/state.js",
  "js/firebase-config.js",
  "js/firebase-auth.js",
  "js/cloud-sync.js",
  "js/periods-ui.js",
  "js/bank-import.js",
  "js/planning.js",
  "js/wealth.js",
  "js/self-tests.js",
  "js/admin-events.js",
  "js/admin.js"
];

const VIRTUAL_APP_ID = "virtual:financegr-app";
const RESOLVED_APP_ID = "\0" + VIRTUAL_APP_ID;
const VIRTUAL_ADMIN_ID = "virtual:financegr-admin";
const RESOLVED_ADMIN_ID = "\0" + VIRTUAL_ADMIN_ID;

function concatScriptsAsModule(relPaths) {
  return relPaths
    .map((rel) => {
      const abs = path.resolve(__dirname, rel);
      const code = fs.readFileSync(abs, "utf8");
      return `/* === ${rel} === */\n${code}\n`;
    })
    .join("\n");
}

function financeGrVirtualBundlesPlugin() {
  return {
    name: "financegr-virtual-bundles",
    resolveId(id) {
      if (id === VIRTUAL_APP_ID) return RESOLVED_APP_ID;
      if (id === VIRTUAL_ADMIN_ID) return RESOLVED_ADMIN_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_APP_ID) {
        for (const rel of MAIN_APP_SCRIPTS) this.addWatchFile(path.resolve(__dirname, rel));
        return concatScriptsAsModule(MAIN_APP_SCRIPTS);
      }
      if (id === RESOLVED_ADMIN_ID) {
        for (const rel of ADMIN_CONSOLE_SCRIPTS) this.addWatchFile(path.resolve(__dirname, rel));
        return concatScriptsAsModule(ADMIN_CONSOLE_SCRIPTS);
      }
      return null;
    },
    handleHotUpdate({ file, server }) {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.includes("/js/") && normalized.endsWith(".js")) {
        for (const vid of [RESOLVED_APP_ID, RESOLVED_ADMIN_ID]) {
          const mod = server.moduleGraph.getModuleById(vid);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
    }
  };
}

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [financeGrVirtualBundlesPlugin()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        admin: path.resolve(__dirname, "admin.html")
      }
    }
  }
});
