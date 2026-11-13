const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
test('GitHub project subpaths use local, deployable assets', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.includes('./assets/app.js'));
  assert.ok(refs.includes('./manifest.webmanifest'));
  for (const ref of refs) {
    if (['./assets/styles.css', './assets/cloud.js'].includes(ref)) continue; // Generated during build.
    assert.ok(fs.existsSync(path.join(root, ref)), ref);
  }
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
});
test('offline worker only handles its own project and only removes its own old caches', async () => {
  const handlers = {};
  const deleted = [], added = [];
  const origin = 'https://example.github.io';
  const scope = origin + '/africa-auto-parts-ledger/';
  const mocks = {
    URL,
    self: {
      registration: { scope }, location: { origin },
      clients: { claim: async () => {} }, skipWaiting: async () => {},
      addEventListener: (name, handler) => { handlers[name] = handler; }
    },
    caches: {
      open: async () => ({ addAll: async files => added.push(...files) }),
      keys: async () => ['other-app-cache', 'export-ledger-/another-project/-old', 'export-ledger-/africa-auto-parts-ledger/-old'],
      delete: async key => { deleted.push(key); },
      match: async request => request.url.endsWith('index.html') ? 'cached-page' : undefined
    },
    fetch: async () => 'network'
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), mocks);
  let waiting;
  handlers.install({ waitUntil: p => { waiting = p; } }); await waiting;
  assert.ok(added.includes('./assets/styles.css'));
  handlers.activate({ waitUntil: p => { waiting = p; } }); await waiting;
  assert.deepEqual(deleted, ['export-ledger-/africa-auto-parts-ledger/-old']);
  let response;
  const event = url => ({ request: { url, method: 'GET' }, respondWith: p => { response = p; } });
  handlers.fetch(event(origin + '/another-project/index.html'));
  assert.equal(response, undefined);
  handlers.fetch(event(scope + 'index.html'));
  assert.equal(await response, 'cached-page');
});
