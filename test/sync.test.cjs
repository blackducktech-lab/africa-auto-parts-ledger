const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { Controller } = require('../assets/sync-core.js');
const root = path.resolve(__dirname, '..');
const record = (extra = {}) => ({ id: 'tx_1', type: 'INCOME', currency: 'USD', amount: 12.5, categoryId: 'parts_sales', date: '2026-11-13', note: 'Test only', isSample: false, ...extra });
function fakeAdapter() {
  const calls = [], watchers = [];
  return { calls, watchers, connected: true,
    auth(callback) { this.login = callback; return () => {}; },
    watch(next, error) { watchers.push({ next, error }); return () => {}; },
    online() { return this.connected; },
    signIn: async () => {}, signOut: async () => {},
    async save(...args) { calls.push(['save', ...args]); },
    async remove(...args) { calls.push(['remove', ...args]); },
    async merge(rows) { calls.push(['merge', rows]); return { created: rows.length, skipped: 0, conflicts: 0 }; }
  };
}
test('cloud mode waits for server authorization, isolates account caches and rejects offline writes', async () => {
  const adapter = fakeAdapter(), seen = [];
  const controller = new Controller(adapter, rows => rows, { records: rows => seen.push(rows) });
  controller.start(); adapter.login({ uid: 'one', email: 'one@example.com' });
  adapter.watchers[0].next({ fromCache: true, rows: [{ record: record(), version: 1 }] });
  assert.deepEqual(seen, [null]);
  await assert.rejects(controller.save(record(), null), { code: 'not-ready' });
  adapter.watchers[0].next({ fromCache: false, rows: [{ record: record(), version: 1 }] });
  assert.equal(controller.version('tx_1'), 1);
  await controller.save(record(), 1);
  assert.equal(adapter.calls.length, 1);
  adapter.connected = false; controller.networkChanged();
  await assert.rejects(controller.remove('tx_1', 1), { code: 'not-ready' });
  adapter.login({ uid: 'outsider', email: 'outsider@example.com' });
  adapter.watchers[1].next({ fromCache: true, rows: [{ record: record(), version: 1 }] });
  adapter.watchers[0].next({ fromCache: false, rows: [{ record: record({ note: 'Late old listener' }), version: 2 }] });
  assert.equal(seen.at(-1), null);
  adapter.watchers[1].error({ code: 'permission-denied' });
  assert.equal(controller.state.mode, 'cloud');
  assert.equal(controller.state.ready, false);
});
test('imports are explicit, exclude samples, use bounded chunks and unlock after a failed save', async () => {
  const adapter = fakeAdapter(), controller = new Controller(adapter, rows => rows);
  controller.start(); adapter.login({ uid: 'one' });
  adapter.watchers[0].next({ fromCache: false, rows: [] });
  assert.equal(adapter.calls.length, 0);
  const result = await controller.merge([record({ isSample: true }), ...Array.from({ length: 41 }, (_, i) => record({ id: 't_' + i }))]);
  assert.deepEqual(result, { created: 41, skipped: 0, conflicts: 0 });
  assert.deepEqual(adapter.calls.map(call => call[1].length), [20, 20, 1]);
  adapter.save = async () => { throw Object.assign(new Error('conflict'), { code: 'conflict' }); };
  await assert.rejects(controller.save(record(), 1), { code: 'conflict' });
  assert.equal(controller.state.busy, false);
});
test('UI preserves local data and conflict drafts, captures opened edit versions and returns to local on sign-out', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://example.github.io/africa-auto-parts-ledger/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, adapter = fakeAdapter(), key = 'auto_parts_export_ledger_v1';
  const local = JSON.stringify([record({ id: 'local_1', note: 'Keep local' })]);
  w.localStorage.setItem(key, local); w.createCloudAdapter = () => adapter;
  w.eval(['assets/sync-core.js', 'assets/app.js', 'assets/sync-ui.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'));
  await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  adapter.login({ uid: 'one', email: 'one@example.com' });
  adapter.watchers[0].next({ fromCache: false, rows: [{ record: record(), version: 1 }] });
  assert.equal(w.localStorage.getItem(key), local);
  assert.doesNotMatch(w.document.getElementById('transactionList').textContent, /Keep local/);
  assert.equal(adapter.calls.length, 0);
  w.openModal('tx_1'); w.document.getElementById('formNote').value = 'My unsaved edit';
  adapter.watchers[0].next({ fromCache: false, rows: [{ record: record({ note: 'Other phone edit' }), version: 2 }] });
  adapter.save = async (_row, version) => {
    assert.equal(version, 1);
    throw Object.assign(new Error('conflict'), { code: 'conflict' });
  };
  await w.saveRecord({ preventDefault() {} });
  assert.equal(w.document.getElementById('formNote').value, 'My unsaved edit');
  assert.equal(w.document.getElementById('recordModal').classList.contains('hidden'), false);
  assert.match(w.document.getElementById('formSyncError').textContent, /Record changed/);
  assert.equal(w.localStorage.getItem(key), local);
  w.closeModal(); adapter.login(null);
  assert.match(w.document.getElementById('transactionList').textContent, /Keep local/);
  assert.equal(w.localStorage.getItem(key), local);
});
