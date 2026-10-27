// Minimal asynchronous IndexedDB subset used by db.js. No browser or test dependencies.
export function fakeIndexedDB() {
  const stores = new Map();
  const database = {
    createObjectStore(name, options) {
      const store = { records: new Map(), options, indexes: new Map(), next: 1 };
      stores.set(name, store);
      return { createIndex: (index, key) => store.indexes.set(index, key) };
    },
    transaction(names, mode) {
      const tx = { pending: 0, aborted: false };
      const complete = () => setImmediate(() => { if (!tx.pending && !tx.aborted) tx.oncomplete?.(); });
      const request = (work) => {
        tx.pending++;
        const req = {};
        setImmediate(() => {
          if (tx.aborted) return;
          try {
            req.result = work();
            req.onsuccess?.({ target: req });
          } catch (error) {
            req.error = tx.error = error;
            tx.aborted = true;
            req.onerror?.({ target: req }); tx.onerror?.();
          }
          tx.pending--; complete();
        });
        return req;
      };
      tx.abort = () => { tx.aborted = true; tx.onabort?.(); };
      tx.objectStore = (name) => {
        if (!names.includes(name)) throw new Error('Store outside transaction');
        const store = stores.get(name);
        const write = (work) => {
          if (mode !== 'readwrite') throw new Error('Read-only transaction');
          return request(work);
        };
        const compare = (a, b) => {
          if (Array.isArray(a) && Array.isArray(b)) {
            for (let i = 0; i < Math.min(a.length, b.length); i++) { const order = compare(a[i], b[i]); if (order) return order; }
            return a.length - b.length;
          }
          return a < b ? -1 : a > b ? 1 : 0;
        };
        const inRange = (key, range) => !range || (
          (range.lower === undefined || compare(key, range.lower) > 0 || (!range.lowerOpen && compare(key, range.lower) === 0))
          && (range.upper === undefined || compare(key, range.upper) < 0 || (!range.upperOpen && compare(key, range.upper) === 0)));
        const indexKey = (value, path) => Array.isArray(path) ? path.map((key) => value[key]) : value[path];
        const validKey = (key) => Array.isArray(key) ? key.every(validKey) : key !== undefined && key !== null && !(typeof key === 'number' && Number.isNaN(key));
        const source = (index) => {
          const rows = (range, direction) => {
            let list = [...store.records.entries()]
              .map(([primaryKey, value]) => ({ primaryKey, value, key: index ? indexKey(value, store.indexes.get(index)) : primaryKey }))
              .filter(({ key }) => validKey(key) && inRange(key, range))
              .sort((a, b) => compare(a.key, b.key) || compare(a.primaryKey, b.primaryKey));
            if (direction === 'prev') list.reverse();
            if (direction === 'nextunique') list = list.filter((row, i) => !i || compare(row.key, list[i - 1].key) !== 0);
            return list;
          };
          return {
            getAll: (range) => request(() => rows(range).map(({ value }) => structuredClone(value))),
            getAllKeys: (range) => request(() => rows(range).map(({ primaryKey }) => primaryKey)),
            count: (range) => request(() => rows(range).length),
            openKeyCursor(range, direction) { return this.openCursor(range, direction, true); },
            openCursor(range, direction, keyOnly = false) {
              const list = rows(range, direction);
              let position = 0;
              const req = {};
              const next = () => {
                const pending = request(() => {
                  const row = list[position++];
                  if (!row) return null;
                  return {
                    key: structuredClone(row.key), primaryKey: row.primaryKey,
                    ...(keyOnly ? {} : { value: structuredClone(row.value) }),
                    continue: next,
                    delete: () => write(() => store.records.delete(row.primaryKey)),
                  };
                });
                pending.onsuccess = () => { req.result = pending.result; req.onsuccess?.({ target: req }); };
              };
              next(); return req;
            },
          };
        };
        return {
          ...source(),
          index: (index) => {
            if (!store.indexes.has(index)) throw new Error('Unknown index');
            return source(index);
          },
          get: (key) => request(() => structuredClone(store.records.get(key))),
          clear: () => write(() => store.records.clear()),
          put: (value) => write(() => {
            const key = store.options.keyPath ? value[store.options.keyPath] : store.next++;
            store.records.set(key, structuredClone(value)); return key;
          }),
          add: (value) => write(() => { const key = store.next++; store.records.set(key, structuredClone(value)); return key; }),
        };
      };
      complete(); return tx;
    },
  };
  let initialized = false;
  return {
    indexedDB: { open() {
      const req = {};
      setImmediate(() => {
        req.result = database;
        if (!initialized) { initialized = true; req.onupgradeneeded?.(); }
        req.onsuccess?.();
      });
      return req;
    } },
    IDBKeyRange: {
      lowerBound: (lower) => ({ lower }),
      only: (key) => ({ lower: key, upper: key }),
      bound: (lower, upper, lowerOpen = false, upperOpen = false) => ({ lower, upper, lowerOpen, upperOpen }),
    },
  };
}
