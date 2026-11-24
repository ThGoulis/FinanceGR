const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function createHarness() {
  const local = new Map();
  const session = new Map();
  const localStorage = {
    getItem: key => local.has(key) ? local.get(key) : null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: key => local.delete(key),
    clear: () => local.clear()
  };
  const sessionStorage = {
    getItem: key => session.has(key) ? session.get(key) : null,
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: key => session.delete(key)
  };
  const context = vm.createContext({
    console: { error: () => {}, warn: () => {}, log: () => {} },
    Date,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Map,
    Set,
    Intl,
    RegExp,
    Error,
    Uint8Array,
    localStorage,
    sessionStorage,
    window: { innerWidth: 1280 },
    document: { getElementById: () => null },
    showToast: () => {},
    showModal: () => {},
    render: () => {}
  });
  for (const file of ['js/state.js', 'js/cloud-sync.js', 'js/periods-ui.js', 'js/transactions.js', 'js/bank-import.js', 'js/planning.js', 'js/wealth.js', 'js/overview.js', 'js/settings-backup.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const syncCycleFunction = appSource.match(/async function syncCycleNow\(silent = true\) \{[\s\S]*?\n\}/);
  if (syncCycleFunction) vm.runInContext(syncCycleFunction[0], context, { filename: 'js/app.js#syncCycleNow' });
  return { context, local, localStorage };
}

test('FX: EUR quotes convert directly and foreign currencies require Worker priceEur', () => {
  const { context } = createHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('convertPriceToEur(123.45, "EUR")', context))), {
    priceEur: 123.45, currency: 'EUR', fxSource: 'quote_currency'
  });
  assert.equal(vm.runInContext('convertPriceToEur(100, "USD")', context), null);
  assert.equal(vm.runInContext('convertPriceToEur(100, "GBP")', context), null);
  assert.equal(vm.runInContext('convertPriceToEur(-1, "EUR")', context), null);
});

test('DCA creates an investment transaction and does not inflate Net Worth', () => {
  const { context } = createHarness();
  vm.runInContext(`
    data.profile.initialSavings = 1000;
    data.portfolioAssets = [{ id: 'asset-1', name: 'ETF', units: 10, invested: 500, current: 500, lastUnitPriceEur: 50 }];
  `, context);
  const before = vm.runInContext('computeNetWorthSnapshot("all", null, today()).netWorth', context);
  const result = vm.runInContext('addDcaToPortfolioAsset("asset-1", 50)', context);
  const after = vm.runInContext('computeNetWorthSnapshot("all", null, today()).netWorth', context);
  const snapshot = vm.runInContext(`({
    units: data.portfolioAssets[0].units,
    invested: data.portfolioAssets[0].invested,
    current: data.portfolioAssets[0].current,
    txCount: data.transactions.length,
    tx: data.transactions[0]
  })`, context);
  assert.equal(result, true);
  assert.equal(snapshot.units, 11);
  assert.equal(snapshot.invested, 550);
  assert.equal(snapshot.current, 550);
  assert.equal(snapshot.txCount, 1);
  assert.equal(snapshot.tx.type, 'saving');
  assert.equal(snapshot.tx.category, 'Επένδυση');
  assert.equal(snapshot.tx.linkedPortfolioAssetId, 'asset-1');
  assert.equal(after, before);
});

test('DCA rejects invalid amounts without mutating state', () => {
  const { context } = createHarness();
  vm.runInContext(`data.portfolioAssets = [{ id: 'asset-1', name: 'ETF', units: 1, invested: 10, current: 10 }];`, context);
  assert.equal(vm.runInContext('addDcaToPortfolioAsset("asset-1", 0)', context), false);
  assert.equal(vm.runInContext('data.transactions.length', context), 0);
  assert.equal(vm.runInContext('data.portfolioAssets[0].invested', context), 10);
});

test('Persistence writes only the canonical key and removes legacy copy after success', () => {
  const { context, local } = createHarness();
  local.set('personalFinanceDashboard_v5', '{"transactions":[]}');
  const saved = vm.runInContext('persist(true, true)', context);
  assert.equal(saved, true);
  assert.equal(local.has('financeGR_v1_state'), true);
  assert.equal(local.has('personalFinanceDashboard_v5'), false);
  assert.equal(local.size, 1);
});

test('Persistence reports failure and retains legacy copy when canonical write fails', () => {
  const { context, local } = createHarness();
  local.set('personalFinanceDashboard_v5', '{"transactions":[]}');
  vm.runInContext(`localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };`, context);
  const saved = vm.runInContext('persist(true, true)', context);
  assert.equal(saved, false);
  assert.equal(local.has('personalFinanceDashboard_v5'), true);
  assert.equal(vm.runInContext('localPersistenceStatus', context), 'error');
});


test('Manual Cloud Sync does not report success when the push fails', async () => {
  const { context } = createHarness();
  vm.runInContext(`
    data.settings.cloudSync = { enabled: true, roomCode: 'FG-TEST', pin: '123456', roomPin: '123456', pendingPush: true };
    pullCloudSyncNow = async () => 'synced';
    pushCloudSyncNow = async () => false;
    openCloudSyncModal = () => {};
  `, context);
  const result = await vm.runInContext('manualSyncNow()', context);
  assert.equal(result, false);
});

test('Automatic Cloud Sync does not push after a failed pull', async () => {
  const { context } = createHarness();
  vm.runInContext(`
    data.settings.cloudSync = { enabled: true, roomCode: 'FG-TEST', pin: '123456', roomPin: '123456', pendingPush: true };
    let pushCalls = 0;
    pullCloudSyncNow = async () => 'error';
    pushCloudSyncNow = async () => { pushCalls++; return true; };
    globalThis.__getPushCalls = () => pushCalls;
  `, context);
  const result = await vm.runInContext('syncCycleNow(true)', context);
  assert.equal(result, false);
  assert.equal(vm.runInContext('__getPushCalls()', context), 0);
});


test('DCA link survives JSON and Cloud Sync transaction sanitization', () => {
  const { context } = createHarness();
  const tx = { id: 'dca-1', type: 'saving', amount: 25, date: '2026-11-24', category: 'Επένδυση', description: 'DCA ETF', linkedPortfolioAssetId: 'asset-1' };
  const restored = vm.runInContext(`sanitizeImportedTransaction(${JSON.stringify(tx)})`, context);
  const synced = vm.runInContext(`sanitizeRemoteTx(${JSON.stringify(tx)})`, context);
  assert.equal(restored.linkedPortfolioAssetId, 'asset-1');
  assert.equal(synced.linkedPortfolioAssetId, 'asset-1');
});
