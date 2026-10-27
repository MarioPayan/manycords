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
if (typeof importScripts === 'function') importScripts('db.js', 'gaps.js');
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
      const accepted = [];
      for (const item of kind === 'history' ? data : [data]) {
        const channel = await feedDB.get('channels', item.channel_id);
        const message = { ...item, guild_id: item.guild_id ?? channel?.guild_id };
        // Never infer a guild for ordinary gateway DMs.
        if (kind !== 'history' && !item.guild_id) continue;
        if (!message.guild_id || !await allowed(collections, message)) continue;
        if (kind === 'history') message.source = 'history';
        wrote = await feedDB.writeMessage(message, kind === 'delete' ? now : undefined) || wrote;
        if (kind === 'history') accepted.push(message);
      }
      if (accepted.length) {
        historyRuns = mergeHistoryRuns(historyRuns, accepted);
        // Keep overlap evidence for the current response sequence in memory only.
        wrote = !!await feedDB.coverGaps(historyRuns) || wrote;
      }
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
});
api.tabs?.onRemoved?.addListener((id) => enqueue(async () => {
  delete session.tabs[id];
  await refreshHealth();
}));
api.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.consentedAt) enqueue(() => refreshHealth());
  if (changes.retentionDays) enqueue(prune);
});
api.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason === 'install') api.tabs.create({ url: 'viewer.html#welcome' });
});
api.action.onClicked.addListener(() => api.tabs.create({ url: 'viewer.html' }));
