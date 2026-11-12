const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const key = 'auto_parts_export_ledger_v1';
const record = (changes = {}) => ({ id: 'tx_test', type: 'INCOME', currency: 'USD', amount: 100,
  categoryId: 'parts_sales', date: '2026-11-12', note: 'Nigeria 奈及利亞', isSample: false, ...changes });
function open(t, saved = []) {
  const dom = new JSDOM(html, { url: 'https://example.github.io/africa-auto-parts-ledger/', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  if (saved !== null) w.localStorage.setItem(key, typeof saved === 'string' ? saved : JSON.stringify(saved));
  w.eval(app);
  w.onload = null;
  w.initApp();
  return w;
}
function stored(w) { return JSON.parse(w.localStorage.getItem(key)); }
function fill(w, values) {
  for (const [id, value] of Object.entries(values)) w.document.getElementById(id).value = value;
}
test('first launch displays labeled samples and can clear them without deleting user records', t => {
  const w = open(t, null);
  assert.equal(stored(w).filter(x => x.isSample).length, 5);
  w.openModal(); fill(w, { formAmount: '12.50', formNote: 'Actual record' });
  w.saveRecord({ preventDefault() {} });
  w.promptClearSampleData(); w.document.getElementById('confirmActionBtn').click();
  assert.equal(stored(w).length, 1);
  assert.equal(stored(w)[0].note, 'Actual record');
});
test('create, edit, reload and delete a record through the app controls', t => {
  const w = open(t);
  w.openModal();
  fill(w, { formAmount: '325.75', formNote: 'Deposit 訂金' });
  w.saveRecord({ preventDefault() {} });
  const id = stored(w)[0].id;
  assert.equal(stored(w)[0].amount, 325.75);
  w.openModal(id); fill(w, { formAmount: '400.25' }); w.saveRecord({ preventDefault() {} });
  const reloaded = open(t, stored(w));
  assert.equal(reloaded.document.getElementById('usdIncome').textContent, '$400.25');
  reloaded.promptDelete(id);
  assert.equal(stored(reloaded).length, 1, 'deletion waits for confirmation');
  reloaded.document.getElementById('confirmActionBtn').click();
  assert.deepEqual(stored(reloaded), []);
});
test('currencies, cents and month filters remain independent', t => {
  const w = open(t, [record({ id: 'a', amount: 0.1 }), record({ id: 'b', amount: 0.2 }),
    record({ id: 'c', type: 'EXPENSE', amount: 0.3, categoryId: 'bank_fee' }),
    record({ id: 'd', currency: 'TWD', amount: 18.5 }),
    record({ id: 'e', date: '2026-10-01', amount: 999 })]);
  w.document.getElementById('monthFilter').value = '2026-11'; w.renderApp();
  assert.equal(w.document.getElementById('usdIncome').textContent, '$0.30');
  assert.equal(w.document.getElementById('usdNet').textContent, '$0.00');
  assert.equal(w.document.getElementById('twdIncome').textContent, 'NT$18.50');
  assert.equal(w.document.getElementById('transactionList').children.length, 4);
});
test('malformed backups, executable IDs, duplicate IDs and impossible dates are rejected', t => {
  const w = open(t, [record()]);
  for (const backup of [[record({ id: "x');alert(1);//" })], [record(), record()],
    [record({ date: '2026-02-30' })], [record({ amount: Infinity })], [record({ amount: -10 })],
    [record({ amount: 1.005 })], [record({ currency: 'EUR' })], [record({ note: {} })]]) {
    assert.throws(() => w.validateTransactions(backup));
  }
  assert.equal(stored(w)[0].amount, 100);
});
test('notes render as text and CSV neutralizes formulas without changing signed amounts', t => {
  const w = open(t, [record({ note: '<img src=x onerror=alert(1)>' })]);
  assert.equal(w.document.querySelector('#transactionList img'), null);
  assert.match(w.document.getElementById('transactionList').textContent, /<img src=x/);
  for (const formula of ['=HYPERLINK("https://example.com")', '+1+1', '@SUM(A1)', '  -1+1', '\t=1']) {
    assert.match(w.csvText(formula), /^"'/);
  }
  assert.equal(w.csvText('正常,備註 "test"'), '"正常,備註 ""test"""');
  let blob;
  w.URL.createObjectURL = b => { blob = b; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.exportToCSV();
  assert.ok(blob instanceof w.Blob);
});
test('storage failure leaves the previously saved ledger intact and keeps the form open', t => {
  const w = open(t, [record()]);
  w.openModal(); fill(w, { formAmount: '77.25' });
  w.Storage.prototype.setItem = () => { throw new w.DOMException('Full', 'QuotaExceededError'); };
  w.saveRecord({ preventDefault() {} });
  assert.equal(stored(w).length, 1);
  assert.equal(stored(w)[0].amount, 100);
  assert.equal(w.document.getElementById('recordModal').classList.contains('hidden'), false);
  assert.match(w.document.getElementById('toastMsg').textContent, /Save failed/);
});
test('corrupt existing storage stays untouched and can be downloaded as a raw recovery backup', t => {
  const original = '{invalid';
  const w = open(t, original);
  assert.equal(w.localStorage.getItem(key), original);
  assert.equal(w.document.getElementById('storageWarning').classList.contains('hidden'), false);
  assert.equal(w.persistTransactions([record()]), false);
  let backup;
  w.URL.createObjectURL = b => { backup = b; return 'blob:recovery'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.backupJSON();
  assert.equal(backup.size, Buffer.byteLength(original));
  assert.equal(w.localStorage.getItem(key), original);
});
test('restore requires confirmation and replaces records only after validation', async t => {
  const w = open(t, [record()]);
  class Reader {
    readAsText() { this.onload({ target: { result: JSON.stringify([record({ id: 'restored', amount: 250 })]) } }); }
  }
  w.FileReader = Reader;
  const input = { files: [{ size: 100 }], value: 'backup.json' };
  w.restoreJSON({ target: input });
  assert.equal(stored(w)[0].id, 'tx_test');
  assert.equal(w.document.getElementById('confirmDialog').classList.contains('hidden'), false);
  w.document.getElementById('confirmActionBtn').click();
  assert.equal(stored(w)[0].id, 'restored');
  assert.equal(stored(w)[0].amount, 250);
});
