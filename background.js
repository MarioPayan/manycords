// Viewer contract (storage.local):
// health = { state, since, detail }; since is epoch ms, preserved until state changes.
// State priority: not-consented > no-tab > broken > multi-tab > ok.
// detail = { frameMinutes: number|null, malformed: number, messages: number,
//            tabs: number, leaderTabId: number|null } (all counts are leader-only).
// consentedAt must be a positive epoch-ms number; no capture records precede consent.
// retentionDays defaults to 14; 0 keeps messages forever. Coverage lasts 30 days.
// captureSession persists leader/tab telemetry across MV3 worker suspension; it holds
// no message bodies. lastSignal remains the last accepted leader gateway observation.
// Gap events are { type: 'gap', at, from, to, covered: { [channelId]: true } }.
// selfId is the user's own Discord id from READY (nothing else from READY is kept). keywords (string[]),
// notify (default true) and mineEveryone (default false) configure what concerns the user (mine.js).
if (typeof importScripts === 'function') importScripts('db.js', 'gaps.js', 'mine.js');
const SCHEMA = 3;
const api = globalThis.browser ?? chrome;
const store = api.storage.local;
const PAGE_TIMEOUT = 180e3, FRAME_TIMEOUT = 300e3;
const consented = (value) => Number.isFinite(value) && value > 0;
let session = { leaderId: null, tabs: {}, order: 0 };
let historyRuns = [];

const init = async () => {
  if ((await store.get('schema')).schema === SCHEMA) return;
  await feedDB.reset();
  await store.clear();
  await store.set({ schema: SCHEMA, rev: 0, collections: [{ id: 'all', name: api.i18n.getMessage('allCollection'), all: true, ids: [], seen: [], readAt: 0 }] });
};
// Announce changes through the work queue, not a timer: a setTimeout created while the MV3
// worker is starting can silently never fire (seen in Chromium e2e). A burst of changes
// queues several announcers, but only the first one after a change writes.
let dirty = false;
const changed = () => {
  if (dirty) return;
  dirty = true;
  queue = queue.then(async () => {
    if (!dirty) return;
    dirty = false;
    const { rev = 0 } = await store.get('rev');
    await store.set({ rev: rev + 1 });
  }).catch(report);
};
const report = (error) => console.error('[discord-feed]', error);
const log = (type, extra = {}) => feedDB.event({ type, at: Date.now(), ...extra });
const enqueue = (work) => {
  const result = queue.then(work);
  queue = result.catch(report);
  return result;
};

async function prune() {
  const { retentionDays = 14 } = await store.get('retentionDays');
  const days = Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : 14;
  const counts = await feedDB.prune(days);
  historyRuns = historyRuns.filter((run) => run.to >= Date.now() - 30 * 864e5);
  if (counts.messages || counts.events) changed();
  if (counts.messages) badgeChanged();
}

// Badge: unread messages that concern the user. Coalesced like `changed`; it reads only unread bodies.
const ACCENT = '#5946d2', NOTIFY_WINDOW = 30e3, LIVE_WINDOW = 600e3;
let badgeDirty = false;
const badgeChanged = () => {
  if (badgeDirty) return;
  badgeDirty = true;
  queue = queue.then(async () => {
    if (!badgeDirty) return;
    badgeDirty = false;
    await updateBadge();
  }).catch(report);
};
const mineRules = async () => {
  const { selfId, keywords, mineEveryone } = await store.get(['selfId', 'keywords', 'mineEveryone']);
  return { selfId, keywords: cleanKeywords(keywords), everyone: mineEveryone === true };
};
// A reply's stored original decides only when the capture lacks reply_to_author.
async function mine(message, rules) {
  if (isMine(message, rules)) return true;
  if (!rules.selfId || !message.reply_to || message.reply_to_author !== undefined) return false;
  return isMine(message, { ...rules, original: await feedDB.get('messages', message.reply_to) });
}
async function updateBadge() {
  const rules = await mineRules();
  let count = 0;
  if (rules.selfId || rules.keywords.length || rules.everyone) {
    const { collections = [] } = await store.get('collections');
    const channels = Object.fromEntries((await feedDB.channels()).map((channel) => [channel.id, channel]));
    for (const message of await feedDB.unread(collections, channels)) if (await mine(message, rules)) count++;
  }
  await api.action?.setBadgeBackgroundColor?.({ color: ACCENT });
  await api.action?.setBadgeTextColor?.({ color: '#ffffff' });
  await api.action?.setBadgeText?.({ text: badgeText(count) });
}
// At most one notification per channel per 30 s: later messages in the window are summarised when it closes.
// Window state is in memory only; a suspended worker forgets it and the badge still counts the messages.
const throttle = {};
async function showMine(message, count = 1) {
  const channel = await feedDB.get('channels', message.channel_id);
  const parent = channel?.parent_id ? await feedDB.get('channels', channel.parent_id) : null;
  const name = channel?.name ?? message.channel_id;
  const author = message.author?.name ?? '?';
  const server = channel?.guild_name ?? parent?.guild_name ?? api.i18n.getMessage('server');
  const title = count > 1 ? api.i18n.getMessage('mineCollapsed', [count, name]) : api.i18n.getMessage('mineTitle', [author, name, server]);
  const refs = new Map();
  for (const [, id] of String(message.content ?? '').matchAll(/<#(\d+)>/g)) refs.set(id, (await feedDB.get('channels', id))?.name ?? '');
  const body = count > 1 ? api.i18n.getMessage('mineCollapsedBody', [author, server])
    : plainText(message.content, { user: (id) => id === message.author?.id ? author : api.i18n.getMessage('mention'), channel: (id) => refs.get(id) }) || api.i18n.getMessage('mineNoText');
  // The packaged icon only: notifications never load a remote image.
  await api.notifications?.create(`mine:${message.channel_id}:${message.id}`, { type: 'basic', iconUrl: api.runtime.getURL('icons/icon-128.png'), title, message: body });
}
async function notifyMine(message, now) {
  const state = throttle[message.channel_id];
  if (state && now < state.until) {
    state.pending++; state.last = message;
    await api.alarms?.create('mine-notify', { when: Math.min(...Object.values(throttle).filter((s) => s.pending).map((s) => s.until)) });
    return;
  }
  throttle[message.channel_id] = { until: now + NOTIFY_WINDOW, pending: 0 };
  await showMine(message);
}
async function flushNotifications(now = Date.now()) {
  const { notify } = await store.get('notify');
  for (const [channel, state] of Object.entries(throttle)) {
    if (!state.pending) { if (now >= state.until) delete throttle[channel]; continue; }
    // Chrome may fire an alarm slightly early or late; a second of slack keeps the summary on time.
    if (now + 1e3 < state.until) continue;
    throttle[channel] = { until: now + NOTIFY_WINDOW, pending: 0 };
    if (notify !== false) await showMine(state.last, state.pending);
  }
  const next = Object.values(throttle).filter((s) => s.pending).map((s) => s.until);
  if (next.length) await api.alarms?.create('mine-notify', { when: Math.min(...next) });
}

async function refreshHealth(now = Date.now()) {
  const previousLeader = session.leaderId;
  for (const [id, tab] of Object.entries(session.tabs)) {
    if (now - tab.pageAt >= PAGE_TIMEOUT) delete session.tabs[id];
  }
  if (!session.tabs[session.leaderId]) session.leaderId = null;
  if (session.leaderId === null) {
    const next = Object.values(session.tabs).filter((tab) => tab.eligible).sort((a, b) => a.order - b.order)[0];
    if (next) session.leaderId = next.id;
  }
  const { consentedAt, health, lastSignal } = await store.get(['consentedAt', 'health', 'lastSignal']);
  if (previousLeader !== null && session.leaderId !== null && previousLeader !== session.leaderId && consented(consentedAt) && lastSignal) {
    await log('gap', { from: lastSignal, to: now, covered: {} }); changed();
  }
  const tabs = Object.values(session.tabs);
  const leader = session.tabs[session.leaderId];
  const malformed = leader?.malformed ?? 0, messages = leader?.messages ?? 0;
  const frameBase = leader?.frameAt ?? tabs[0]?.firstAt;
  const frameMinutes = frameBase == null ? null : Math.max(0, now - frameBase) / 60e3;
  const stalled = (leader ? [leader] : tabs).some((tab) => tab.visible && tab.online && tab.activeSince != null
    && now - Math.max(tab.frameAt ?? tab.firstAt, tab.activeSince) >= FRAME_TIMEOUT);
  const broken = (messages > 0 && malformed / messages > 0.2) || stalled;
  const state = !consented(consentedAt) ? 'not-consented' : !tabs.length ? 'no-tab'
    : broken ? 'broken' : tabs.length > 1 ? 'multi-tab' : 'ok';
  await store.set({ captureSession: session, health: { state, since: health?.state === state ? health.since : now,
    detail: { frameMinutes, malformed, messages, tabs: tabs.length, leaderTabId: session.leaderId } } });
}

async function allowed(collections, message) {
  if (collections.some((collection) => collection.all || collection.ids?.includes(message.channel_id))) return true;
  const parent = (await feedDB.get('channels', message.channel_id))?.parent_id;
  return !!parent && collections.some((collection) => collection.ids?.includes(parent));
}

async function handle({ kind, data }, sender = {}) {
  const now = Date.now();
  // Reader commands are extension-origin only; page observations require a tab.
  if (['clean', 'wipe'].includes(kind)) {
    if (sender.url ? !sender.url.startsWith(api.runtime.getURL('')) : sender.tab?.id != null) return;
    badgeChanged();
    if (kind === 'clean') {
      const { collections = [] } = await store.get('collections');
      const channels = Object.fromEntries((await feedDB.channels()).map((channel) => [channel.id, channel]));
      const count = await feedDB.outside(collections, channels, true);
      if (count) changed();
      return count;
    }
    if (kind === 'wipe') {
      await feedDB.wipe(); await store.remove('lastSignal'); historyRuns = []; changed();
    }
    return;
  }
  if (sender.tab?.id == null) return;
  if (!['page', 'ready', 'alive', 'validation', 'resumed', 'channels', 'message', 'delete', 'history'].includes(kind)) return;
  if (Object.values(session.tabs).some((tab) => now - tab.pageAt >= PAGE_TIMEOUT)) await refreshHealth(now);
  const id = sender.tab.id;
  // Only relay pings and gateway liveness may register or renew a tab.
  if (['page', 'ready', 'alive'].includes(kind)) {
    const tab = session.tabs[id] ??= { id, firstAt: now, pageAt: now, order: ++session.order, eligible: false };
    if (kind === 'page') {
      tab.pageAt = now;
      tab.visible = data?.visible === true; tab.online = data?.online === true;
      tab.activeSince = tab.visible && tab.online ? tab.activeSince ?? now : null;
    } else {
      if (!tab.eligible) tab.readySignal = (await store.get('lastSignal')).lastSignal ?? 0;
      tab.eligible = true; tab.frameAt = now;
      if (session.leaderId === null) session.leaderId = id;
    }
  }
  await refreshHealth(now);
  if (kind === 'page' || session.leaderId !== id) return;
  const tab = session.tabs[id];
  if (kind === 'validation') {
    if (Number.isInteger(data?.total) && data.total >= 1 && data.total <= 50
      && Number.isInteger(data.malformed) && data.malformed >= 0 && data.malformed <= data.total) {
      tab.messages = data.total; tab.malformed = data.malformed;
      await refreshHealth(now);
    }
    return;
  }
  const { collections = [], lastSignal = 0, consentedAt } = await store.get(['collections', 'lastSignal', 'consentedAt']);
  if (!consented(consentedAt)) return;
  let wrote = false;
  switch (kind) {
    case 'ready': {
      // Only the account's own id: it tells the reader which mentions and replies are the user's.
      if (typeof data?.self === 'string' && /^\d{1,20}$/.test(data.self)) await store.set({ selfId: data.self });
      const from = tab.readySignal ?? lastSignal;
      await (from ? log('gap', { from, to: now, covered: {} }) : log('start'));
      wrote = true;
      break;
    }
    case 'resumed':
      await log('resumed'); wrote = true;
      break;
    case 'channels':
      await feedDB.putChannels(data); wrote = true;
      break;
    case 'message':
    case 'delete':
    case 'history': {
      const accepted = [], fresh = [];
      for (const item of kind === 'history' ? data : [data]) {
        const channel = await feedDB.get('channels', item.channel_id);
        const message = { ...item, guild_id: item.guild_id ?? channel?.guild_id };
        // Never infer a guild for ordinary gateway DMs.
        if (kind !== 'history' && !item.guild_id) continue;
        if (!message.guild_id || !await allowed(collections, message)) continue;
        if (kind === 'history') message.source = 'history';
        // A live create is a gateway message not stored before, never edited and recent: not history, not an edit.
        const live = kind === 'message' && !message.edited_timestamp && !!message.author
          && Math.abs(now - Date.parse(message.timestamp)) <= LIVE_WINDOW && !await feedDB.get('messages', message.id);
        wrote = await feedDB.writeMessage(message, kind === 'delete' ? now : undefined) || wrote;
        if (live) fresh.push(message);
        if (kind === 'history') accepted.push(message);
      }
      if (accepted.length) {
        historyRuns = mergeHistoryRuns(historyRuns, accepted);
        // Keep overlap evidence for the current response sequence in memory only.
        wrote = !!await feedDB.coverGaps(historyRuns) || wrote;
      }
      if (fresh.length && (await store.get('notify')).notify !== false) {
        const rules = await mineRules();
        for (const message of fresh) if (await mine(message, rules)) await notifyMine(message, now);
      }
      if (wrote) badgeChanged();
      break;
    }
  }
  // History, channel metadata, malformed reports and relay pings are not gateway liveness.
  if (['ready', 'resumed', 'message', 'delete'].includes(kind)) delete tab.readySignal;
  if (['ready', 'alive', 'resumed', 'message', 'delete'].includes(kind)) await store.set({ lastSignal: now, captureSession: session });
  if (wrote || kind === 'alive') changed();
}

let queue = (async () => {
  await init();
  const { captureSession, retentionDays } = await store.get(['captureSession', 'retentionDays']);
  if (retentionDays === undefined) await store.set({ retentionDays: 14 });
  if (captureSession) session = captureSession;
  await prune();
  await refreshHealth();
  await updateBadge();
  // Alarms wake suspended MV3 workers; timers alone cannot enforce these deadlines.
  await api.alarms?.create('capture-health', { periodInMinutes: 1 });
  await api.alarms?.create('capture-retention', { periodInMinutes: 360 });
})();

// Serialized: READY must read lastSignal before ALIVE overwrites it.
api.runtime.onMessage.addListener((message, sender, respond) => {
  const result = enqueue(() => handle(message, sender));
  result.then((value) => respond?.({ value }), (error) => respond?.({ error: error.message }));
  return true;
});
api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'capture-retention') enqueue(prune);
  if (alarm.name === 'capture-health') enqueue(() => refreshHealth());
  if (alarm.name === 'mine-notify') enqueue(() => flushNotifications());
});
api.tabs?.onRemoved?.addListener((id) => enqueue(async () => {
  delete session.tabs[id];
  await refreshHealth();
}));
api.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.consentedAt) enqueue(() => refreshHealth());
  if (changes.retentionDays) enqueue(prune);
  if (['collections', 'selfId', 'keywords', 'mineEveryone'].some((key) => key in changes)) badgeChanged();
});
// Clicking a notification focuses an open reader on the message, or opens one there.
api.notifications?.onClicked.addListener((id) => {
  const [, , message] = id.split(':');
  api.notifications.clear(id);
  if (!message) return;
  api.runtime.sendMessage({ kind: 'reveal', id: message }).catch(() => null).then(async (reply) => {
    if (reply?.tab == null) return api.tabs.create({ url: `viewer.html?m=${encodeURIComponent(message)}` });
    await api.tabs.update(reply.tab, { active: true });
    if (reply.window != null) await api.windows?.update(reply.window, { focused: true });
  }).catch(report);
});
api.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason === 'install') api.tabs.create({ url: 'viewer.html#welcome' });
});
api.action.onClicked.addListener(() => api.tabs.create({ url: 'viewer.html' }));
