// Storage layout in storage.local (browser.* in Firefox, chrome.* in Chrome):
//   m:<id>  message     c:<id>  channel/thread meta     e:<ts>-<n>  coverage event
//   trays   [{ id, name, all, ids, seen, readAt }] what the viewer shows; capture = union of all trays (DMs never)
//   lastSignal          last time the hook was heard from
//   schema              bumped when the layout changes; a mismatch wipes everything (prototype, no migrations)
const SCHEMA = 2;
const api = globalThis.browser ?? chrome; // Firefox: browser, Chrome: chrome (both promise-based in MV3)
const store = api.storage.local;
let n = 0;

const init = async () => {
  if ((await store.get('schema')).schema === SCHEMA) return;
  await store.clear();
  await store.set({ schema: SCHEMA, trays: [{ id: 'all', name: 'Todo', all: true, ids: [], seen: [], readAt: 0 }] });
};
let queue = init();

const log = (type, extra = {}) => store.set({ [`e:${Date.now()}-${n++}`]: { type, at: Date.now(), ...extra } });
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function allowed(trays, m) {
  if (trays.some((t) => t.all)) return true;
  const ids = new Set(trays.flatMap((t) => t.ids));
  if (ids.has(m.channel_id)) return true;
  const key = `c:${m.channel_id}`;
  return ids.has((await store.get(key))[key]?.parent_id); // threads inherit their parent channel
}

async function handle({ kind, data }) {
  const { trays = [], lastSignal = 0 } = await store.get(['trays', 'lastSignal']);
  const now = Date.now();
  switch (kind) {
    case 'ready':
      await (lastSignal ? log('gap', { from: lastSignal, to: now }) : log('start'));
      break;
    case 'resumed':
      await log('resumed');
      break;
    case 'channels':
      await store.set(Object.fromEntries(data.map((c) => [`c:${c.id}`, c])));
      break;
    case 'message':
    case 'delete': {
      if (!data.guild_id || !(await allowed(trays, data))) break;
      const key = `m:${data.id}`;
      const old = (await store.get(key))[key];
      if (kind === 'delete') {
        if (old) await store.set({ [key]: { ...old, deleted_at: now } }); // keep the text
      } else {
        await store.set({ [key]: { ...old, ...defined(data), captured_at: old?.captured_at ?? now } });
      }
      break;
    }
  }
  await store.set({ lastSignal: now });
}

// Serialized: 'ready' must read lastSignal before 'alive' overwrites it.
api.runtime.onMessage.addListener((msg) => {
  queue = queue.then(() => handle(msg)).catch((e) => console.error('[discord-feed]', e));
});

api.action.onClicked.addListener(() => api.tabs.create({ url: 'viewer.html' }));
