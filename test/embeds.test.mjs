// Embed capture: hook.js sanitizes each embed; background.js and db.js merge unfurls that arrive in updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fakeIndexedDB } from './fake-idb.mjs';
import { i18n } from './i18n.mjs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const base = { id: 'e1', channel_id: 'c1', guild_id: 'g1', content: 'look https://example.org/post',
  timestamp: '2026-10-27T10:00:00Z', author: { id: 'u1', username: 'ana' } };

function hook(post = () => {}) {
  const sent = [];
  const context = vm.createContext({ console, URL, location: { origin: 'https://discord.com' },
    window: { postMessage: (value) => { sent.push(plain(value)); post(value); } } });
  vm.runInContext(read('hook.js'), context);
  const frame = (t, d, s = 1) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ op: 0, s, t, d }))})`, context);
  const picked = (d) => { frame('MESSAGE_CREATE', d); return sent.filter((item) => item.kind === 'message').at(-1).data; };
  return { sent, frame, picked };
}

const rich = {
  type: 'rich', url: 'https://example.org/post', title: 'A post', description: 'Some **bold** text', color: 0x5865f2,
  timestamp: '2026-10-27T10:00:00Z', reference_id: 'x', content_scan_version: 1,
  author: { name: 'Example', url: 'https://example.org/me', icon_url: 'https://example.org/me.png', proxy_icon_url: 'https://images-ext-1.discordapp.net/a.png' },
  provider: { name: 'Example Site', url: 'https://example.org' },
  footer: { text: 'Footer', icon_url: 'https://example.org/f.png', proxy_icon_url: 'https://images-ext-2.discordapp.net/f.png' },
  fields: [{ name: 'A', value: '1', inline: true, extra: 'no' }],
  image: { url: 'https://example.org/full.png', proxy_url: 'https://images-ext-1.discordapp.net/external/abc/https/example.org/full.png', width: 1200, height: 600, flags: 0, placeholder: 'xyz' },
  thumbnail: { url: 'https://example.org/t.png', proxy_url: 'https://media.discordapp.net/attachments/1/2/t.png', width: 80, height: 80 },
  video: { url: 'https://example.org/v.mp4', proxy_url: 'https://cdn.discordapp.com/v.mp4', width: 640, height: 360, placeholder: 'p' },
};

test('embed sanitizer keeps only the drawn fields and drops icons and raw image urls', () => {
  const [embed] = hook().picked({ ...base, embeds: [rich] }).embeds;
  assert.deepEqual(embed, {
    type: 'rich', url: 'https://example.org/post', title: 'A post', description: 'Some **bold** text', color: 0x5865f2,
    author: { name: 'Example', url: 'https://example.org/me' }, provider: { name: 'Example Site' }, footer: { text: 'Footer' },
    fields: [{ name: 'A', value: '1', inline: true }],
    image: { proxy_url: 'https://images-ext-1.discordapp.net/external/abc/https/example.org/full.png', width: 1200, height: 600 },
    thumbnail: { proxy_url: 'https://media.discordapp.net/attachments/1/2/t.png', width: 80, height: 80 },
    video: { proxy_url: 'https://cdn.discordapp.com/v.mp4', url: 'https://example.org/v.mp4', width: 640, height: 360 },
  });
  assert.doesNotMatch(JSON.stringify(embed), /icon_url|"https:\/\/example\.org\/(?:full|t)\.png"|placeholder|reference_id/);
});

test('embed sanitizer rejects non-Discord image hosts, lookalikes, http and unsafe links', () => {
  const page = hook();
  for (const proxy_url of ['https://evil.example/a.png', 'http://media.discordapp.net/a.png', 'https://media.discordapp.net.evil.example/a.png',
    'https://evil.example/media.discordapp.net/a.png', 'https://user@evil.example/a.png', 'not a url', 'javascript:alert(1)']) {
    const [embed] = page.picked({ ...base, embeds: [{ type: 'image', url: 'https://evil.example/a.png', image: { url: 'https://evil.example/a.png', proxy_url }, thumbnail: { proxy_url } }] }).embeds;
    assert.equal(embed.image, undefined, proxy_url);
    assert.equal(embed.thumbnail, undefined, proxy_url);
  }
  const [video] = page.picked({ ...base, embeds: [{ type: 'video', url: 'javascript:alert(1)', video: { url: 'https://www.youtube.com/embed/x', proxy_url: 'https://evil.example/v.mp4' }, author: { name: 'A', url: 'data:text/html,x' } }] }).embeds;
  assert.deepEqual(video, { type: 'video', author: { name: 'A' }, video: { url: 'https://www.youtube.com/embed/x' } }, 'a video keeps only its link; unsafe urls go');
  const [colors] = page.picked({ ...base, embeds: [{ title: 'x', color: -1 }] }).embeds;
  assert.equal(colors.color, undefined);
});

test('embed sanitizer caps lengths and counts', () => {
  const embeds = Array.from({ length: 12 }, (_, i) => ({ title: 'T'.repeat(300), description: 'D'.repeat(5000), footer: { text: 'F'.repeat(3000) },
    fields: Array.from({ length: 15 }, () => ({ name: 'N'.repeat(300), value: 'V'.repeat(2000) })), author: { name: `A${i}`.repeat(200) } }));
  const picked = hook().picked({ ...base, embeds }).embeds;
  assert.equal(picked.length, 10);
  assert.equal(picked[0].title.length, 256);
  assert.equal(picked[0].description.length, 2000);
  assert.equal(picked[0].footer.text.length, 2048);
  assert.equal(picked[0].author.name.length, 256);
  assert.equal(picked[0].fields.length, 10);
  assert.equal(picked[0].fields[0].name.length, 256);
  assert.equal(picked[0].fields[0].value.length, 1024);
  assert.equal(picked[0].fields[0].inline, false);
});

test('an unfurl in MESSAGE_UPDATE replaces embeds; an update without the key keeps them', async () => {
  const data = { schema: 3, rev: 0, collections: [{ id: 'all', all: true, ids: [] }] };
  let onMessage;
  const browser = { i18n, runtime: { onMessage: { addListener: (f) => (onMessage = f) }, onInstalled: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { local: {
      get: async (k) => Object.fromEntries((k == null ? Object.keys(data) : [].concat(k)).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
      set: async (o) => Object.assign(data, structuredClone(o)),
      remove: async (keys) => [].concat(keys).forEach((key) => delete data[key]),
      clear: async () => Object.keys(data).forEach((key) => delete data[key]),
    } } };
  const bg = vm.createContext({ browser, console, Date, ...fakeIndexedDB() });
  vm.runInContext(read('db.js'), bg); vm.runInContext(read('background.js'), bg);
  const settle = async () => { let q; do { q = vm.runInContext('queue', bg); await q; } while (q !== vm.runInContext('queue', bg)); };
  await settle();
  data.consentedAt = Date.now();
  const db = vm.runInContext('feedDB', bg);
  const page = hook((m) => onMessage({ kind: m.kind, data: m.data }, { tab: { id: 1 } }));
  page.frame('READY', { guilds: [{ id: 'g1', channels: [{ id: 'c1', name: 'general' }] }] });
  page.frame('MESSAGE_CREATE', { ...base, embeds: [] });
  await settle();
  assert.deepEqual(plain((await db.get('messages', 'e1')).embeds), []);
  // Discord unfurls the link a few seconds later in a partial update.
  page.frame('MESSAGE_UPDATE', { id: 'e1', channel_id: 'c1', guild_id: 'g1', embeds: [rich] }, 2);
  await settle();
  const stored = await db.get('messages', 'e1');
  assert.equal(stored.embeds.length, 1);
  assert.equal(stored.embeds[0].title, 'A post');
  assert.equal(stored.content, base.content, 'the unfurl keeps the text');
  page.frame('MESSAGE_UPDATE', { id: 'e1', channel_id: 'c1', guild_id: 'g1', content: 'edited https://example.org/post', edited_timestamp: '2026-10-27T10:01:00Z' }, 3);
  await settle();
  const edited = await db.get('messages', 'e1');
  assert.equal(edited.content, 'edited https://example.org/post');
  assert.equal(edited.embeds?.[0]?.title, 'A post', 'an update without embeds keeps them');
  page.frame('MESSAGE_UPDATE', { id: 'e1', channel_id: 'c1', guild_id: 'g1', embeds: [], edited_timestamp: '2026-10-27T10:02:00Z' }, 4);
  await settle();
  assert.deepEqual(plain((await db.get('messages', 'e1')).embeds), [], 'suppressed embeds are removed');
});

test('a reply records the original author name for an unloaded quote', () => {
  const picked = hook().picked({ ...base, message_reference: { message_id: 'o1' }, referenced_message: { id: 'o1', content: 'secret text', author: { id: 'u2', username: 'bo', global_name: 'Bo' } } });
  assert.equal(picked.reply_to, 'o1');
  assert.equal(picked.reply_author, 'Bo');
  assert.doesNotMatch(JSON.stringify(picked), /secret text/, 'the original text is not copied');
});
