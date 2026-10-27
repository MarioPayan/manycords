// Browser API fixture for the HTTP viewer harness; production db.js still uses real IndexedDB.
window.fixtureReady = (async () => {
  const language = new URLSearchParams(location.search).get('lang') || 'en';
  const messages = await (await fetch(`/_locales/${language}/messages.json`)).json();
  const getMessage = (key, substitutions = []) => {
    const entry = messages[key];
    if (!entry) throw new Error(`Unknown locale key: ${key}`);
    return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name) => {
      const index = Number(entry.placeholders[name.toLowerCase()].content.slice(1)) - 1;
      return [].concat(substitutions)[index] ?? '';
    });
  };
  const now = Date.now(), iso = (minutes) => new Date(now - minutes * 60e3).toISOString();
  const data = { schema: 3, rev: 1, lastSignal: now - 4000, theme: 'system', collections: [
    { id: 'all', name: getMessage('allCollection'), all: true, ids: [], seen: [], readAt: now - 66 * 60e3 },
    { id: 'club', name: 'Game Club', emoji: '⭐', all: false, ids: ['gen', 'anu', 'bld'], seen: ['gen', 'anu', 'bld', 'mem', 'eve'], readAt: now - 66 * 60e3 },
  ] };
  const listeners = [];
  window.browser = {
    i18n: { getMessage, getUILanguage: () => language },
    storage: { local: {
      get: async (keys) => Object.fromEntries((keys == null ? Object.keys(data) : [].concat(keys)).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
      set: async (values) => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) };
          data[key] = structuredClone(value);
        }
        if (Object.keys(changes).length) listeners.forEach((listener) => listener(changes));
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    } },
    runtime: { sendMessage: async ({ kind }) => {
      if (kind === 'wipe') { await feedDB.wipe(); delete data.lastSignal; }
      else if (kind === 'clean') {
        const channels = Object.fromEntries((await feedDB.channels()).map((channel) => [channel.id, channel]));
        await feedDB.outside(data.collections, channels, true);
      } else throw new Error(`Unsupported harness command: ${kind}`);
      await browser.storage.local.set({ rev: data.rev + 1 });
      return {};
    } },
  };
  await feedDB.reset();
  const channel = (id, name, type, parent_id, position, guild_id, guild_name) => ({ id, name, type, parent_id, position, guild_id, guild_name });
  const channels = [
    channel('k1', 'Information', 4, null, 0, 'g1', 'Game Club'), channel('anu', 'announcements', 0, 'k1', 0, 'g1', 'Game Club'),
    channel('k2', 'Chat', 4, null, 1, 'g1', 'Game Club'), channel('gen', 'general', 0, 'k2', 0, 'g1', 'Game Club'),
    channel('mem', 'memes', 0, 'k2', 1, 'g1', 'Game Club'), channel('new1', 'new-channel', 0, 'k2', 2, 'g1', 'Game Club'),
    channel('bld', 'builds', 0, null, 0, 'g2', 'Indie Devs'), channel('eve', 'events', 0, null, 1, 'g2', 'Indie Devs'),
    channel('th1', 'Build 0.4.2', 11, 'bld', 0, 'g2', 'Indie Devs'), channel('archive', 'archive', 0, null, 0, 'g3', 'Archive'),
  ];
  await feedDB.putChannels(channels);
  await feedDB.event({ type: 'start', at: now - 20 * 3600e3 });
  await feedDB.event({ type: 'gap', at: now - 8 * 3600e3, from: now - 9 * 3600e3, to: now - 8.5 * 3600e3 });
  const people = { Yazz: 1, Tito: 2, Kira: 3, Luna: 4, Mo: 5, Nico: 6, Pablo: 7 };
  let n = 0;
  const message = (channel_id, guild_id, who, minutes, content, extra = {}) => {
    const id = `m${n++}`;
    return { id, channel_id, guild_id, author: { id: String(1300000000000000000n + BigInt(people[who]) * 4194304n), name: who }, content, timestamp: iso(minutes), ...extra };
  };
  const fixtures = [
    message('gen', 'g1', 'Yazz', 70, 'Does the new banner rerun Aster?'),
    message('gen', 'g1', 'Tito', 69, 'Error 502 when logging in.'),
    message('gen', 'g1', 'Kira', 68, 'Yes, starting Thursday.', { reply_to: 'm0' }),
    message('gen', 'g1', 'Luna', 67, 'Anyone forming a co-op team?'),
    message('gen', 'g1', 'Mo', 67, 'Clear your cache.', { mentions: [String(1300000000000000000n + 2n * 4194304n)] }),
    message('th1', 'g2', 'Nico', 66, 'Tested 0.4.2 on Windows.'),
    message('gen', 'g1', 'Yazz', 66, 'Finally!'),
    message('gen', 'g1', 'Pablo', 65, 'I will heal.', { reply_to: 'm3' }),
    message('gen', 'g1', 'Tito', 64, 'That worked, thanks.'),
    message('gen', 'g1', 'Kira', 63, 'The rerun lasts seven days.'),
    message('th1', 'g2', 'Luna', 62, 'Also on Linux.', { attachments: [{ filename: 'log-linux.txt' }] }),
    message('gen', 'g1', 'Luna', 61, 'Ready, we have four.'),
    message('gen', 'g1', 'Mo', 60, 'Does it include a weapon?', { reply_to: 'm9' }),
    message('anu', 'g1', 'Kira', 6, 'Maintenance starts at 08:30. @everyone', { edited_timestamp: iso(5) }),
    message('eve', 'g2', 'Nico', 3, 'Game jam this weekend.'),
  ];
  for (let i = 0; i < 405; i++) fixtures.push(message('archive', 'g3', 'Nico', 1000 + i, `Archived message ${i}`));
  await Promise.all(fixtures.map((entry) => feedDB.writeMessage(entry)));
  // Observe viewer queries after fixture insertion without substituting the database implementation.
  window.viewerQueries = [];
  const recent = feedDB.recent;
  feedDB.recent = (collection, channels, limit) => {
    window.viewerQueries.push({ id: collection?.id, limit });
    return recent(collection, channels, limit);
  };
})();
