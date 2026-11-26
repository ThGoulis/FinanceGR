const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createMemoryStorage() {
  const store = new Map();
  return {
    _store: store,
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); },
    get length() { return store.size; }
  };
}

function createFakeElement(id = "") {
  return {
    id,
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    style: {},
    disabled: false,
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._set.has(c)) this._set.delete(c); else this._set.add(c);
        } else if (force) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) { return this._set.has(c); }
    },
    focus() {},
    blur() {}
  };
}

function loadFinanceGrRuntime(files = [
  "js/state.js",
  "js/periods-ui.js",
  "js/bank-import.js",
  "js/settings-backup.js",
  "js/transactions.js",
  "js/wealth.js",
  "js/cloud-sync.js"
]) {
  const root = path.join(__dirname, "..", "..");
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const elements = new Map();

  function getEl(id) {
    if (!elements.has(id)) elements.set(id, createFakeElement(id));
    return elements.get(id);
  }

  const modals = [];
  const toasts = [];

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    crypto: globalThis.crypto,
    localStorage,
    sessionStorage,
    document: {
      activeElement: null,
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      createElement: () => createFakeElement(),
      body: createFakeElement("body")
    },
    window: {},
    render: () => {},
    _modals: modals,
    _toasts: toasts
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const rel of files) {
    const code = fs.readFileSync(path.join(root, rel), "utf8");
    vm.runInContext(code, ctx, { filename: rel });
  }

  // Override UI modal/toast helpers to capture calls and auto-confirm when needed
  vm.runInContext(`
    var _autoConfirmModal = true;
    function showModal(msg, isConfirm = false, cb = null, title = "") {
      _modals.push({ msg, isConfirm, title });
      if (isConfirm && typeof cb === "function" && _autoConfirmModal) cb(true);
    }
    function showToast(msg) { _toasts.push(msg); }
    function render() {}
    function updateBackupStatusUI() {}
    function pushCloudSyncNow() {}
  `, ctx);


  // Bridge lexical top-level `let`/`const` bindings with `globalThis`/`sandbox`
  // so `ctx.data = ...` in tests updates the live `data` binding used by all `js/*.js` functions.
  vm.runInContext(`
    if (typeof data !== "undefined") {
      Object.defineProperty(globalThis, "data", {
        configurable: true,
        enumerable: true,
        get() { return data; },
        set(v) { data = v; }
      });
    }
    if (typeof dirtyTxIds !== "undefined") {
      Object.defineProperty(globalThis, "dirtyTxIds", {
        configurable: true,
        enumerable: true,
        get() { return dirtyTxIds; },
        set(v) { dirtyTxIds = v; }
      });
    }
    if (typeof fullSyncNeeded !== "undefined") {
      Object.defineProperty(globalThis, "fullSyncNeeded", {
        configurable: true,
        enumerable: true,
        get() { return fullSyncNeeded; },
        set(v) { fullSyncNeeded = v; }
      });
    }
    if (typeof bankPreviewRows !== "undefined") {
      Object.defineProperty(globalThis, "bankPreviewRows", {
        configurable: true,
        enumerable: true,
        get() { return bankPreviewRows; },
        set(v) { bankPreviewRows = v; }
      });
    }
    if (typeof _fbCurrentUser !== "undefined") {
      Object.defineProperty(globalThis, "_fbCurrentUser", {
        configurable: true,
        enumerable: true,
        get() { return _fbCurrentUser; },
        set(v) { _fbCurrentUser = v; }
      });
    }
  `, ctx);

  return { ctx, localStorage, sessionStorage, getEl, modals, toasts };
}

module.exports = { loadFinanceGrRuntime };
