import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { createRecordStore } from '../src/cloud-store.mjs';
let env;
const one = { email: 'one@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const two = { ...one, email: 'two@example.com' };
const dbFor = (uid, claims = one) => env.authenticatedContext(uid, claims).firestore();
const record = (extra = {}) => ({ id: 'tx_test', type: 'INCOME', currency: 'USD', amount: 12.5, categoryId: 'parts_sales', date: '2026-11-13', note: 'Emulator test only', isSample: false, ...extra });
const data = (extra = {}) => ({ type: 'INCOME', currency: 'USD', amountMinor: 1250, categoryId: 'parts_sales', date: '2026-11-13', note: 'Test', deleted: false, version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'one', ...extra });
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use npm run test:rules. Never run against production.');
  env = await initializeTestEnvironment({ projectId: 'demo-africa-ledger', firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'access/shared-ledger'), { emails: ['one@example.com', 'two@example.com'] });
  });
});
after(async () => { await env?.cleanup(); });
test('only two verified Google accounts can access entries; membership is private and immutable', async () => {
  const allowed = dbFor('one');
  await assertSucceeds(setDoc(doc(allowed, 'entries/a'), data()));
  await assertSucceeds(getDocs(collection(dbFor('two', two), 'entries')));
  for (const db of [env.unauthenticatedContext().firestore(), dbFor('outsider', { ...one, email: 'other@example.com' }), dbFor('unverified', { ...one, email_verified: false }), dbFor('password', { ...one, firebase: { sign_in_provider: 'password' } })]) {
    await assertFails(getDocs(collection(db, 'entries')));
    await assertFails(setDoc(doc(db, 'entries/b'), data()));
    await assertFails(deleteDoc(doc(db, 'entries/a')));
  }
  await assertFails(getDoc(doc(allowed, 'access/shared-ledger')));
  await assertFails(setDoc(doc(allowed, 'access/shared-ledger'), { emails: ['outsider@example.com'] }));
  await assertFails(setDoc(doc(allowed, 'other/a'), { public: true }));
  await assertSucceeds(getDocs(collection(dbFor('case', { ...one, email: 'ONE@EXAMPLE.COM' }), 'entries')));
});
test('rules enforce money, categories, fields, timestamps and monotonic versions', async () => {
  const db = dbFor('one');
  for (const change of [{ amountMinor: 0 }, { amountMinor: 1.5 }, { amountMinor: 1000000000001 }, { currency: 'EUR' }, { categoryId: 'bank_fee' }, { note: 'x'.repeat(10001) }, { version: 2 }, { unexpected: true }, { date: '2026-13-01' }, { date: '2026-02-29' }, { date: '1900-02-29' }, { date: '2026-04-31' }, { deleted: true }, { updatedBy: 'two' }, { createdAt: new Date('2020-01-01') }]) {
    await assertFails(setDoc(doc(db, 'entries/invalid'), data(change)));
  }
  const ref = doc(db, 'entries/valid');
  await assertSucceeds(setDoc(ref, data()));
  await assertFails(updateDoc(ref, { note: 'stale', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { version: 3, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { version: 2, note: 'valid edit', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, 'entries/leap'), data({ date: '2000-02-29' })));
});
test('independent phones receive live updates; stale edits/deletes preserve the other phone’s changes', async () => {
  const dbOne = dbFor('one'), dbTwo = dbFor('two', two);
  const storeOne = createRecordStore(dbOne, () => 'one'), storeTwo = createRecordStore(dbTwo, () => 'two');
  const events = [];
  let rejectWatch;
  const fail = new Promise((_, reject) => { rejectWatch = reject; });
  const stop = storeTwo.watch(snapshot => { if (!snapshot.fromCache) events.push(snapshot.rows); }, rejectWatch);
  const wait = predicate => Promise.race([fail, new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => { if (predicate()) { clearInterval(timer); resolve(); } else if (Date.now() - started > 8000) { clearInterval(timer); reject(new Error('Live snapshot timeout')); } }, 20);
  })]);
  try {
    await wait(() => events.length > 0);
    await storeOne.save(record(), null, 'one');
    await wait(() => events.at(-1)?.[0]?.version === 1);
    assert.equal(events.at(-1)[0].record.amount, 12.5);
    await storeTwo.save(record({ note: 'Spouse edit' }), 1, 'two');
    await assert.rejects(storeOne.save(record({ note: 'Stale edit' }), 1, 'one'), { code: 'conflict' });
    await assert.rejects(storeOne.remove('tx_test', 1, 'one'), { code: 'conflict' });
    assert.equal((await getDoc(doc(dbOne, 'entries/tx_test'))).data().note, 'Spouse edit');
    await storeOne.remove('tx_test', 2, 'one');
    await wait(() => events.at(-1)?.length === 0);
    await assert.rejects(storeTwo.save(record(), 2, 'two'), { code: 'conflict' });
    assert.deepEqual(await storeTwo.merge([record()], 'two'), { created: 0, skipped: 0, conflicts: 1 });
    await assertFails(updateDoc(doc(dbOne, 'entries/tx_test'), { deleted: false, version: 4, updatedAt: serverTimestamp(), updatedBy: 'one' }));
  } finally { stop(); }
});
test('transaction imports are idempotent and preserve conflicting shared entries', async () => {
  const db = dbFor('one'), store = createRecordStore(db, () => 'one');
  assert.deepEqual(await store.merge([record()], 'one'), { created: 1, skipped: 0, conflicts: 0 });
  assert.deepEqual(await store.merge([record()], 'one'), { created: 0, skipped: 1, conflicts: 0 });
  assert.deepEqual(await store.merge([record({ amount: 99 }), record({ id: 'tx_new' })], 'one'), { created: 1, skipped: 0, conflicts: 1 });
  assert.equal((await getDoc(doc(db, 'entries/tx_test'))).data().amountMinor, 1250);
});
