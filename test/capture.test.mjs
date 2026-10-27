import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeIndexedDB } from './fake-idb.mjs';
import { i18n } from './i18n.mjs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const { mergeHistoryRuns, coverGap, isGapCovered, recoveryTargets } = createRequire(import.meta.url)('../gaps.js');
const BASE = Date.parse('2026-10-27T12:00:00Z');
const M = 60e3, DAY = 864e5;
const message = (id, at = BASE, channel_id = 'c') => ({ id, channel_id,
  author: { id: 'u', username: 'Reader' }, timestamp: new Date(at).toISOString(), content: 'Message' });
const plain = (value) => JSON.parse(JSON.stringify(value));

async function harness({ consent = true, initial = {}, indexed = fakeIndexedDB() } = {}) {
  let now = BASE;
  const data = { schema: 3, rev: 0, collections: [{ id: 'all', all: true, ids: [] }],
    ...(consent ? { consentedAt: BASE - 1 } : {}), ...initial };
  const listeners = {}, alarms = [], tabs = [], errors = [], timers = [];
  const listen = (name) => ({ addListener(callback) { listeners[name] = callback; } });
  const browser = {
    i18n,
    storage: { onChanged: listen('storage'), local: {
      get: async (keys) => Object.fromEntries((keys == null ? Object.keys(data) : [].concat(keys))
        .filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
      set: async (values) => Object.assign(data, structuredClone(values)),
      clear: async () => Object.keys(data).forEach((key) => delete data[key]),
      remove: async (keys) => [].concat(keys).forEach((key) => delete data[key]),
    } },
    runtime: { onMessage: listen('message'), onInstalled: listen('installed'), getURL: (path) => `extension://${path}` },
    alarms: { create: async (name, options) => alarms.push({ name, ...options }), onAlarm: listen('alarm') },
    tabs: { create: async (options) => tabs.push(options), onRemoved: listen('removed') },
    action: { onClicked: listen('clicked') },
  };
  const Clock = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const context = vm.createContext({ browser, Date: Clock, ...indexed,
    console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; } });
  for (const file of ['db.js', 'gaps.js', 'background.js']) vm.runInContext(read(file), context);
  const settle = () => vm.runInContext('queue', context);
  await settle();
  const send = async (kind, payload, id = 1) => {
    let response;
    listeners.message({ kind, data: payload }, id == null ? { url: 'extension://viewer.html' } : { tab: { id } }, (value) => { response = value; });
    await settle();
    assert.equal(response?.error, undefined);
    return response?.value;
  };
  return { data, listeners, alarms, tabs, errors, context, timers, indexed,
    db: vm.runInContext('feedDB', context), settle, send,
    advance: (ms) => { now += ms; },
    alarm: async (name = 'capture-health') => { listeners.alarm({ name }); await settle(); },
    page: (id = 1, visible = true, online = true) => send('page', { visible, online }, id),
    close: async (id) => { listeners.removed(id); await settle(); },
    change: async (key, value) => { data[key] = value; listeners.storage({ [key]: { newValue: value } }, 'local'); await settle(); },
  };
}

function hook() {
  const sent = [];
  let now = BASE;
  const Clock = class extends Date { static now() { return now; } };
  const context = vm.createContext({ Date: Clock, console, location: { origin: 'https://discord.com' },
    window: { postMessage: (value) => sent.push(plain(value)) } });
  vm.runInContext(read('hook.js'), context);
  return { sent, advance: (ms) => { now += ms; },
    parse: (value) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context),
    frame: (t, d, op = 0) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ op, s: 1, t, d }))})`, context) };
}

test('consent blocks every capture record; install opens welcome only on install', async () => {
  const h = await harness({ consent: false });
  assert.equal(h.data.health.state, 'not-consented');
  for (const [kind, payload] of [['ready', null], ['channels', [{ id: 'c', guild_id: 'g' }]],
    ['message', { ...message('before'), guild_id: 'g' }], ['history', [message('history')]], ['resumed', null]]) await h.send(kind, payload);
  assert.deepEqual(plain(await h.db.channels()), []);
  assert.deepEqual(plain(await h.db.events(0)), []);
  assert.equal(await h.db.get('messages', 'before'), undefined);
  assert.equal(h.data.lastSignal, undefined);
  await h.change('consentedAt', BASE);
  await h.page();
  assert.equal(h.data.health.state, 'ok');
  await h.send('channels', [{ id: 'c', guild_id: 'g' }]);
  await h.send('message', { ...message('after'), guild_id: 'g' });
  assert.ok(await h.db.get('messages', 'after'));
  h.listeners.installed({ reason: 'update' });
  assert.equal(h.tabs.length, 0);
  h.listeners.installed({ reason: 'install' });
  assert.deepEqual(plain(h.tabs), [{ url: 'viewer.html#welcome' }]);
  assert.deepEqual(h.errors, []);
});

test('health clock detects missing pages, stalled frames, visibility and offline periods', async () => {
  const h = await harness();
  assert.equal(h.data.health.state, 'no-tab');
  const since = h.data.health.since;
  await h.alarm(); assert.equal(h.data.health.since, since);
  await h.page(); await h.send('alive');
  assert.equal(h.data.health.state, 'ok');
  for (let i = 0; i < 4; i++) { h.advance(M); await h.page(); }
  assert.equal(h.data.health.state, 'ok');
  h.advance(M); await h.page();
  assert.equal(h.data.health.state, 'broken');
  assert.equal(h.data.health.detail.frameMinutes, 5);
  await h.send('alive'); assert.equal(h.data.health.state, 'ok');
  for (let i = 0; i < 6; i++) { h.advance(M); await h.page(1, false); }
  assert.equal(h.data.health.state, 'ok');
  for (let i = 0; i < 6; i++) { h.advance(M); await h.page(1, true, false); }
  assert.equal(h.data.health.state, 'ok');
  await h.page();
  for (let i = 0; i < 5; i++) { h.advance(M); await h.page(); }
  assert.equal(h.data.health.state, 'broken');
  h.advance(3 * M); await h.alarm();
  assert.equal(h.data.health.state, 'no-tab');
  assert.equal(h.data.health.detail.tabs, 0);
  assert.ok(h.alarms.some((alarm) => alarm.name === 'capture-health' && alarm.periodInMinutes === 1));
  // A page with no hook evidence at all must also turn broken after five minutes.
  const silent = await harness();
  await silent.page();
  for (let i = 0; i < 5; i++) { silent.advance(M); await silent.page(); }
  assert.equal(silent.data.health.state, 'broken');
});

test('leader election ignores standby capture and promotes on close or missing pings', async () => {
  const h = await harness();
  await h.page(2); await h.page(1); await h.send('ready', null, 1); await h.send('ready', null, 2);
  assert.equal(h.data.health.state, 'multi-tab');
  assert.equal(h.data.health.detail.tabs, 2);
  assert.equal(h.data.health.detail.leaderTabId, 1);
  await h.send('channels', [{ id: 'ignored', guild_id: 'g' }], 2);
  await h.send('message', { ...message('ignored'), guild_id: 'g' }, 2);
  await h.send('history', [message('history')], 2);
  assert.equal(await h.db.get('channels', 'ignored'), undefined);
  assert.equal(await h.db.get('messages', 'ignored'), undefined);
  assert.deepEqual(plain((await h.db.events(0)).map((event) => event.type)), ['start']);
  await h.close(1);
  assert.equal(h.data.health.detail.leaderTabId, 2);
  assert.equal(h.data.health.state, 'ok');
  assert.equal((await h.db.events(0)).filter((event) => event.type === 'gap').length, 1);
  await h.send('message', { ...message('promoted'), guild_id: 'g' }, 2);
  assert.ok(await h.db.get('messages', 'promoted'));
  await h.page(3); await h.send('alive', null, 3);
  for (let i = 0; i < 3; i++) { h.advance(M); await h.page(3); }
  assert.equal(h.data.health.detail.leaderTabId, 3);
  assert.equal(h.data.health.state, 'ok');
  await h.send('message', { ...message('expired'), guild_id: 'g' }, 2);
  assert.equal(await h.db.get('messages', 'expired'), undefined);
  assert.deepEqual(h.errors, []);
});

test('malformed rolling window is exactly the latest fifty creates and over twenty percent', async () => {
  const page = hook();
  const h = await harness();
  await h.page(); await h.send('ready');
  for (let i = 0; i < 50; i++) page.frame('MESSAGE_CREATE', i < 10 ? { channel_id: 'c' } : message(`valid${i}`));
  for (const observation of page.sent.filter((item) => item.kind === 'validation')) await h.send(observation.kind, observation.data);
  assert.equal(h.data.health.detail.malformed, 10);
  assert.equal(h.data.health.state, 'ok');
  // Evict a valid entry after ten malformed entries roll out, then cross the threshold.
  for (let i = 0; i < 21; i++) page.frame('MESSAGE_CREATE', { id: `bad${i}`, channel_id: 'c' });
  const validation = page.sent.filter((item) => item.kind === 'validation').at(-1);
  await h.send('validation', validation.data);
  assert.equal(h.data.health.detail.messages, 50);
  assert.equal(h.data.health.detail.malformed, 21);
  assert.equal(h.data.health.state, 'broken');
  assert.equal(page.sent.filter((item) => item.kind === 'message').length, 40);
  await h.send('validation', { total: 50, malformed: 10 });
  assert.equal(h.data.health.state, 'ok');
  await h.send('validation', { total: 50, malformed: 11 }, 2);
  assert.equal(h.data.health.state, 'ok');
});

test('hook recognizes only message history arrays, picks thumbnails, and keeps alive gateway-only', () => {
  const page = hook();
  for (const value of [[1, 2], [], [{ id: 'c', name: 'general', type: 0 }], [message('valid'), 2], [{ ...message('missing'), author: null }]]) page.parse(value);
  assert.equal(page.sent.length, 0);
  const attachment = { filename: 'image.png', url: 'https://cdn.example/image.png', proxy_url: 'https://proxy.example/image.png',
    content_type: 'image/png', width: 640, height: 480, size: 1234, secret: 'excluded' };
  page.parse([{ ...message('history'), attachments: [attachment] }]);
  assert.equal(page.sent[0].kind, 'history');
  assert.deepEqual(page.sent[0].data[0].attachments, [Object.fromEntries(Object.entries(attachment).filter(([key]) => key !== 'secret'))]);
  assert.ok(!page.sent.some((item) => item.kind === 'alive'));
  page.frame(null, null, 11);
  assert.equal(page.sent.filter((item) => item.kind === 'alive').length, 1);
  page.frame(null, null, 11);
  assert.equal(page.sent.filter((item) => item.kind === 'alive').length, 1);
  page.advance(M); page.frame(null, null, 11);
  assert.equal(page.sent.filter((item) => item.kind === 'alive').length, 2);
});

test('relay sends immediate and sixty-second visibility/online pings', async () => {
  const sent = [], callbacks = {}, window = { addEventListener: (name, callback) => { callbacks[name] = callback; } };
  const document = { visibilityState: 'visible', addEventListener: (name, callback) => { callbacks[name] = callback; } };
  const navigator = { onLine: true };
  let interval;
  vm.runInNewContext(read('relay.js'), { window, document, navigator, console,
    browser: { runtime: { sendMessage: async (payload) => sent.push(plain(payload)) } },
    setInterval: (callback, delay) => { assert.equal(delay, M); interval = callback; } });
  assert.deepEqual(sent, [{ kind: 'page', data: { visible: true, online: true } }]);
  document.visibilityState = 'hidden'; navigator.onLine = false; interval();
  assert.deepEqual(sent.at(-1), { kind: 'page', data: { visible: false, online: false } });
  callbacks.message({ source: window, data: { 'discord-feed': true, kind: 'page', data: {} } });
  assert.equal(sent.length, 2);
  callbacks.message({ source: window, data: { 'discord-feed': true, kind: 'alive' } });
  assert.equal(sent.at(-1).kind, 'alive');
});

test('retention prunes captured_at only, keeps cutoff, defaults to fourteen days and always prunes thirty-day coverage', async () => {
  const h = await harness();
  h.advance(-15 * DAY);
  await h.db.writeMessage(message('old'));
  h.advance(DAY);
  await h.db.writeMessage(message('cutoff', BASE - 100 * DAY));
  h.advance(14 * DAY);
  await h.db.writeMessage({ ...message('fresh', BASE - 100 * DAY), captured_at: BASE });
  await h.db.event({ type: 'gap', at: BASE - 31 * DAY });
  await h.db.event({ type: 'gap', at: BASE - 30 * DAY });
  await h.alarm('capture-retention');
  assert.equal(await h.db.get('messages', 'old'), undefined);
  assert.ok(await h.db.get('messages', 'cutoff'));
  assert.ok(await h.db.get('messages', 'fresh'));
  assert.equal((await h.db.events(0)).length, 1);
  await h.change('retentionDays', 0);
  h.advance(-100 * DAY);
  await h.db.writeMessage(message('forever'));
  h.advance(100 * DAY);
  await h.db.event({ type: 'start', at: BASE - 31 * DAY });
  await h.alarm('capture-retention');
  assert.ok(await h.db.get('messages', 'forever'));
  assert.equal((await h.db.events(0)).length, 1);
  assert.ok(h.alarms.some((alarm) => alarm.name === 'capture-retention' && alarm.periodInMinutes === 360));
  // Startup uses the same real DB, preserving records until retention runs again.
  await h.change('retentionDays', 1);
  h.advance(-2 * DAY);
  await h.db.writeMessage(message('startup'));
  h.advance(2 * DAY);
  const restarted = await harness({ indexed: h.indexed, initial: h.data });
  assert.equal(await restarted.db.get('messages', 'startup'), undefined);
});

test('history inherits guilds and collection/thread selection, retains newer edits and old attachment rows', async () => {
  const h = await harness({ initial: { collections: [{ ids: ['parent'] }] } });
  await h.page(); await h.send('ready');
  await h.send('channels', [{ id: 'parent', guild_id: 'g' }, { id: 'c', guild_id: 'g', parent_id: 'parent' }, { id: 'outside', guild_id: 'g' }]);
  await h.send('history', [message('history'), message('outside', BASE, 'outside'), message('dm', BASE, 'dm')]);
  assert.equal((await h.db.get('messages', 'history')).source, 'history');
  assert.equal((await h.db.get('messages', 'history')).guild_id, 'g');
  assert.equal(await h.db.get('messages', 'outside'), undefined);
  assert.equal(await h.db.get('messages', 'dm'), undefined);
  await h.send('message', { ...message('edit'), guild_id: 'g', content: 'Edited', edited_timestamp: new Date(BASE + M).toISOString(), attachments: [{ filename: 'old.png', url: 'https://cdn.example/old.png' }] });
  await h.send('history', [message('edit')]);
  assert.equal((await h.db.get('messages', 'edit')).content, 'Edited');
  assert.equal((await h.db.get('messages', 'edit')).attachments[0].filename, 'old.png');
  await h.send('history', [{ ...message('edit'), content: 'Newest', edited_timestamp: new Date(BASE + 2 * M).toISOString() }]);
  assert.equal((await h.db.get('messages', 'edit')).content, 'Newest');
  const signal = h.data.lastSignal;
  h.advance(M); await h.send('history', [message('later')]);
  assert.equal(h.data.lastSignal, signal, 'history never pretends a gateway frame arrived');
});

test('gap coverage requires one response or overlapping message-ID runs spanning both boundaries', () => {
  const gap = { type: 'gap', from: BASE - 4 * M, to: BASE - 2 * M };
  let runs = mergeHistoryRuns([], [message('before', BASE - 5 * M), message('middle', BASE - 3 * M)]);
  let covered = coverGap(gap, runs);
  assert.equal(isGapCovered(covered, ['c']), false);
  runs = mergeHistoryRuns(runs, [message('unrelated', BASE - M)]);
  assert.equal(isGapCovered(coverGap(gap, runs), ['c']), false, 'disconnected responses do not prove continuity');
  runs = mergeHistoryRuns(runs, [message('middle', BASE - 3 * M), message('after', BASE - M)]);
  covered = coverGap(gap, runs);
  assert.equal(isGapCovered(covered, ['c']), true);
  assert.equal(isGapCovered(covered, ['c', 'other']), false);
  assert.equal(isGapCovered(covered, []), true);
  assert.equal(gap.covered, undefined, 'helpers do not mutate gap input');
  assert.equal(coverGap(gap, mergeHistoryRuns([], [message('left', gap.from), message('right', gap.to)])).covered.c, true);
  assert.equal(coverGap(gap, mergeHistoryRuns([], [message('left', gap.from), message('right', gap.to, 'other')])).covered.c, undefined);
});

test('recovery targets match selectable server channels, union collections, uncovered IDs and exact synthetic URL', () => {
  const gap = { from: BASE - M, to: BASE, covered: { covered: true } };
  const channels = { c: { id: 'c', guild_id: 'g', type: 0 }, covered: { id: 'covered', guild_id: 'g', type: 5 },
    category: { id: 'category', guild_id: 'g', type: 4 }, thread: { id: 'thread', guild_id: 'g', parent_id: 'c', type: 11 },
    other: { id: 'other', guild_id: 'g2', type: 0 }, dm: { id: 'dm', type: 1 } };
  const expected = { channelId: 'c', guildId: 'g', url: `https://discord.com/channels/g/c/${(BigInt(BASE) - 1420070400000n) << 22n}` };
  assert.deepEqual(recoveryTargets(gap, [{ ids: ['c', 'covered', 'category', 'thread'] }], channels), [expected]);
  assert.equal(recoveryTargets(gap, [{ all: true }, { ids: ['c'] }], channels).length, 2);
  assert.deepEqual(recoveryTargets(gap, [], channels), []);
});

test('background script dependencies are ordered and alarm permission ships for both browsers', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.background.scripts.indexOf('gaps.js') < manifest.background.scripts.indexOf('background.js'));
  for (const browser of ['chrome', 'firefox']) {
    const path = `dist/${browser}/manifest.json`;
    if (existsSync(path)) assert.ok(JSON.parse(read(path)).permissions.includes('alarms'));
  }
});

test('coverage updates preserve the existing out-of-line event key and commit once', async () => {
  // The shared fake omits the optional put(value, key) signature. This focused
  // event-store fixture models it without editing the sibling-owned test helper.
  const rows = new Map([[7, { type: 'gap', at: BASE, from: BASE - M, to: BASE, covered: { previous: true } }]]);
  const database = { transaction(names, mode) {
    assert.deepEqual(Array.from(names), ['events']); assert.equal(mode, 'readwrite');
    const tx = { objectStore(name) {
      assert.equal(name, 'events');
      return {
        put(value, key) { assert.equal(key, 7); rows.set(key, plain(value)); },
        openCursor() {
          const request = {}, entries = [...rows.entries()];
          let position = 0;
          const advance = () => queueMicrotask(() => {
            const row = entries[position++];
            request.result = row ? { primaryKey: row[0], value: structuredClone(row[1]), continue: advance } : null;
            request.onsuccess();
            if (!row) queueMicrotask(() => tx.oncomplete());
          });
          advance(); return request;
        },
      };
    }, abort() { throw new Error('Unexpected abort'); } };
    return tx;
  } };
  const context = vm.createContext({ indexedDB: { open() {
    const request = {};
    queueMicrotask(() => { request.result = database; request.onsuccess(); });
    return request;
  } } });
  vm.runInContext(`${read('gaps.js')}\n${read('db.js')}`, context);
  const db = vm.runInContext('feedDB', context);
  assert.equal(await db.coverGaps([{ channelId: 'c', from: BASE - 2 * M, to: BASE + M }]), 1);
  assert.equal(rows.size, 1);
  assert.deepEqual(rows.get(7).covered, { previous: true, c: true });
  assert.equal(await db.coverGaps([{ channelId: 'c', from: BASE - 2 * M, to: BASE + M }]), 0);
});

test('worker restarts preserve leader election, frame age and health since', async () => {
  const first = await harness();
  await first.page(1); await first.send('ready', null, 1);
  await first.page(2); await first.send('ready', null, 2);
  const since = first.data.health.since;
  const restarted = await harness({ indexed: first.indexed, initial: first.data });
  assert.equal(restarted.data.health.state, 'multi-tab');
  assert.equal(restarted.data.health.since, since);
  assert.equal(restarted.data.health.detail.leaderTabId, 1);
  await restarted.close(1);
  assert.equal(restarted.data.health.detail.leaderTabId, 2);
  assert.deepEqual(restarted.errors, []);
});

test('handshake frames before first READY do not invent a coverage gap', async () => {
  const page = hook(), h = await harness();
  page.frame(null, { heartbeat_interval: 41250 }, 10);
  page.frame('READY', { guilds: [] });
  for (const item of page.sent) await h.send(item.kind, item.data);
  assert.deepEqual(plain((await h.db.events(0)).map((event) => event.type)), ['start']);
});
