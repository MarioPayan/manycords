// node test.mjs — runs hook.js + background.js against fake gateway frames.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const data = {};
let onMessage, queueDone;
const browser = {
  storage: { local: {
    get: async (k) => {
      const keys = k == null ? Object.keys(data) : [].concat(k);
      return Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, structuredClone(data[x])]));
    },
    set: async (o) => Object.assign(data, structuredClone(o)),
    clear: async () => Object.keys(data).forEach((k) => delete data[k]),
  } },
  runtime: { onMessage: { addListener: (f) => (onMessage = f) } },
  action: { onClicked: { addListener() {} } },
};
data['m:old'] = { id: 'old' }; // previous schema: wiped on start
vm.runInNewContext(readFileSync('background.js', 'utf8'), { browser, console, Date });
await new Promise((r) => setTimeout(r, 20));
assert.ok(!data['m:old'], 'schema change wipes old data');
assert.equal(data.trays[0].all, true, 'demo tray "Todo" created');

const page = vm.createContext({
  location: { origin: 'https://discord.com' },
  console,
  window: { postMessage: (m) => onMessage({ kind: m.kind, data: m.data }) },
});
vm.runInContext(readFileSync('hook.js', 'utf8'), page);
const frame = (o) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(o))})`, page);
const settle = () => new Promise((r) => setTimeout(r, 20));

const msg = (id, ch, content) => ({ op: 0, s: 1, t: 'MESSAGE_CREATE', d: {
  id, channel_id: ch, guild_id: 'g1', content, timestamp: '2026-10-27T10:00:00Z',
  author: { id: 'u1', username: 'ana', global_name: 'Ana' }, attachments: [], embeds: [] } });

// non-gateway JSON passes through untouched
assert.equal(JSON.stringify(frame({ a: 1 })), '{"a":1}');

frame({ op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } });
frame({ op: 0, s: 1, t: 'READY', d: { guilds: [{ id: 'g1', properties: { name: 'Comunidad' },
  channels: [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'off-topic' }], threads: [{ id: 't1', name: 'hilo', parent_id: 'c1' }] }] } });
await settle();
assert.equal(data['c:c1'].name, 'general');
assert.equal(data['c:t1'].parent_id, 'c1');
assert.equal(Object.values(data).filter((v) => v?.type === 'start').length, 1, 'first READY logs start, not a gap');

// demo tray captures everything
frame(msg('mall', 'c2', 'todo'));
await settle();
assert.ok(data['m:mall'], 'demo tray captures every channel');

// no trays stores nothing
data.trays = [];
frame(msg('m0', 'c1', 'sin config'));
await settle();
assert.ok(!data['m:m0'], 'nothing stored until channels are chosen');

// capture = union of trays: c1 and its threads only
data.trays = [{ id: 'a', ids: ['c1'] }, { id: 'b', ids: [] }];
frame(msg('m1', 'c1', 'hola'));
frame(msg('m2', 'c2', 'fuera'));
frame(msg('m3', 't1', 'en hilo'));
frame({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: 'dm', channel_id: 'x', content: 'privado' } });
await settle();
assert.equal(data['m:m1'].content, 'hola');
assert.equal(data['m:m1'].author.name, 'Ana');
assert.ok(!data['m:m2'], 'channel outside allowlist dropped');
assert.ok(data['m:m3'], 'thread of allowed channel kept');
assert.ok(!data['m:dm'], 'DMs never stored');

// partial update keeps old fields; delete keeps text
frame({ op: 0, s: 3, t: 'MESSAGE_UPDATE', d: { id: 'm1', channel_id: 'c1', guild_id: 'g1', content: 'hola editado', edited_timestamp: '2026-10-27T10:01:00Z' } });
frame({ op: 0, s: 4, t: 'MESSAGE_DELETE', d: { id: 'm1', channel_id: 'c1', guild_id: 'g1' } });
await settle();
assert.equal(data['m:m1'].content, 'hola editado');
assert.equal(data['m:m1'].author.name, 'Ana');
assert.ok(data['m:m1'].deleted_at);

// resume = no gap; a fresh READY = gap
frame({ op: 0, s: 5, t: 'RESUMED', d: {} });
frame({ op: 0, s: 1, t: 'READY', d: { guilds: [] } });
await settle();
const types = Object.keys(data).filter((k) => k.startsWith('e:')).sort().map((k) => data[k].type);
assert.deepEqual(types, ['start', 'resumed', 'gap']);

console.log('ok');

// ---- threads.js: the four conversation rules on the sample from design/threads.html ----
{
  const ctx = { module: { exports: {} } };
  vm.runInNewContext(readFileSync('threads.js', 'utf8'), ctx);
  const { assignConversations } = ctx.module.exports;
  const at = (hm) => `2026-10-27T${hm}:00Z`;
  const U = { yazz: 'u1', Tito: 'u2', Kira: 'u3', Luna: 'u4', Mo: 'u5', Nico: 'u6', Pablo: 'u7' };
  const raw = [
    ['m0', 'g', 'yazz', '13:40', '¿El banner nuevo trae rerun de Aster?'],
    ['m1', 'g', 'Tito', '13:41', 'Me sale error 502'],
    ['m2', 'g', 'Kira', '13:42', 'Sí, a partir del jueves.', { reply_to: 'm0' }],
    ['m3', 'g', 'Luna', '13:43', '¿Alguien arma equipo para el coop?'],
    ['m4', 'g', 'Mo', '13:43', '@Tito borra la caché', { mentions: ['u2'] }],
    ['m5', 'th', 'Nico', '13:44', 'Probé la 0.4.2 en Windows'],
    ['m6', 'g', 'yazz', '13:44', 'Por fin'],
    ['m7', 'g', 'Pablo', '13:45', 'Yo voy de sanador', { reply_to: 'm3' }],
    ['m8', 'g', 'Tito', '13:46', 'Era eso, gracias.'],
    ['m9', 'g', 'Kira', '13:47', 'Ojo: el rerun dura solo 7 días.'],
    ['m10', 'th', 'Luna', '13:48', 'En Linux también'],
    ['m11', 'g', 'Luna', '13:49', 'Listo, somos cuatro.'],
    ['m12', 'g', 'Mo', '13:50', '¿Trae arma propia?', { reply_to: 'm9' }],
    ['m13', 'g', 'yazz', '14:10', 'otra cosa: ¿alguien vio el directo?'], // 26 min later: yazz's old conversation is idle
  ].map(([id, ch, who, t, content, extra]) => ({ id, channel_id: ch, author: { id: U[who] }, timestamp: at(t), content, ...extra }));
  const { convOf, convs } = assignConversations(raw, { isThread: (c) => c === 'th', threadName: () => 'Build 0.4.2' });
  const same = (...ids) => ids.every((id) => convOf.get(id) === convOf.get(ids[0]));
  assert.ok(same('m0', 'm2', 'm6', 'm9', 'm12'), 'rerun conversation: reply + author follow-up');
  assert.ok(same('m1', 'm4', 'm8'), 'login conversation: mention + author follow-up');
  assert.ok(same('m3', 'm7', 'm11'), 'coop conversation: reply + author follow-up');
  assert.ok(same('m5', 'm10'), 'Discord thread is one conversation');
  assert.equal(convs.get(convOf.get('m5')).title, 'Build 0.4.2');
  assert.ok(!same('m0', 'm1') && !same('m0', 'm3') && !same('m1', 'm3'), 'concurrent topics stay apart');
  assert.ok(!same('m0', 'm13'), 'idle conversation is not resumed by a follow-up');
  assert.equal(convs.size, 5);
  console.log('threads ok');
}
