const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

function loadSnapshots(records) {
  const stored = new Map();
  const stores = Object.keys(records);
  const indexedDB = {
    databases: async () => [{ name: 'test', version: 1 }],
    open() {
      const request = {};
      const db = {
        version: 1,
        objectStoreNames: Object.assign(stores, { contains: (name) => stores.includes(name) }),
        close() {},
        transaction() {
          const tx = {
            objectStore(name) {
              const keyPath = name === 'inline' ? 'id' : null;
              return {
                keyPath,
                openCursor() {
                  const cursor = {};
                  const entries = records[name].values();
                  function next() {
                    const { value } = entries.next();
                    cursor.onsuccess({ target: { result: value && { ...value, continue: next } } });
                  }
                  queueMicrotask(next);
                  return cursor;
                },
                clear() { stored.set(name, []); },
                put(value, ...key) {
                  if (keyPath) assert.equal(key.length, 0, 'inline keys must not be passed to put');
                  stored.get(name).push({ key: keyPath ? value.id : key[0], value });
                }
              };
            }
          };
          queueMicrotask(() => tx.oncomplete?.());
          return tx;
        }
      };
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess();
      });
      return request;
    }
  };
  const chrome = { runtime: { onMessage: { addListener() {} } } };
  const storage = { length: 0, clear() {} };
  const source = readFileSync(join(__dirname, 'background.js'), 'utf8');
  const snapshots = new Function('chrome', 'location', 'localStorage', 'sessionStorage', 'indexedDB',
    `${source}\nreturn { captureStorageSnapshot, restoreStorageSnapshot };`)(chrome, {}, storage, storage, indexedDB);
  return { ...snapshots, stored };
}

test('binary IndexedDB records round-trip through extension JSON storage', async () => {
  const bytes = Uint8Array.of(0, 1, 128, 255);
  const key = bytes.buffer;
  const value = {
    view: new DataView(key, 1, 2),
    typed: bytes.subarray(1, 3),
    literal: '~cas:ArrayBuffer:abcd'
  };
  const inline = { id: 7, content: { key, at: new Date(0), count: 123n } };
  const { captureStorageSnapshot, restoreStorageSnapshot, stored } = loadSnapshots({
    external: [{ key, value }],
    inline: [{ key: inline.id, value: inline }]
  });
  const capture = await captureStorageSnapshot();
  assert.equal(capture.ok, true, capture.error);
  const snapshot = JSON.parse(JSON.stringify(capture.snapshot, (_, value) => {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) throw new Error('Binary data reached extension storage');
    return value;
  }));
  const restore = await restoreStorageSnapshot(snapshot);
  assert.equal(restore.ok, true, restore.error);
  assert.deepEqual(stored.get('external'), [{ key, value: { ...value, view: new DataView(Uint8Array.of(1, 128).buffer), typed: Uint8Array.of(1, 128) } }]);
  assert.deepEqual(stored.get('inline'), [{ key: inline.id, value: inline }]);
});

test('legacy IndexedDB snapshots restore literal strings without decoding', async () => {
  const { restoreStorageSnapshot, stored } = loadSnapshots({ external: [] });
  const records = [{ key: 'legacy', value: '~cas:ArrayBuffer:abcd' }];
  const restore = await restoreStorageSnapshot({ indexedDB: [{ name: 'test', stores: [{ storeName: 'external', records }] }] });
  assert.equal(restore.ok, true, restore.error);
  assert.deepEqual(stored.get('external'), records);
});
