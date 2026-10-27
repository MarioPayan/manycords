// Shared extension-origin database. Resolve writes only after their transaction commits.
const feedDB = (() => {
  let opening;
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('discord-feed', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const messages = db.createObjectStore('messages', { keyPath: 'id' });
      for (const key of ['channel_id', 'guild_id', 'timestamp']) messages.createIndex(key, key);
      messages.createIndex('channel_time', ['channel_id', 'sort_at']);
      messages.createIndex('captured_at', 'captured_at');
      db.createObjectStore('channels', { keyPath: 'id' }).createIndex('guild_id', 'guild_id');
      db.createObjectStore('events', { autoIncrement: true }).createIndex('at', 'at');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  const transaction = async (names, mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Database transaction failed'));
      try { work(tx, (value) => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  };
  const scan = (source, range, direction, visit) => {
    const request = source.openCursor(range, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && visit(cursor.value, cursor) !== false) cursor.continue();
    };
  };
  const contains = (collection, message, channels) => collection.all || collection.ids.includes(message.channel_id)
    || collection.ids.includes(channels[message.channel_id]?.parent_id);
  return {
    contains,
    reset: () => transaction(['messages', 'channels', 'events'], 'readwrite', (tx) => {
      for (const name of ['messages', 'channels', 'events']) tx.objectStore(name).clear();
    }),
    get: (name, id) => transaction([name], 'readonly', (tx, done) => {
      tx.objectStore(name).get(id).onsuccess = (event) => done(event.target.result);
    }),
    channels: () => transaction(['channels'], 'readonly', (tx, done) => {
      tx.objectStore('channels').getAll().onsuccess = (event) => done(event.target.result);
    }),
    putChannels: (channels) => transaction(['channels'], 'readwrite', (tx) => {
      for (const channel of channels) tx.objectStore('channels').put(channel);
    }),
    event: (event) => transaction(['events'], 'readwrite', (tx) => tx.objectStore('events').add(event)),
    events: (since) => transaction(['events'], 'readonly', (tx, done) => {
      tx.objectStore('events').index('at').getAll(IDBKeyRange.lowerBound(since)).onsuccess = (event) => done(event.target.result);
    }),
    writeMessage: (message, deletedAt) => transaction(['messages'], 'readwrite', (tx, done) => {
      const messages = tx.objectStore('messages');
      messages.get(message.id).onsuccess = ({ target: { result: old } }) => {
        if (deletedAt !== undefined) {
          if (old) messages.put({ ...old, deleted_at: deletedAt }); // keep the text
          done(!!old);
        } else {
          const defined = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
          const value = { ...old, ...defined(message), captured_at: old?.captured_at ?? Date.now() };
          // Numeric index key preserves exact unread boundaries without changing Discord's timestamp text.
          value.sort_at = Date.parse(value.timestamp);
          messages.put(value);
          done(true);
        }
      };
    }),
    recent: (collection, channels, limit) => transaction(['messages'], 'readonly', (tx, done) => {
      const result = [], messages = tx.objectStore('messages');
      done(result);
      if (!collection || limit <= 0) return;
      if (collection.all) {
        scan(messages.index('timestamp'), null, 'prev', (message) => {
          result.push(message);
          return result.length < limit;
        });
        return;
      }
      const ids = new Set([...collection.ids, ...Object.values(channels)
        .filter((c) => collection.ids.includes(c.parent_id)).map((c) => c.id)]);
      if (!ids.size) return;
      // Intersect index keys first: unrelated collections never load their message bodies here.
      const keys = new Set();
      let pending = ids.size;
      for (const id of ids) {
        messages.index('channel_id').getAllKeys(IDBKeyRange.only(id)).onsuccess = (event) => {
          for (const key of event.target.result) keys.add(key);
          if (--pending || !keys.size) return;
          let found = 0;
          const request = messages.index('timestamp').openKeyCursor(null, 'prev');
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (keys.has(cursor.primaryKey)) {
              found++;
              messages.get(cursor.primaryKey).onsuccess = (e) => result.push(e.target.result);
            }
            if (found < limit) cursor.continue();
          };
        };
      }
    }),
    // Index counts cover complete history; only aggregate numbers reach the sidebar.
    overview: (collections, channels, now) => transaction(['messages'], 'readonly', (tx, done) => {
      const stats = Object.fromEntries(collections.map((c) => [c.id, { total: 0, unread: 0, guilds: {} }]));
      const buckets = Array(24).fill(0), H = 3600e3, messages = tx.objectStore('messages');
      done({ stats, buckets });
      for (let i = 0; i < 24; i++) {
        const range = IDBKeyRange.bound(now - (24 - i) * H, now - (23 - i) * H, true, false);
        messages.index('captured_at').count(range).onsuccess = (event) => { buckets[i] = event.target.result; };
      }
      const countChannel = (channel, guild) => {
        messages.index('channel_id').count(IDBKeyRange.only(channel)).onsuccess = (event) => {
          for (const collection of collections) {
            if (!contains(collection, { channel_id: channel }, channels)) continue;
            const s = stats[collection.id];
            s.total += event.target.result;
            s.guilds[guild] ??= 0;
            const range = IDBKeyRange.bound([channel, collection.readAt ?? 0], [channel, Number.MAX_VALUE], true, false);
            messages.index('channel_time').count(range).onsuccess = (e) => {
              s.unread += e.target.result;
              s.guilds[guild] += e.target.result;
            };
          }
        };
      };
      const request = messages.index('channel_id').openKeyCursor(null, 'nextunique');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (channels[cursor.key]?.guild_id) countChannel(cursor.key, channels[cursor.key].guild_id);
        else {
          // Messages can precede channel metadata; one sample supplies the missing guild id.
          const channel = cursor.key;
          messages.get(cursor.primaryKey).onsuccess = (event) => countChannel(channel, event.target.result.guild_id);
        }
        cursor.continue();
      };
    }),
    outside: (collections, channels, remove = false) => transaction(['messages'], remove ? 'readwrite' : 'readonly', (tx, done) => {
      let count = 0;
      done(0);
      scan(tx.objectStore('messages'), null, 'next', (message, cursor) => {
        if (!collections.some((c) => contains(c, message, channels))) { count++; if (remove) cursor.delete(); }
        done(count);
      });
    }),
    wipe: () => transaction(['messages', 'events'], 'readwrite', (tx) => {
      tx.objectStore('messages').clear(); tx.objectStore('events').clear();
    }),
  };
})();
