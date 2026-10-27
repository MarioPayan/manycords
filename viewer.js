// Reader UI, ported from design/prototype.html onto the extension's storage.
// IndexedDB holds records; storage.local holds collections, revisions and settings.
const api = globalThis.browser ?? chrome;
const store = api.storage.local;
const t = (key, substitutions = []) => api.i18n.getMessage(key, substitutions.map(String));
const h = (key, substitutions) => esc(t(key, substitutions));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtFull = (c) => new Date(c).toLocaleString();
const hm = (c) => new Date(c).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// golden-angle spread so neighbouring ids (snowflakes created close together) still get distinct colours
const hue = (id) => Math.round(([...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) * 137.508) % 360);
const THREAD_TYPES = [10, 11, 12];
const NOT_LISTENABLE = [4, ...THREAD_TYPES]; // categories; threads follow their parent channel
const MAX_SHOWN = 400;
const LANE_COLORS = 6, MAX_LANES = 8;
const EMOJIS = ['📣', '⭐', '🎨', '🛠️', '🎮', '🔥', '📰', '🧪', '🌐', '💬', '📁'];

let S = { collections: [], chans: {}, guilds: {}, icons: {}, msgs: [], events: [], stats: {}, buckets: Array(24).fill(0), people: new Map() };
const ui = { collection: null, src: '', conv: '', q: '', hover: null, edit: null, feedKey: null };

let settingsKey, collectionsKey;
async function load(force = false) {
  const settings = await store.get(['collections', 'lastSignal', 'theme', 'rev']);
  const key = JSON.stringify([settings.collections, settings.theme]);
  const revised = S.rev !== settings.rev || settingsKey === undefined;
  if (!force && !revised && key === settingsKey) return false;
  const nextCollectionsKey = JSON.stringify(settings.collections ?? []);
  const changedCollections = collectionsKey !== nextCollectionsKey;
  // Keep an unsaved collection across incoming capture revisions.
  const pending = ui.edit?.isNew && collection();
  S.collections = settings.collections ?? [];
  if (pending && !S.collections.some((c) => c.id === pending.id)) S.collections.push(pending);
  if (!S.collections.some((c) => c.id === ui.collection)) ui.collection = S.collections[0]?.id ?? null;
  S.lastSignal = settings.lastSignal;
  S.theme = settings.theme ?? 'system';
  if (revised) {
    const [channels, events] = await Promise.all([feedDB.channels(), feedDB.events(Date.now() - 864e5)]);
    S.chans = Object.fromEntries(channels.map((c) => [c.id, c]));
    S.guilds = {}; S.icons = {}; S.events = events;
    for (const c of channels) {
      if (c.guild_name) S.guilds[c.guild_id] = c.guild_name;
      if (c.guild_icon) S.icons[c.guild_id] = c.guild_icon;
    }
  }
  if (revised || changedCollections || force) {
    const [messages, overview] = await Promise.all([
      feedDB.recent(collection(), S.chans, MAX_SHOWN),
      feedDB.overview(S.collections, S.chans, Date.now()),
    ]);
    S.msgs = messages;
    S.people = new Map(messages.filter((m) => m.author?.id).map((m) => [m.author.id, m.author.name]));
    S.stats = overview.stats; S.buckets = overview.buckets;
  }
  S.rev = settings.rev; settingsKey = key; collectionsKey = nextCollectionsKey;
  return true;
}

const collection = () => S.collections.find((c) => c.id === ui.collection);
const saveCollections = () => store.set({ collections: S.collections });
const isThread = (id) => THREAD_TYPES.includes(S.chans[id]?.type);
const baseChannel = (m) => (isThread(m.channel_id) ? S.chans[m.channel_id].parent_id : m.channel_id);
const inCollection = (c, m) => c.all || c.ids.includes(m.channel_id) || c.ids.includes(baseChannel(m));
const isUnread = (c, m) => Date.parse(m.timestamp) > (c.readAt ?? 0);
const chanName = (id) => S.chans[id]?.name ?? id;
const emojiOf = (c) => c.emoji ?? (c.all ? '🌐' : '📁');
const guildName = (g) => S.guilds[g] ?? t('server');
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const isDark = () => (S.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : S.theme === 'dark');

// Server icon from Discord's CDN; coloured initials when there is none or it fails to load.
const fav = (g, cls = 'fav') => S.icons[g]
  ? `<img class="${cls}" alt="" src="${esc(`https://cdn.discordapp.com/icons/${g}/${S.icons[g]}.png?size=64`)}" data-fallback="${esc(initials(guildName(g)))}" style="background:hsl(${hue(g)} 50% 48%)">`
  : `<span class="${cls}" style="background:hsl(${hue(g)} 50% 48%)">${esc(initials(guildName(g)))}</span>`;
// Author avatar like Discord picks it: per-server avatar, else profile avatar, else Discord's default avatar.
const avatarUrl = (a, g) => {
  if (a.member_avatar) return `https://cdn.discordapp.com/guilds/${g}/users/${a.id}/avatars/${a.member_avatar}.png?size=64`;
  if (a.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`;
  try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(a.id) >> 22n) % 6n)}.png`; } catch { return null; }
};
const avatar = (a, g) => {
  const src = a?.id && avatarUrl(a, g);
  const style = `--h:${hue(a?.id ?? a?.name)}`;
  const letter = esc((a?.name ?? '?')[0].toUpperCase());
  return src ? `<img class="av" alt="" src="${esc(src)}" data-fallback="${letter}" style="${style}">` : `<span class="av" style="${style}">${letter}</span>`;
};
// Broken CDN images fall back to their initials (error events don't bubble, so listen in the capture phase).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fallback) return;
  console.warn('[discord-feed] image failed to load:', img.src);
  const span = document.createElement('span');
  span.className = img.className; span.style.cssText = img.style.cssText; span.textContent = img.dataset.fallback;
  img.replaceWith(span);
}, true);

// Message text: escape first, then render Discord's markup tokens.
const richText = (s) => esc(s)
  .replace(/&lt;a?(:\w+:)\d+&gt;/g, '$1')
  .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => `<span class="ment">@${esc(S.people.get(id) ?? t('mention'))}</span>`)
  .replace(/&lt;@&amp;\d+&gt;/g, `<span class="ment">@${h('role')}</span>`)
  .replace(/&lt;#(\d+)&gt;/g, (_, id) => `<span class="ment">#${esc(chanName(id))}</span>`)
  .replace(/@(everyone|here)\b/g, '<span class="ment">@$1</span>');

const I = {
  pen: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  plus: '<svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg class="ic" style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  search: '<svg class="ic" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  ext: '<svg class="ic" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  focus: '<svg class="ic" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M3 12h4M17 12h4M12 3v4M12 17v4"/></svg>',
  sun: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  check: '<svg class="ic" style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
};

/* ---------------- sidebar ---------------- */
function renderSide() {
  const c = collection();
  const unreadIn = (x, guild) => guild ? S.stats[x.id]?.guilds[guild] ?? 0 : S.stats[x.id]?.unread ?? 0;
  let html = `<div class="group"><span>${h('collections')}</span><button id="add" aria-label="${h('newCollection')}" title="${h('newCollection')}">${I.plus}</button></div>`
    + S.collections.map((x) => {
      const n = unreadIn(x);
      return `<button class="item ${x.id === ui.collection ? 'on' : ''} ${n ? 'unread' : ''}" data-collection="${esc(x.id)}"><span class="em">${esc(emojiOf(x))}</span><span class="nm">${esc(x.name)}</span><span class="n">${n > 999 ? '999+' : n || ''}</span></button>`;
    }).join('');
  if (c) {
    const srcs = Object.keys(S.stats[c.id]?.guilds ?? {}).sort((a, b) => guildName(a).localeCompare(guildName(b)));
    if (ui.src && !srcs.includes(ui.src)) ui.src = '';
    if (srcs.length) html += `<div class="group"><span>${h('sourcesIn', [c.name])}</span></div>` + srcs.map((g) => {
      const n = unreadIn(c, g);
      return `<button class="item ${ui.src === g ? 'on' : ''} ${n ? 'unread' : ''}" data-src="${esc(g)}">${fav(g)}<span class="nm">${esc(guildName(g))}</span><span class="n">${n || ''}</span></button>`;
    }).join('');
  }
  $('#side').innerHTML = html;

  // Listening status + 24 h coverage: one bar per hour, height = messages captured, red = a known gap.
  const age = S.lastSignal ? (Date.now() - S.lastSignal) / 1000 : Infinity;
  const live = age <= 180;
  const now = Date.now(), H = 3600e3;
  const buckets = S.buckets;
  const gaps = S.events.filter((e) => e.type === 'gap' && e.to > now - 24 * H);
  const inGap = (i) => gaps.some((g) => g.from < now - (23 - i) * H && g.to > now - (24 - i) * H);
  const max = Math.max(1, ...buckets);
  const lastGap = [...gaps].sort((a, b) => b.to - a.to)[0];
  const ageLabel = !S.lastSignal ? t('never') : age < 60 ? t('secondsAgo', [Math.max(1, Math.round(age))]) : age < 3600 ? t('minutesAgo', [Math.round(age / 60)]) : fmtFull(S.lastSignal);
  $('#status').className = `status ${live ? '' : 'off'}`;
  $('#status').innerHTML = `<div class="row"><span class="pulse"></span><b>${live ? t('listening') : t('noSignal')}</b><small>${ageLabel}</small></div>
    ${live ? '' : `<div class="warnline">${S.lastSignal ? t('noResponse') : t('openDiscord')}</div>`}
    <div class="spark" title="${h('hourlyCapture')}">${buckets.map((n, i) => (inGap(i) ? '<i class="gap"></i>' : n ? `<i style="height:${10 + (n / max) * 90}%"></i>` : '<i class="none"></i>')).join('')}</div>
    <div class="legend"><span>${h('dayAgo')}</span>${lastGap ? `<span class="g" title="${h('gapRange', [fmtFull(lastGap.from), fmtFull(lastGap.to)])}">${h('gapAt', [hm(lastGap.from)])}</span>` : `<span>${h('noGaps')}</span>`}<span>${h('now')}</span></div>`;
}

/* ---------------- header ---------------- */
function renderHead(c, list, convs) {
  const n = list.filter((m) => isUnread(c, m)).length;
  const chans = c.ids.length;
  const srcN = new Set(c.ids.map((id) => S.chans[id]?.guild_id).filter(Boolean)).size;
  const chips = [];
  if (ui.src) chips.push(`<span class="chipf">${fav(ui.src)}<span>${esc(guildName(ui.src))}</span><button data-clear="src" aria-label="${h('removeFilter')}">${I.x}</button></span>`);
  if (ui.conv && convs.has(ui.conv)) chips.push(`<span class="chipf"><span class="sw" style="background:${laneColor(ui.conv)}"></span><span>${esc(convs.get(ui.conv).title)}</span><button data-clear="conv" aria-label="${h('removeFilter')}">${I.x}</button></span>`);
  if (ui.q) chips.push(`<span class="chipf"><span>“${esc(ui.q)}”</span><button data-clear="q" aria-label="${h('clearSearch')}">${I.x}</button></span>`);
  const hadFocus = document.activeElement?.id === 'q';
  $('#head').innerHTML = `<div class="titlerow"><span class="em">${esc(emojiOf(c))}</span><h1>${esc(c.name)}</h1><button class="iconbtn" id="edit" aria-label="${h('editCollection')}" title="${h('editCollection')}">${I.pen}</button>
      <span class="grow"></span><label class="search">${I.search}<input id="q" placeholder="${h('searchIn', [c.name])}" value="${esc(ui.q)}" aria-label="${h('search')}"></label>
      <button class="iconbtn" id="themebtn" aria-label="${h('changeTheme')}" title="${h('changeTheme')}">${isDark() ? I.sun : I.moon}</button></div>
    <div class="subrow">${n ? `<span class="newpill">${h(n === 1 ? 'newCountOne' : 'newCountMany', [n])}</span>` : `<span class="mono" style="font-size:12px">${h('upToDate')}</span>`}
      <span>${c.all ? t('allSources') : `${t(chans === 1 ? 'channelCountOne' : 'channelCountMany', [chans])} · ${t(srcN === 1 ? 'sourceCountOne' : 'sourceCountMany', [srcN])}`}</span>
      ${chips.join('')}<span class="grow"></span>${n ? `<button class="textbtn" id="markread">${h('markRead')}</button>` : ''}</div>`;
  if (hadFocus) { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

/* ---------------- river with conversation lanes ---------------- */
let laneIdx = new Map();
const laneColor = (k) => `var(--l${(laneIdx.get(k) ?? 0) % LANE_COLORS})`;

function renderRiver() {
  const c = collection();
  if (!c) {
    $('#head').innerHTML = '';
    $('#scroll').innerHTML = `<div class="empty"><h2>${h('noCollections')}</h2><p>${h('createCollectionHint')}</p><button class="btn primary" id="add2">${h('newCollection')}</button></div>`;
    return;
  }
  const all = S.msgs.filter((m) => inCollection(c, m));
  const { convOf, convs } = assignConversations(all, { isThread, threadName: (id) => S.chans[id]?.name, noText: t('noText') });
  const q = ui.q.toLowerCase();
  if (ui.conv && !convs.has(ui.conv)) ui.conv = '';
  const filtered = all.filter((m) => (!ui.src || m.guild_id === ui.src) && (!ui.conv || convOf.get(m.id) === ui.conv)
    && (!q || `${m.content ?? ''} ${m.author?.name ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const list = filtered.slice(-MAX_SHOWN);

  // git-graph lane allocation over the visible list: a conversation holds a lane from its first to its last visible message
  const first = new Map(), last = new Map();
  list.forEach((m, i) => { const k = convOf.get(m.id); if (!first.has(k)) first.set(k, i); last.set(k, i); });
  laneIdx = new Map([...first.keys()].map((k, i) => [k, i]));
  renderHead(c, list, convs);

  if (!c.all && !c.ids.length) {
    $('#scroll').innerHTML = `<div class="empty"><svg width="96" height="72" viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"><path d="M10 60c20 0 26-48 46-48s20 30 30 30"/><path d="M10 60c12 0 18-20 34-20s22 20 42 20"/><circle cx="10" cy="60" r="4"/><circle cx="86" cy="42" r="4"/></svg>
      <h2>${h('emptyCollection')}</h2><p>${h('chooseSourcesHint')}</p><button class="btn primary" id="emptyedit">${h('chooseChannels')}</button></div>`;
    ui.feedKey = null;
    return;
  }
  if (!list.length) {
    $('#scroll').innerHTML = all.length
      ? `<div class="empty"><h2>${h('nothingHere')}</h2><p>${h('noMatches')}</p></div>`
      : `<div class="empty"><h2>${h('noMessages')}</h2><p>${h('messagesHint')}</p></div>`;
    ui.feedKey = null;
    return;
  }
  const lane = new Map(), busy = [];
  list.forEach((m, i) => {
    const k = convOf.get(m.id);
    if (first.get(k) === i) {
      let l = busy.findIndex((x) => !x);
      if (l < 0) l = busy.length;
      l = Math.min(l, MAX_LANES - 1); // ponytail: beyond MAX_LANES concurrent conversations the last lane is shared
      busy[l] = k; lane.set(k, l);
    }
    if (last.get(k) === i && busy[lane.get(k)] === k) busy[lane.get(k)] = null;
  });
  const gut = 30 + (Math.max(...lane.values()) + 1) * 16;

  let html = (S.stats[c.id]?.total ?? 0) > MAX_SHOWN ? `<div class="more">${h('recentLimit', [MAX_SHOWN, S.stats[c.id]?.total ?? filtered.length])}</div>` : '';
  let lastDay = '';
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString();
  list.forEach((m, i) => {
    const k = convOf.get(m.id), cv = convs.get(k), d = new Date(m.timestamp).toDateString();
    if (d !== lastDay) { html += `<div class="day">${d === today ? t('today') : d === yesterday ? t('yesterday') : esc(new Date(m.timestamp).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`; lastDay = d; }
    const base = baseChannel(m);
    if (first.get(k) === i) {
      const n = list.filter((x) => convOf.get(x.id) === k).length;
      html += `<div class="conv" data-c="${esc(k)}" style="--c:${laneColor(k)}"><button data-focus="${esc(k)}" title="${h('focusConversation')}"><span class="tt">${k.startsWith('thread:') ? t('threadPrefix') : ''}${esc(cv.title)}</span></button>`
        + `<span class="cm">${h(n === 1 ? 'messageCountOne' : 'messageCountMany', [n])} · #${esc(chanName(base))} · ${esc(guildName(m.guild_id))}</span></div>`;
    }
    const reply = m.reply_to && S.msgs.find((x) => x.id === m.reply_to);
    const link = esc(`https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.id}`);
    const files = (m.attachments ?? []).map((a) => `<div class="file"><span class="ft">${esc((a.filename.split('.').pop() || t('fileType')).slice(0, 4).toUpperCase())}</span><div>${esc(a.filename)}<small>${h('notAnalyzed')}</small></div></div>`).join('');
    const extras = [...(m.stickers ?? []).map((s) => t('stickerLabel', [s])), m.embeds ? t('embedCount', [m.embeds]) : ''].filter(Boolean);
    html += `<div class="entry ${isUnread(c, m) ? 'unread' : ''} ${m.deleted_at ? 'deleted' : ''}" data-c="${esc(k)}">
      ${avatar(m.author, m.guild_id)}
      <div><div class="h"><span class="who">${esc(m.author?.name ?? '?')}</span><span class="t" title="${esc(fmtFull(m.timestamp))}">${hm(m.timestamp)}</span>
        <a class="where" href="${link}" target="_blank" title="${h('openInDiscord')}">${fav(m.guild_id)}#${esc(chanName(base))}${isThread(m.channel_id) ? ` › ${esc(chanName(m.channel_id))}` : ''}</a>
        ${reply ? `<span class="re">↳ ${esc(reply.author?.name ?? '')}</span>` : m.reply_to ? `<span class="re">↳ ${h('reply')}</span>` : ''}
        ${m.edited_timestamp ? `<span class="tag">${h('edited')}</span>` : ''}${m.deleted_at ? `<span class="tag">${h('deleted')}</span>` : ''}</div>
      ${m.content ? `<div class="txt">${richText(m.content)}</div>` : ''}${extras.length ? `<div class="tag">${esc(extras.join(' · '))}</div>` : ''}${files}</div>
      <div class="tools"><button data-focus="${esc(k)}" title="${h('focusConversation')}" aria-label="${h('focusConversation')}">${I.focus}</button><a href="${link}" target="_blank" title="${h('openInDiscord')}" aria-label="${h('openInDiscord')}">${I.ext}</a></div></div>`;
  });
  html += `<div class="endcap"><span class="ok">${I.check}</span>${h('feedEnd')}</div>`;

  const sc = $('#scroll');
  const key = `${c.id}|${ui.src}|${ui.conv}|${ui.q}`;
  const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80, keep = sc.scrollTop;
  sc.innerHTML = `<div class="river" style="--gut:${gut}px">${html}<svg class="graph"></svg></div>`;
  const river = sc.querySelector('.river'), svg = river.querySelector('svg.graph');
  const draw = () => {
    if (!river.isConnected) return;
    const rb = river.getBoundingClientRect();
    const yOf = (el) => { const r = el.getBoundingClientRect(); return r.top - rb.top + r.height / 2; };
    const x = (k) => 18 + lane.get(k) * 16;
    svg.setAttribute('width', gut); svg.setAttribute('height', river.scrollHeight);
    let out = `<path stroke="var(--line)" d="M6 0 L 6 ${river.scrollHeight}" style="stroke-width:2"/>`;
    for (const k of first.keys()) {
      const label = river.querySelector(`.conv[data-c="${CSS.escape(k)}"]`);
      const nodes = [...river.querySelectorAll(`.entry[data-c="${CSS.escape(k)}"] .av`)];
      if (!label || !nodes.length) continue;
      const y0 = yOf(label), y1 = yOf(nodes.at(-1)), stroke = laneColor(k), dk = esc(k);
      out += `<path data-c="${dk}" stroke="${stroke}" d="M6 ${y0 - 12} C 6 ${y0}, ${x(k)} ${y0 - 6}, ${x(k)} ${y0 + 6} L ${x(k)} ${y1}"/>`;
      for (const n of nodes) {
        const y = yOf(n), un = n.closest('.entry').classList.contains('unread');
        out += `<path data-c="${dk}" stroke="${stroke}" opacity=".35" d="M${x(k)} ${y} L ${gut - 4} ${y}"/><circle data-c="${dk}" cx="${x(k)}" cy="${y}" r="${un ? 5.5 : 4}" fill="${un ? 'var(--unread)' : stroke}"/>`;
      }
    }
    svg.innerHTML = out;
    applyHover();
  };
  draw();
  document.fonts?.ready.then(draw);
  window.onresize = draw;
  // Images and fallbacks can change row heights after load: redraw when they settle.
  river.querySelectorAll('img').forEach((img) => img.complete || img.addEventListener('load', () => requestAnimationFrame(draw), { once: true }));

  if (key !== ui.feedKey) {
    const firstNew = river.querySelector('.entry.unread');
    if (firstNew) firstNew.scrollIntoView({ block: 'center' }); else sc.scrollTop = sc.scrollHeight;
  } else sc.scrollTop = atBottom ? sc.scrollHeight : keep;
  ui.feedKey = key;
}

function applyHover() {
  const k = ui.hover;
  document.querySelectorAll('.river .entry, .river .conv').forEach((e) => e.classList.toggle('dim', !!k && e.dataset.c !== k));
  document.querySelectorAll('.river svg.graph [data-c]').forEach((p) => (p.style.opacity = !k || p.dataset.c === k ? '' : '.12'));
}

function render() {
  if (S.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
  $('#theme').value = S.theme;
  renderSide();
  renderRiver();
}

/* ---------------- edit collection sheet ---------------- */
function openEdit(isNew) {
  const c = collection();
  ui.edit = { name: c.name, emoji: emojiOf(c), ids: new Set(c.ids), q: '', isNew };
  drawSheet();
  setTimeout(() => { const n = $('#cname'); n?.focus(); if (isNew) n?.select(); }, 40);
}

const listenableChans = () => Object.values(S.chans).filter((c) => c.guild_id && !NOT_LISTENABLE.includes(c.type));
const channelIdsOf = (pred) => listenableChans().filter(pred).map((c) => c.id);

function drawSheet() {
  const e = ui.edit, c = collection(), q = e.q.toLowerCase();
  if ($('#cname')) e.name = $('#cname').value; // keep what was typed across redraws
  const chans = Object.values(S.chans);
  const listenable = listenableChans();
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.name ?? '').localeCompare(b.name ?? '');
  const isNewCh = (channel) => c.seen?.length > 0 && !c.seen.includes(channel.id);
  const guilds = [...new Set(listenable.map((c) => c.guild_id))].sort((a, b) => guildName(a).localeCompare(guildName(b)));
  const cards = guilds.map((g) => {
    const mine = listenable.filter((c) => c.guild_id === g);
    const shown = mine.filter((c) => !q || (c.name ?? '').toLowerCase().includes(q) || guildName(g).toLowerCase().includes(q));
    if (!shown.length) return '';
    const on = mine.filter((c) => e.ids.has(c.id)).length;
    const pills = (list) => `<div class="pills">${[...list].sort(byPos).map((c) =>
      `<button class="pill ${e.ids.has(c.id) ? 'on' : ''}" data-pill="${esc(c.id)}" aria-pressed="${e.ids.has(c.id)}">#${esc(c.name)}${isNewCh(c) ? `<span class="nw">${h('newBadge')}</span>` : ''}</button>`).join('')}</div>`;
    const loose = shown.filter((c) => !S.chans[c.parent_id]);
    const cats = chans.filter((c) => c.guild_id === g && c.type === 4).sort(byPos)
      .map((cat) => [cat, shown.filter((c) => c.parent_id === cat.id)]).filter(([, kids]) => kids.length);
    return `<div class="sc ${on ? 'active' : ''}"><div class="sc-h">${fav(g)}<div><b>${esc(guildName(g))}</b><small>${on ? t('selectedChannels', [on, mine.length]) : t(mine.length === 1 ? 'channelCountOne' : 'channelCountMany', [mine.length])}</small></div>
      <button class="switch ${on === mine.length ? 'on' : on ? 'part' : ''}" data-all="${esc(g)}" role="switch" aria-checked="${on === mine.length}" aria-label="${h('allChannelsIn', [guildName(g)])}"></button></div>
      ${loose.length ? `<div class="cg">${pills(loose)}</div>` : ''}
      ${cats.map(([cat, kids]) => `<div class="cg"><button data-cat="${esc(cat.id)}" title="${h('toggleCategory', [cat.name])}">${esc(cat.name)}</button>${pills(kids)}</div>`).join('')}</div>`;
  }).join('');
  const picker = c.all ? '' : !listenable.length
    ? `<p class="mono" style="color:var(--faint);font-size:13px">${h('unknownServers')}</p>`
    : `<div><label class="lab" for="sq">${h('sourcesChannels')}</label><div class="pickhead"><input class="inp" id="sq" placeholder="${h('searchSources')}" value="${esc(e.q)}"><span class="selc">${h(e.ids.size === 1 ? 'channelCountOne' : 'channelCountMany', [e.ids.size])}</span></div><div class="srccards">${cards || `<p class="mono" style="color:var(--faint);font-size:13px">${h('noSearchMatches')}</p>`}</div></div>`;
  const html = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sht">
    <div class="sh-head"><h2 id="sht">${e.isNew ? t('newCollection') : t('editCollection')}</h2><p>${c.all ? t('allCollectionDescription') : t('collectionDescription')}</p>
      <button class="iconbtn x" id="sclose" aria-label="${h('close')}">${I.x.replace(/12px/g, '16px')}</button></div>
    <div class="sh-body">
      <div><label class="lab" for="cname">${h('name')}</label><div class="namerow"><button class="emo" id="emo" title="${h('changeIcon')}" aria-label="${h('changeIcon')}">${esc(e.emoji)}</button><input class="inp" id="cname" maxlength="40" value="${esc(e.name)}"></div></div>
      ${picker}
    </div>
    <div class="sh-foot">${e.isNew ? '' : `<button class="btn danger" id="sdel">${h('delete')}</button>`}<span class="grow"></span><button class="btn ghost" id="scancel">${h('cancel')}</button><button class="btn primary" id="sdone">${h('done')}</button></div>
  </div></div>`;
  const old = $('#scrim');
  if (old) {
    const st = old.querySelector('.sh-body').scrollTop;
    old.outerHTML = html;
    $('#scrim').style.animation = $('#scrim .sheet').style.animation = 'none';
    $('#scrim .sh-body').scrollTop = st;
  } else document.body.insertAdjacentHTML('beforeend', html);
}
const closeSheet = () => { ui.edit = null; $('#scrim')?.remove(); };
const toast = (text) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = text; document.body.append(d); setTimeout(() => d.remove(), 2200); };

/* ---------------- events ---------------- */
document.addEventListener('click', async (ev) => {
  const menu = $('#menu');
  if (!ev.target.closest('#menu, #menubtn')) { menu.hidden = true; $('#menubtn').ariaExpanded = 'false'; }
  const b = ev.target.closest('button');
  if (!b) return;
  const e = ui.edit;
  if (b.id === 'menubtn') { menu.hidden = !menu.hidden; b.ariaExpanded = String(!menu.hidden); }
  else if (b.dataset.collection) { ui.collection = b.dataset.collection; ui.src = ui.conv = ui.q = ''; await refresh(true); }
  else if (b.dataset.src) { ui.src = ui.src === b.dataset.src ? '' : b.dataset.src; ui.conv = ''; render(); }
  else if (b.dataset.focus) { ui.conv = ui.conv === b.dataset.focus ? '' : b.dataset.focus; ui.hover = null; renderRiver(); }
  else if (b.dataset.clear) { ui[b.dataset.clear] = ''; render(); }
  else if (b.id === 'markread') { collection().readAt = Date.now(); await saveCollections(); toast(t('readHere')); }
  else if (b.id === 'themebtn') store.set({ theme: isDark() ? 'light' : 'dark' });
  else if (b.id === 'edit' || b.id === 'emptyedit') openEdit(false);
  else if (b.id === 'add' || b.id === 'add2') {
    const c = { id: `c${Date.now()}`, name: t('newCollection'), emoji: '📁', all: false, ids: [], seen: [], readAt: 0 };
    S.collections.push(c); ui.collection = c.id; ui.src = ui.conv = ui.q = ''; render(); openEdit(true);
  }
  else if (e && b.dataset.pill) { e.ids.has(b.dataset.pill) ? e.ids.delete(b.dataset.pill) : e.ids.add(b.dataset.pill); drawSheet(); }
  else if (e && (b.dataset.cat || b.dataset.all)) {
    const ids = b.dataset.cat ? channelIdsOf((c) => c.parent_id === b.dataset.cat) : channelIdsOf((c) => c.guild_id === b.dataset.all);
    const full = ids.every((id) => e.ids.has(id));
    ids.forEach((id) => (full ? e.ids.delete(id) : e.ids.add(id)));
    drawSheet();
  }
  else if (e && b.id === 'emo') { e.name = $('#cname').value; e.emoji = EMOJIS[(EMOJIS.indexOf(e.emoji) + 1) % EMOJIS.length]; drawSheet(); }
  else if (b.id === 'sclose' || b.id === 'scancel') {
    if (e?.isNew) { S.collections = S.collections.filter((c) => c.id !== ui.collection); ui.collection = S.collections[0]?.id ?? null; }
    closeSheet(); await refresh(true);
  }
  else if (b.id === 'sdone') {
    const c = collection();
    c.name = $('#cname').value.trim() || t('unnamed');
    c.emoji = e.emoji;
    if (!c.all) { c.ids = [...e.ids]; c.seen = channelIdsOf(() => true); }
    closeSheet();
    await saveCollections();
    toast(t('collectionReady', [c.name]));
  }
  else if (b.id === 'sdel') {
    const c = collection();
    if (!confirm(t('deleteCollection', [c.name]))) return;
    S.collections = S.collections.filter((x) => x.id !== c.id); ui.collection = S.collections[0]?.id ?? null;
    closeSheet(); await saveCollections();
  }
  else if (b.id === 'clean') {
    const count = await feedDB.outside(S.collections, S.chans);
    if (!count) return toast(t('noOutside'));
    if (confirm(t('deleteOutside', [count]))) await command('clean');
  }
  else if (b.id === 'wipe') {
    if (!confirm(t('wipeConfirm'))) return;
    await command('wipe');
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { ui.q = ev.target.value; renderRiver(); }
  if (ev.target.id === 'sq') {
    ui.edit.q = ev.target.value; ui.edit.name = $('#cname').value; drawSheet();
    const i = $('#sq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  }
});
document.addEventListener('change', (ev) => { if (ev.target.id === 'theme') store.set({ theme: ev.target.value }); });
document.addEventListener('keydown', (ev) => {
  if (!ui.edit) return;
  if (ev.key === 'Escape') $('#scancel').click();
  if (ev.key === 'Enter' && ev.target.id === 'cname') $('#sdone').click();
});
document.addEventListener('mousedown', (ev) => { if (ev.target.id === 'scrim') $('#scancel').click(); });
document.addEventListener('mouseover', (ev) => {
  const el = ev.target.closest('.river [data-c]');
  const k = el ? el.dataset.c : null;
  if (k !== ui.hover) { ui.hover = k; applyHover(); }
});

const command = async (kind) => {
  const result = await api.runtime.sendMessage({ kind });
  if (result?.error) throw new Error(result.error);
};
let refreshing = Promise.resolve();
const refresh = (force = false) => {
  refreshing = refreshing.then(async () => { if (await load(force)) render(); })
    .catch((error) => console.error('[discord-feed]', error));
  return refreshing;
};
store.onChanged.addListener((changes) => {
  if (['rev', 'collections', 'theme'].some((key) => key in changes)) refresh();
});
setInterval(renderSide, 30e3); // keeps relative time and the no-signal warning honest
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
for (const attribute of ['title', 'aria-label']) {
  for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
}
document.documentElement.lang = api.i18n.getUILanguage();
refresh();
