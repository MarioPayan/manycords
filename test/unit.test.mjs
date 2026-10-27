// npm test — runs hook.js + background.js against fake gateway frames.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const data = {};
let onMessage;
const { fakeIndexedDB } = await import('./fake-idb.mjs');
const { i18n } = await import('./i18n.mjs');
const browser = {
  i18n,
  storage: { local: {
    get: async (k) => {
      const keys = k == null ? Object.keys(data) : [].concat(k);
      return Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, structuredClone(data[x])]));
    },
    set: async (o) => Object.assign(data, structuredClone(o)),
    remove: async (keys) => [].concat(keys).forEach((key) => delete data[key]),
    clear: async () => Object.keys(data).forEach((k) => delete data[k]),
  } },
  runtime: { onMessage: { addListener: (f) => (onMessage = f) } },
  action: { onClicked: { addListener() {} } },
};
data['m:old'] = { id: 'old' }; // previous schema: wiped on start
const bg = vm.createContext({ browser, console, Date, ...fakeIndexedDB() }); // no timers: revisions go through the work queue
vm.runInContext(readFileSync('db.js', 'utf8'), bg);
vm.runInContext(readFileSync('background.js', 'utf8'), bg);
const db = vm.runInContext('feedDB', bg);
await vm.runInContext('queue', bg);
assert.ok(!data['m:old'], 'schema change wipes old data');
assert.equal(data.collections[0].all, true, 'demo collection "All" created');
data.consentedAt = Date.now(); // capture is gated on the welcome screen's consent

const page = vm.createContext({
  location: { origin: 'https://discord.com' },
  console,
  window: { postMessage: (m) => onMessage({ kind: m.kind, data: m.data }, { tab: { id: 1 } }) }, // one Discord tab = the leader
});
vm.runInContext(readFileSync('hook.js', 'utf8'), page);
const frame = (o) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(o))})`, page);
// Wait until the background work queue is drained, including work queued by work (revision announcers).
const settle = async () => { let q; do { q = vm.runInContext('queue', bg); await q; } while (q !== vm.runInContext('queue', bg)); };

const msg = (id, ch, content) => ({ op: 0, s: 1, t: 'MESSAGE_CREATE', d: {
  id, channel_id: ch, guild_id: 'g1', content, timestamp: '2026-10-27T10:00:00Z',
  author: { id: 'u1', username: 'ana', global_name: 'Ana' }, attachments: [], embeds: [] } });

// non-gateway JSON passes through untouched
assert.equal(JSON.stringify(frame({ a: 1 })), '{"a":1}');

frame({ op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } });
frame({ op: 0, s: 1, t: 'READY', d: { guilds: [{ id: 'g1', properties: { name: 'Community' },
  channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'off-topic' }], threads: [{ id: 't1', name: 'thread', parent_id: 'c1' }] }] } });
await settle();
assert.equal((await db.get('channels', 'c1')).name, 'general');
assert.equal((await db.get('channels', 't1')).parent_id, 'c1');
assert.equal((await db.events(0)).filter((v) => v.type === 'start').length, 1, 'first READY logs start, not a gap');

// demo collection captures everything
frame(msg('mall', 'c2', 'everything'));
await settle();
assert.ok((await db.get('messages', 'mall')), 'demo collection captures every channel');

// no collections stores nothing
data.collections = [];
frame(msg('m0', 'c1', 'no configuration'));
await settle();
assert.ok(!(await db.get('messages', 'm0')), 'nothing stored until channels are chosen');

// capture = union of collections: c1 and its threads only
data.collections = [{ id: 'a', ids: ['c1'] }, { id: 'b', ids: [] }];
frame(msg('m1', 'c1', 'hello'));
frame(msg('m2', 'c2', 'outside'));
frame(msg('m3', 't1', 'in thread'));
frame({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: 'dm', channel_id: 'x', content: 'private' } });
await settle();
assert.equal((await db.get('messages', 'm1')).content, 'hello');
assert.equal((await db.get('messages', 'm1')).author.name, 'Ana');
assert.ok(!(await db.get('messages', 'm2')), 'channel outside allowlist dropped');
assert.ok((await db.get('messages', 'm3')), 'thread of allowed channel kept');
assert.ok(!(await db.get('messages', 'dm')), 'DMs never stored');

// partial update keeps old fields; delete keeps text
frame({ op: 0, s: 3, t: 'MESSAGE_UPDATE', d: { id: 'm1', channel_id: 'c1', guild_id: 'g1', content: 'hello edited', edited_timestamp: '2026-10-27T10:01:00Z' } });
frame({ op: 0, s: 4, t: 'MESSAGE_DELETE', d: { id: 'm1', channel_id: 'c1', guild_id: 'g1' } });
await settle();
assert.equal((await db.get('messages', 'm1')).content, 'hello edited');
assert.equal((await db.get('messages', 'm1')).author.name, 'Ana');
assert.ok((await db.get('messages', 'm1')).deleted_at);

// resume = no gap; a fresh READY = gap
frame({ op: 0, s: 5, t: 'RESUMED', d: {} });
frame({ op: 0, s: 1, t: 'READY', d: { guilds: [] } });
await settle();
const types = (await db.events(0)).map((event) => event.type);
assert.deepEqual(types, ['start', 'resumed', 'gap']);

console.log('ok');

// ---- threads.js: channel lanes and explicit reply arcs on the original sample ----
{
  const ctx = { module: { exports: {} } };
  vm.runInNewContext(readFileSync('threads.js', 'utf8'), ctx);
  const { assignConversations } = ctx.module.exports;
  const at = (hm) => `2026-10-27T${hm}:00Z`;
  const U = { yazz: 'u1', Tito: 'u2', Kira: 'u3', Luna: 'u4', Mo: 'u5', Nico: 'u6', Pablo: 'u7' };
  const raw = [
    ['m0', 'g', 'yazz', '13:40', 'Does the new banner rerun Aster?'],
    ['m1', 'g', 'Tito', '13:41', 'I get error 502'],
    ['m2', 'g', 'Kira', '13:42', 'Yes, starting Thursday.', { reply_to: 'm0' }],
    ['m3', 'g', 'Luna', '13:43', 'Anyone forming a co-op team?'],
    ['m4', 'g', 'Mo', '13:43', '@Tito clear the cache', { mentions: ['u2'] }],
    ['m5', 'th', 'Nico', '13:44', 'Tested 0.4.2 on Windows'],
    ['m6', 'g', 'yazz', '13:44', 'Finally'],
    ['m7', 'g', 'Pablo', '13:45', 'I will heal', { reply_to: 'm3' }],
    ['m8', 'g', 'Tito', '13:46', 'That worked, thanks.'],
    ['m9', 'g', 'Kira', '13:47', 'The rerun lasts only 7 days.'],
    ['m10', 'th', 'Luna', '13:48', 'Also on Linux'],
    ['m11', 'g', 'Luna', '13:49', 'Ready, we have four.'],
    ['m12', 'g', 'Mo', '13:50', 'Does it include a weapon?', { reply_to: 'm9' }],
    ['m13', 'g', 'yazz', '14:10', 'Another topic: anyone see the stream?'], // Later messages stay in the same channel lane, regardless of silence
  ].map(([id, ch, who, t, content, extra]) => ({ id, channel_id: ch, author: { id: U[who] }, timestamp: at(t), content, ...extra }));
  const { convOf, convs, replies } = assignConversations(raw, { isThread: (c) => c === 'th', threadName: () => 'Build 0.4.2', parentId: () => 'g' });
  const same = (...ids) => ids.every((id) => convOf.get(id) === convOf.get(ids[0]));
  assert.ok(same('m0', 'm2', 'm6', 'm9', 'm12'), 'replies and follow-ups stay in their channel lane');
  assert.ok(same('m1', 'm4', 'm8'), 'mentions and author follow-ups stay in their channel lane');
  assert.ok(same('m3', 'm7', 'm11'), 'reply context does not split a channel');
  assert.ok(same('m5', 'm10'), 'Discord thread has its own lane');
  assert.equal(convs.get(convOf.get('m5')).title, 'Build 0.4.2');
  assert.ok(same('m0', 'm1', 'm3') && !same('m0', 'm5'), 'concurrent channel topics share a lane; Discord threads remain separate');
  assert.ok(same('m0', 'm13'), 'silence never splits a channel lane');
  assert.equal(convs.size, 2);
  assert.equal(convs.get('th').parent_id, 'g', 'thread branches from its parent channel');
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [{ from: 'm0', to: 'm2' }, { from: 'm3', to: 'm7' }, { from: 'm9', to: 'm12' }], 'only explicit replies create secondary arcs');
  console.log('threads ok');
}

// Revisions go through the work queue after committed writes; a burst queued together broadcasts once.
await settle();
const revBefore = data.rev;
assert.ok(revBefore > 0, 'earlier committed writes broadcast revisions');
for (const name of ['general-a', 'general-b', 'general-c']) frame({ op: 0, s: 9, t: 'CHANNEL_UPDATE', d: { id: 'c2', name, guild_id: 'g1' } });
await settle();
assert.equal(data.rev, revBefore + 1, 'committed burst broadcasts one revision');
const capturedAt = (await db.get('messages', 'm3')).captured_at;
frame(msg('m3', 't1', 'in thread'));
await settle();
assert.equal((await db.get('messages', 'm3')).captured_at, capturedAt, 'dedupe keeps the original capture time');
assert.equal((await db.recent({ all: true, ids: [] }, {}, 100)).filter((m) => m.id === 'm3').length, 1, 'dedupe stores a single record');
assert.equal(data.rev, revBefore + 2, 'later writes advance the revision');

// Indexed queries cap the active collection while sidebar counts cover its complete history.
await db.putChannels([{ id: 'thread', type: 11, parent_id: 'chosen', guild_id: 'g' }]);
const channels = Object.fromEntries((await db.channels()).map((c) => [c.id, c]));
const chosen = { id: 'chosen', ids: ['chosen'], readAt: Date.parse('2026-01-01T00:03:00Z') };
for (let i = 0; i < 8; i++) await db.writeMessage({ id: `history${i}`, channel_id: i % 2 ? 'thread' : 'chosen', guild_id: 'g', timestamp: `2026-01-01T00:0${i}:00Z`, content: 'History' });
const recent = await db.recent(chosen, channels, 3);
assert.deepEqual(Array.from(recent, (m) => m.id), ['history7', 'history6', 'history5'], 'latest timestamps, including inherited threads');
assert.equal((await db.recent({ ids: [], all: false }, channels, 3)).length, 0, 'empty collection queries no messages');
assert.equal((await db.recent(null, channels, 3)).length, 0, 'no active collection queries no messages');
const overview = await db.overview([chosen], channels, Date.now());
assert.equal(overview.stats.chosen.total, 8);
assert.equal(overview.stats.chosen.unread, 4, 'readAt is exclusive');
assert.equal(overview.stats.chosen.guilds.g, 4);
assert.equal(overview.buckets.reduce((sum, count) => sum + count, 0), 11, 'coverage uses capture time across all collections');
assert.equal(await db.outside([chosen], channels), 3, 'cleanup counts historical records outside the active collection');
assert.equal(await db.outside([chosen], channels, true), 3);
assert.equal((await db.recent({ all: true }, channels, 100)).length, 8, 'cleanup retains selected parent and thread messages');
const beforeDelete = (await db.recent({ all: true }, channels, 100)).length;
assert.equal(await db.writeMessage({ id: 'unknown' }, Date.now()), false, 'unknown delete creates no message');
assert.equal((await db.recent({ all: true }, channels, 100)).length, beforeDelete);
const events = await db.events(0);
assert.equal((await db.events(events.at(-1).at + 1)).length, 0, 'event index applies its lower bound');
await onMessage({ kind: 'wipe' }); await settle();
assert.equal((await db.recent({ all: true }, channels, 100)).length, 0, 'wipe clears all messages');
assert.equal((await db.events(0)).length, 0, 'wipe clears coverage events');
assert.ok((await db.channels()).length, 'wipe preserves channel metadata');
assert.ok(data.collections.length, 'wipe preserves collections');
assert.equal(data.lastSignal, undefined, 'wipe resets capture status');
await db.writeMessage({ id: 'stale', channel_id: 'chosen' });
await db.event({ at: 1, type: 'start' });
data.schema = -1;
await vm.runInContext('init()', bg);
assert.equal(await db.get('messages', 'stale'), undefined, 'schema reset clears IndexedDB messages');
assert.equal((await db.channels()).length, 0, 'schema reset clears IndexedDB channels');
assert.equal((await db.events(0)).length, 0, 'schema reset clears IndexedDB events');
assert.equal(data.schema, 3);

// Numeric unread index respects equal instants written in different ISO timestamp forms.
await db.putChannels([{ id: 'offset', guild_id: 'g' }]);
await db.writeMessage({ id: 'equal', channel_id: 'offset', guild_id: 'g', timestamp: '2026-01-01T01:00:00+01:00' });
await db.writeMessage({ id: 'newer', channel_id: 'offset', guild_id: 'g', timestamp: '2026-01-01T00:00:00.001Z' });
const offsetStats = await db.overview([{ id: 'offset', ids: ['offset'], readAt: Date.parse('2026-01-01T00:00:00Z') }], { offset: { guild_id: 'g' } }, Date.now());
assert.equal(offsetStats.stats.offset.total, 2);
assert.equal(offsetStats.stats.offset.unread, 1, 'equal instant is read regardless of timezone notation');
const grouping = vm.runInNewContext(`${readFileSync('threads.js', 'utf8')}; assignConversations([{ id: 'empty', channel_id: 'c', timestamp: '2026-01-01T00:00:00Z', content: '' }], { noText: 'No text' })`);
assert.equal(grouping.convs.get('c').title, i18n.getMessage('noText'), 'pure grouping accepts the viewer’s localized empty title');
