// Large records live in IndexedDB; small settings and the revision live in storage.local.
// Capture is the union of all collections, excluding DMs. Schema mismatches wipe the prototype.
if (typeof importScripts === 'function') importScripts('db.js');
const SCHEMA = 3;
const api = globalThis.browser ?? chrome;
const store = api.storage.local;

const init = async () => {
  if ((await store.get('schema')).schema === SCHEMA) return;
  await feedDB.reset();
  await store.clear();
  await store.set({ schema: SCHEMA, rev: 0, collections: [{ id: 'all', name: api.i18n.getMessage('allCollection'), all: true, ids: [], seen: [], readAt: 0 }] });
};
let queue = init();
let revisionTimer;
// A fixed trailing window coalesces bursts without starving a continuously active feed.
const changed = () => {
  if (revisionTimer) return;
  revisionTimer = setTimeout(() => {
    queue = queue.then(async () => {
      const { rev = 0 } = await store.get('rev');
      await store.set({ rev: rev + 1 });
    }).catch((error) => console.error('[discord-feed]', error)).finally(() => { revisionTimer = null; });
  }, 500);
};
const log = (type, extra = {}) => feedDB.event({ type, at: Date.now(), ...extra });

async function allowed(collections, message) {
  if (collections.some((c) => c.all || c.ids.includes(message.channel_id))) return true;
  const parent = (await feedDB.get('channels', message.channel_id))?.parent_id;
  return collections.some((c) => c.ids.includes(parent));
}

async function handle({ kind, data }) {
  const { collections = [], lastSignal = 0 } = await store.get(['collections', 'lastSignal']);
  const now = Date.now();
  let wrote = false;
  switch (kind) {
    case 'ready':
      await (lastSignal ? log('gap', { from: lastSignal, to: now }) : log('start'));
      wrote = true;
      break;
    case 'resumed':
      await log('resumed'); wrote = true;
      break;
    case 'channels':
      await feedDB.putChannels(data); wrote = true;
      break;
    case 'message':
    case 'delete':
      if (data.guild_id && await allowed(collections, data)) wrote = await feedDB.writeMessage(data, kind === 'delete' ? now : undefined);
      break;
    case 'clean': {
      const channels = Object.fromEntries((await feedDB.channels()).map((c) => [c.id, c]));
      const count = await feedDB.outside(collections, channels, true);
      if (count) changed();
      return count;
    }
    case 'wipe':
      await feedDB.wipe(); await store.remove('lastSignal'); changed();
      return;
  }
  await store.set({ lastSignal: now });
  if (wrote || kind === 'alive') changed();
}

// Serialized: READY must read lastSignal before ALIVE overwrites it.
api.runtime.onMessage.addListener((message, _sender, respond) => {
  const result = queue.then(() => handle(message));
  queue = result.catch((error) => console.error('[discord-feed]', error));
  result.then((value) => respond?.({ value }), (error) => respond?.({ error: error.message }));
  return true;
});
api.action.onClicked.addListener(() => api.tabs.create({ url: 'viewer.html' }));
