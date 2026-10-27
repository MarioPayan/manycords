// Local reader. All content is constructed as DOM nodes, including message formatting.
const api = globalThis.browser ?? chrome;
const store = api.storage.local;
const t = (key, substitutions = []) => api.i18n.getMessage(key, substitutions.map(String));
const $ = (selector) => document.querySelector(selector);
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') {
      for (const [property, setting] of Object.entries(value)) {
        if (property.startsWith('--')) node.style.setProperty(property, setting);
        else node.style[property] = setting;
      }
    }
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, String(value));
  }
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined));
  return node;
}
const button = (text, props = {}) => el('button', { type: 'button', ...props }, text);
const link = (text, href, props = {}) => safeLink(href) ? el('a', { href: safeLink(href), target: '_blank', rel: 'noopener noreferrer', ...props }, text) : el('span', props, text);
const fmtFull = (date) => new Date(date).toLocaleString();
const hm = (date) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const THREAD_TYPES = [10, 11, 12], NOT_LISTENABLE = [4, ...THREAD_TYPES], MAX_SHOWN = 400;
const EMOJIS = ['\u{1f4e3}', '\u2b50', '\u{1f3a8}', '\u{1f6e0}', '\u{1f3ae}', '\u{1f4c1}'];
let S = { collections: [], chans: {}, guilds: {}, icons: {}, msgs: [], events: [], stats: {}, buckets: Array(24).fill(0), people: new Map() };
const ui = { collection: null, src: '', conv: '', q: '', hover: null, edit: null, feedKey: null, expanded: false, seen: new Set(), visibleSince: new Map() };
const collection = () => S.collections.find((c) => c.id === ui.collection);
const isThread = (id) => THREAD_TYPES.includes(S.chans[id]?.type);
const baseChannel = (m) => isThread(m.channel_id) ? S.chans[m.channel_id]?.parent_id : m.channel_id;
const inCollection = (c, m) => c.all || c.ids.includes(m.channel_id) || c.ids.includes(baseChannel(m));
const isUnread = (c, m) => Date.parse(m.timestamp) > (c.readAt ?? 0);
const chanName = (id) => S.chans[id]?.name ?? id;
const guildName = (id) => S.guilds[id] ?? t('server');
const emojiOf = (c) => c.emoji ?? (c.all ? '\u{1f310}' : '\u{1f4c1}');
const isDark = () => S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
const laneColor = (id) => `var(--l${laneIndex(id)})`;
const initials = (name) => String(name).split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
function imageOrInitial(src, name, cls) {
  const fallback = () => el('span', { class: cls }, initials(name));
  return src ? el('img', { class: cls, alt: '', src, onerror: (ev) => ev.target.replaceWith(fallback()) }) : fallback();
}
const fav = (id) => imageOrInitial(S.icons[id] ? `https://cdn.discordapp.com/icons/${encodeURIComponent(id)}/${encodeURIComponent(S.icons[id])}.png?size=64` : null, guildName(id), 'fav');
function avatar(author = {}, guild) {
  const id = encodeURIComponent(author.id ?? '');
  let src;
  if (author.member_avatar) src = `https://cdn.discordapp.com/guilds/${encodeURIComponent(guild)}/users/${id}/avatars/${encodeURIComponent(author.member_avatar)}.png?size=64`;
  else if (author.avatar) src = `https://cdn.discordapp.com/avatars/${id}/${encodeURIComponent(author.avatar)}.png?size=64`;
  else { try { src = `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(author.id) >> 22n) % 6n)}.png`; } catch { /* initials */ } }
  return imageOrInitial(src, author.name ?? '?', 'av');
}
let settingsKey, collectionsKey;
async function load(force = false) {
  const settings = await store.get(['collections', 'lastSignal', 'theme', 'rev', 'health', 'consentedAt', 'retentionDays']);
  const key = JSON.stringify([settings.collections, settings.theme, settings.health, settings.consentedAt, settings.retentionDays]);
  const revised = S.rev !== settings.rev || settingsKey === undefined;
  if (!force && !revised && key === settingsKey) return false;
  const nextCollectionsKey = JSON.stringify(settings.collections ?? []);
  const changedCollections = collectionsKey !== nextCollectionsKey;
  const pending = ui.edit?.isNew && collection();
  S.collections = settings.collections ?? [];
  if (pending && !S.collections.some((c) => c.id === pending.id)) S.collections.push(pending);
  if (!S.collections.some((c) => c.id === ui.collection)) ui.collection = S.collections[0]?.id ?? null;
  Object.assign(S, { lastSignal: settings.lastSignal, theme: settings.theme ?? 'system', health: settings.health, consentedAt: settings.consentedAt, retentionDays: settings.retentionDays ?? 14 });
  if (revised) {
    const [channels, events] = await Promise.all([feedDB.channels(), feedDB.events(Date.now() - 864e5)]);
    S.chans = Object.fromEntries(channels.map((c) => [c.id, c])); S.guilds = {}; S.icons = {}; S.events = events;
    for (const c of channels) { if (c.guild_name) S.guilds[c.guild_id] = c.guild_name; if (c.guild_icon) S.icons[c.guild_id] = c.guild_icon; }
  }
  if (revised || changedCollections || force) {
    const overview = await feedDB.overview(S.collections, S.chans, Date.now());
    S.stats = overview.stats; S.buckets = overview.buckets;
    // Include ALL unread predecessors: a latest-400 slice cannot safely advance readAt.
    if (ui.loadedCollection !== collection()?.id) { ui.loadedCollection = collection()?.id; ui.windowLimit = MAX_SHOWN; ui.fullHistory = false; }
    ui.windowLimit = Math.max(ui.windowLimit, (S.stats[collection()?.id]?.unread ?? 0) + 50);
    const limit = ui.fullHistory ? Number.MAX_SAFE_INTEGER : ui.windowLimit;
    S.msgs = await feedDB.recent(collection(), S.chans, limit);
    S.people = new Map(S.msgs.filter((m) => m.author?.id).map((m) => [m.author.id, m.author.name]));
  }
  S.rev = settings.rev; settingsKey = key; collectionsKey = nextCollectionsKey;
  return true;
}
const saveCollections = () => store.set({ collections: S.collections.filter((c) => !(ui.edit?.isNew && c.id === ui.collection)) });
function gapTargets(gap) { return typeof recoveryTargets === 'function' ? recoveryTargets(gap, S.collections, S.chans) : []; }
function gapCovered(gap) {
  const ids = Object.values(S.chans).filter((ch) => !NOT_LISTENABLE.includes(ch.type) && S.collections.some((c) => c.all || c.ids.includes(ch.id))).map((ch) => ch.id);
  return typeof isGapCovered === 'function' ? isGapCovered(gap, ids) : ids.length > 0 && ids.every((id) => gap.covered?.[id]);
}
function renderStatus() {
  const age = S.lastSignal ? (Date.now() - S.lastSignal) / 1000 : Infinity;
  const state = S.health?.state ?? (!S.consentedAt ? 'not-consented' : age <= 180 ? 'ok' : 'no-tab');
  const keys = { ok: 'healthOk', 'no-tab': 'healthNoTab', broken: 'healthBroken', 'multi-tab': 'healthMultiTab', 'not-consented': 'healthNotConsented' };
  const status = $('#status'); status.className = `status ${state === 'ok' ? '' : 'off'}`;
  const ageLabel = !S.lastSignal ? t('never') : age < 60 ? t('secondsAgo', [Math.max(1, Math.round(age))]) : age < 3600 ? t('minutesAgo', [Math.round(age / 60)]) : fmtFull(S.lastSignal);
  status.replaceChildren(el('div', { class: 'row' }, el('span', { class: 'pulse' }), el('b', {}, t(state === 'ok' ? 'listening' : 'noSignal')), el('small', {}, ageLabel)), el('p', { class: 'health-copy' }, t(keys[state] ?? 'healthBroken')));
  if (state === 'not-consented') status.append(button(t('welcome'), { class: 'textbtn', onclick: () => showWelcome() }));
  if (state === 'no-tab') status.append(link(t('openDiscordStep'), 'https://discord.com/app'));
  const gaps = S.events.filter((e) => e.type === 'gap' && (e.to ?? e.at) > Date.now() - 864e5);
  const max = Math.max(1, ...S.buckets);
  status.append(el('div', { class: 'spark', title: t('hourlyCapture') }, S.buckets.map((n, i) => {
    const gap = gaps.find((g) => g.from < Date.now() - (23 - i) * 36e5 && g.to > Date.now() - (24 - i) * 36e5);
    return el('i', { class: gap ? gapCovered(gap) ? 'covered' : 'gap' : n ? '' : 'none', style: { height: `${10 + n / max * 90}%` } });
  })), el('div', { class: 'legend' }, t('dayAgo'), el('span', {}, t(gaps.length ? 'coverageGaps' : 'noGaps')), t('now')));
  for (const gap of gaps) {
    const covered = gapCovered(gap);
    const row = el('div', { class: `gap-row ${covered ? 'covered' : ''}` }, el('span', { title: t('gapRange', [fmtFull(gap.from), fmtFull(gap.to)]) }, t('gapAt', [hm(gap.from)])));
    if (covered) row.append(el('span', {}, t('gapCovered')));
    else row.append(button(t('recover'), { class: 'textbtn', onclick: () => showRecovery(gap) }));
    status.append(row);
  }
  if ($('#guide-signal')) { $('#guide-signal').textContent = t(state === 'ok' ? 'greenSignal' : 'waitSignal'); $('#guide-signal').classList.toggle('covered', state === 'ok'); }
}
function renderSide() {
  const side = $('#side');
  side.replaceChildren(el('div', { class: 'group' }, el('span', {}, t('collections')), button('+', { id: 'add', 'aria-label': t('newCollection'), title: t('newCollection') })));
  for (const c of S.collections) {
    const n = S.stats[c.id]?.unread ?? 0;
    side.append(button([el('span', { class: 'em' }, emojiOf(c)), el('span', { class: 'nm' }, c.name), el('span', { class: 'n' }, n > 999 ? '999+' : n || '')], { class: `item ${c.id === ui.collection ? 'on' : ''} ${n ? 'unread' : ''}`, 'data-collection': c.id }));
  }
  const c = collection();
  if (c) {
    const sources = Object.keys(S.stats[c.id]?.guilds ?? {}).sort((a, b) => guildName(a).localeCompare(guildName(b)));
    if (ui.src && !sources.includes(ui.src)) ui.src = '';
    if (sources.length) side.append(el('div', { class: 'group' }, t('sourcesIn', [c.name])));
    for (const id of sources) side.append(button([fav(id), el('span', { class: 'nm' }, guildName(id)), el('span', { class: 'n' }, S.stats[c.id]?.guilds[id] || '')], { class: `item ${ui.src === id ? 'on' : ''}`, 'data-src': id }));
  }
  renderStatus();
}
function renderHead(c, list) {
  const focus = document.activeElement?.id === 'q';
  const selection = focus ? [$('#q').selectionStart, $('#q').selectionEnd] : null;
  const n = list.filter((m) => isUnread(c, m)).length;
  const sources = new Set(c.ids.map((id) => S.chans[id]?.guild_id).filter(Boolean)).size;
  const sub = el('div', { class: 'subrow' }, el('span', { class: n ? 'newpill' : 'mono' }, n ? t(n === 1 ? 'newCountOne' : 'newCountMany', [n]) : t('upToDate')),
    el('span', {}, c.all ? t('allSources') : `${t(c.ids.length === 1 ? 'channelCountOne' : 'channelCountMany', [c.ids.length])} \u00b7 ${t(sources === 1 ? 'sourceCountOne' : 'sourceCountMany', [sources])}`));
  for (const [key, value] of [['src', ui.src && guildName(ui.src)], ['conv', ui.conv && `#${chanName(ui.conv)}`], ['q', ui.q]]) {
    if (value) sub.append(el('span', { class: 'chipf' }, el('span', {}, value), button('\u00d7', { 'data-clear': key, 'aria-label': t(key === 'q' ? 'clearSearch' : 'removeFilter') })));
  }
  sub.append(el('span', { class: 'grow' }), button(t('markRead'), { class: 'textbtn', id: 'markread' }));
  $('#head').replaceChildren(el('div', { class: 'titlerow' }, el('span', { class: 'em' }, emojiOf(c)), el('h1', {}, c.name), button('\u270e', { class: 'iconbtn', id: 'edit', 'aria-label': t('editCollection'), title: t('editCollection') }), el('span', { class: 'grow' }),
    el('label', { class: 'search' }, el('input', { id: 'q', placeholder: t('searchIn', [c.name]), value: ui.q, 'aria-label': t('search') })), button(isDark() ? '\u2600' : '\u263e', { class: 'iconbtn', id: 'themebtn', 'aria-label': t('changeTheme'), title: t('changeTheme') }), button('\u22ef', { class: 'iconbtn', id: 'mobilemenu', 'aria-label': t('settings') })), sub);
  if (focus) { $('#q').focus(); $('#q').setSelectionRange(...selection); }
}
function richNodes(tokens) {
  return tokens.map((token) => {
    if (token.type === 'text') return document.createTextNode(token.text);
    if (token.type === 'discord') {
      const value = token.text;
      if (/^a?:/.test(value)) return document.createTextNode(`:${value.split(':')[1]}:`);
      const name = value.startsWith('#') ? `#${chanName(value.slice(1))}` : value.startsWith('@&') ? `@${t('role')}` : /^@!?\d/.test(value) ? `@${S.people.get(value.replace(/^@!?/, '')) ?? t('mention')}` : `@${value}`;
      return el('span', { class: 'ment' }, name);
    }
    if (token.type === 'link') return link(richNodes(token.children), token.href);
    if (token.type === 'spoiler') {
      const reveal = (event) => { const node = event.currentTarget; node.classList.add('revealed'); node.setAttribute('aria-expanded', 'true'); node.removeAttribute('aria-label'); };
      return el('span', { role: 'button', tabindex: '0', class: 'spoiler', 'aria-label': t('revealSpoiler'), 'aria-expanded': 'false', onclick: reveal, onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); reveal(event); } } }, richNodes(token.children));
    }
    if (token.type === 'pre') return el('pre', {}, el('code', {}, token.text));
    if (token.type === 'code') return el('code', {}, token.text);
    return el(token.type, {}, richNodes(token.children));
  });
}
function attachment(file) {
  const name = file.filename ?? t('fileType');
  const card = () => link([el('span', { class: 'ft' }, name.split('.').pop().slice(0, 4).toUpperCase()), el('div', {}, name, el('small', {}, t('notAnalyzed')))], file.url, { class: 'file' });
  if (!file.content_type?.startsWith('image/') || !safeLink(file.url)) return card();
  // Only Discord CDN images are loaded automatically; other URLs remain file links.
  const cdn = (value) => { const url = safeLink(value); return url && /^(?:cdn|media)\.discordapp\.(?:com|net)$/.test(new URL(url).hostname) ? url : null; };
  const original = cdn(file.url), proxy = cdn(file.proxy_url);
  if (!proxy && !original) return card();
  const src = new URL(proxy ?? original); src.searchParams.set('width', '320'); src.searchParams.set('height', '240');
  const image = el('img', { src: src.href, alt: name, loading: 'lazy', class: 'thumbnail', width: Math.min(file.width || 320, 320), onerror: () => {
    if (original && image.dataset.fallback !== 'original') { image.dataset.fallback = 'original'; image.src = original; }
    else image.parentElement.replaceWith(card());
  } });
  return link(image, file.url, { class: 'image-attachment' });
}
function messageNode(m, index, total, c) {
  const reply = S.msgs.find((x) => x.id === m.reply_to);
  const href = `https://discord.com/channels/${encodeURIComponent(m.guild_id)}/${encodeURIComponent(m.channel_id)}/${encodeURIComponent(m.id)}`;
  const header = el('div', { class: 'h' }, el('span', { class: 'who' }, m.author?.name ?? '?'), el('time', { class: 't', title: fmtFull(m.timestamp), datetime: m.timestamp }, hm(m.timestamp)), link([fav(m.guild_id), `#${chanName(m.channel_id)}`], href, { class: 'where', title: t('openInDiscord') }));
  if (m.reply_to) header.append(el('span', { class: 're' }, `\u21b3 ${reply?.author?.name ?? t('reply')}`));
  if (m.edited_timestamp) header.append(el('span', { class: 'tag' }, t('edited')));
  if (m.deleted_at) header.append(el('span', { class: 'tag' }, t('deleted')));
  const body = el('div', {}, header, el('div', { class: 'txt' }, richNodes(markdownTokens(m.content))));
  const extras = [...(m.stickers ?? []).map((s) => t('stickerLabel', [s])), m.embeds ? t('embedCount', [m.embeds]) : ''].filter(Boolean);
  if (extras.length) body.append(el('div', { class: 'tag' }, extras.join(' \u00b7 ')));
  body.append(...(m.attachments ?? []).map(attachment));
  return el('article', { class: `entry ${isUnread(c, m) ? 'unread' : ''} ${m.deleted_at ? 'deleted' : ''}`, tabindex: '0', 'data-c': m.channel_id, 'data-id': m.id, 'aria-posinset': index + 1, 'aria-setsize': total }, avatar(m.author, m.guild_id), body,
    el('div', { class: 'tools' }, button('\u25ce', { 'data-focus': m.channel_id, 'aria-label': t('focusChannel'), title: t('focusChannel') }), link('\u2197', href, { 'aria-label': t('openInDiscord'), title: t('openInDiscord') })));
}
let riverResize;
function renderRiver() {
  const c = collection(), scroll = $('#scroll');
  const focusedId = document.activeElement?.closest('.entry')?.dataset.id;
  if (!c) { $('#head').replaceChildren(); scroll.replaceChildren(el('div', { class: 'empty' }, el('h2', {}, t('noCollections')), el('p', {}, t('createCollectionHint')), button(t('newCollection'), { class: 'btn primary', id: 'add2' }))); return; }
  const key = JSON.stringify([c.id, ui.src, ui.conv, ui.q]);
  const changed = key !== ui.feedKey;
  if (changed) { ui.expanded = false; ui.seen.clear(); ui.visibleSince.clear(); ui.openReadAt = c.readAt ?? 0; }
  const all = S.msgs.filter((m) => inCollection(c, m));
  const q = ui.q.toLowerCase();
  const filtered = all.filter((m) => (!ui.src || m.guild_id === ui.src) && (!ui.conv || m.channel_id === ui.conv) && (!q || `${m.content ?? ''} ${m.author?.name ?? ''}`.toLowerCase().includes(q)));
  const order = readingOrder(filtered, ui.openReadAt ?? c.readAt ?? 0, ui.expanded);
  const list = order.visible;
  renderHead(c, filtered);
  const keep = scroll.scrollTop;
  if (!list.length) {
    scroll.replaceChildren(el('div', { class: 'empty' }, el('h2', {}, t(!c.all && !c.ids.length ? 'emptyCollection' : all.length ? 'nothingHere' : 'noMessages')), el('p', {}, t(!c.all && !c.ids.length ? 'chooseSourcesHint' : all.length ? 'noMatches' : 'messagesHint')), ...(!c.all && !c.ids.length ? [button(t('chooseChannels'), { class: 'btn primary', id: 'emptyedit' })] : [])));
    ui.feedKey = key; return;
  }
  const { convs, replies } = assignConversations(list, { isThread, channelName: chanName, threadName: chanName, parentId: (id) => S.chans[id]?.parent_id });
  // Every channel keeps its own lane. Narrow screens compress spacing instead of merging lanes.
  const laneIds = [...new Set([...convs.keys(), ...[...convs.values()].map((lane) => lane.parent_id).filter(Boolean)])].sort((a, b) => {
    if (a === b) return 0;
    const parentA = convs.get(a)?.parent_id ?? a, parentB = convs.get(b)?.parent_id ?? b;
    return parentA.localeCompare(parentB) || (a === parentA ? -1 : b === parentB ? 1 : a.localeCompare(b));
  });
  const gap = Math.min(16, 90 / Math.max(1, laneIds.length));
  const x = (id) => 10 + Math.max(0, laneIds.indexOf(id)) * gap;
  const gut = Math.ceil(28 + laneIds.length * gap);
  const river = el('div', { class: 'river', role: 'feed', 'aria-label': t('messageFeed'), style: { '--gut': `${gut}px` } });
  const earlierCount = !ui.src && !ui.conv && !ui.q ? Math.max(order.earlier.length, (S.stats[c.id]?.total ?? S.msgs.length) - order.unread.length) : order.earlier.length;
  if (earlierCount && order.unread.length) river.append(button(t('earlierRead', [earlierCount]), { class: 'textbtn earlier', 'aria-expanded': String(ui.expanded), onclick: async () => {
    const anchor = [...river.querySelectorAll('.entry')].find((entry) => entry.getBoundingClientRect().bottom >= scroll.getBoundingClientRect().top);
    const id = anchor?.dataset.id, before = anchor?.getBoundingClientRect().top;
    if (!ui.expanded && !ui.fullHistory) { ui.fullHistory = true; await refresh(true); }
    ui.expanded = !ui.expanded; renderRiver();
    const next = [...scroll.querySelectorAll('.entry')].find((entry) => entry.dataset.id === id);
    if (next) scroll.scrollTop += next.getBoundingClientRect().top - before;
  } }));
  if ((S.stats[c.id]?.total ?? 0) > S.msgs.length) river.append(el('div', { class: 'more' }, t('recentLimit', [S.msgs.length, S.stats[c.id].total])));
  const labels = new Map(), entries = new Map(); let day;
  list.forEach((m, index) => {
    const date = new Date(m.timestamp).toDateString();
    if (date !== day) { day = date; river.append(el('div', { class: 'day' }, date === new Date().toDateString() ? t('today') : date === new Date(Date.now() - 864e5).toDateString() ? t('yesterday') : new Date(m.timestamp).toLocaleDateString())); }
    if (!labels.has(m.channel_id)) {
      const label = el('div', { class: 'conv', 'data-c': m.channel_id, style: { '--c': laneColor(m.channel_id) } }, button([fav(m.guild_id), el('span', { class: 'tt' }, `${isThread(m.channel_id) ? t('threadPrefix') : ''}#${chanName(m.channel_id)}`)], { 'data-focus': m.channel_id, title: t('focusChannel') }), el('span', { class: 'cm' }, `${guildName(m.guild_id)}${isThread(m.channel_id) ? ` \u00b7 #${chanName(S.chans[m.channel_id]?.parent_id)}` : ''} \u00b7 ${t(convs.get(m.channel_id).count === 1 ? 'messageCountOne' : 'messageCountMany', [convs.get(m.channel_id).count])}`));
      labels.set(m.channel_id, label); river.append(label);
    }
    const entry = messageNode(m, index, list.length, c); entries.set(m.id, entry); river.append(entry);
  });
  river.append(el('div', { class: 'endcap' }, el('span', { class: 'ok', 'aria-hidden': 'true' }, '\u2713'), t('feedEnd')));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'graph'); svg.setAttribute('aria-hidden', 'true'); river.append(svg);
  scroll.replaceChildren(river);
  const draw = () => {
    if (!river.isConnected) return;
    const top = river.getBoundingClientRect().top;
    const y = (node) => node.getBoundingClientRect().top - top + 17;
    const shape = (tag, attrs) => { const node = document.createElementNS(svg.namespaceURI, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); svg.append(node); };
    svg.replaceChildren(); svg.setAttribute('width', gut); svg.setAttribute('height', river.scrollHeight);
    for (const id of laneIds) {
      const nodes = list.filter((m) => m.channel_id === id).map((m) => entries.get(m.id));
      if (!nodes.length) {
        const branches = [...convs.values()].filter((lane) => lane.parent_id === id).map((lane) => y(labels.get(lane.id)));
        shape('path', { 'data-c': id, stroke: laneColor(id), d: `M3 ${Math.min(...branches) - 24} Q${x(id)} ${Math.min(...branches) - 24} ${x(id)} ${Math.min(...branches) - 12} L${x(id)} ${Math.max(...branches) - 12}` });
        continue;
      }
      const start = y(labels.get(id)), end = y(nodes.at(-1));
      const parent = convs.get(id).parent_id;
      const origin = parent ? x(parent) : 3;
      shape('path', { 'data-c': id, stroke: laneColor(id), d: `M${origin} ${start - 12} Q${x(id)} ${start - 12} ${x(id)} ${start + 6} L${x(id)} ${end}` });
      for (const node of nodes) {
        shape('path', { 'data-c': id, stroke: laneColor(id), opacity: '.3', d: `M${x(id)} ${y(node)} L${gut - 5} ${y(node)}` });
        shape('circle', { 'data-c': id, cx: x(id), cy: y(node), r: 4, fill: laneColor(id) });
      }
    }
    for (const reply of replies) {
      const from = entries.get(reply.from), to = entries.get(reply.to), a = x(from.dataset.c), b = x(to.dataset.c);
      shape('path', { class: 'reply-arc', 'data-c': to.dataset.c, stroke: 'var(--soft)', opacity: '.35', d: `M${a} ${y(from)} C${Math.max(a, b) + 12} ${y(from)} ${Math.max(a, b) + 12} ${y(to)} ${b} ${y(to)}` });
    }
    applyHover();
  };
  riverResize?.disconnect(); riverResize = new ResizeObserver(draw); riverResize.observe(river);
  draw(); document.fonts?.ready.then(draw);
  if (changed) {
    const firstUnread = river.querySelector('.entry.unread');
    scroll.scrollTop = firstUnread ? firstUnread.offsetTop - 8 : scroll.scrollHeight;
  } else scroll.scrollTop = keep;
  ui.feedKey = key;
  if (!changed && focusedId) entries.get(focusedId)?.focus({ preventScroll: true });
}
function applyHover() {
  for (const node of document.querySelectorAll('.river .entry, .river .conv')) node.classList.toggle('dim', !!ui.hover && node.dataset.c !== ui.hover);
  for (const node of document.querySelectorAll('.graph [data-c]')) node.style.opacity = ui.hover && node.dataset.c !== ui.hover ? '.12' : '';
}
function render() {
  if (S.theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
  $('#theme').value = S.theme; $('#retention').value = String(S.retentionDays);
  // Re-renders replace nodes; keep keyboard focus on the same control (by id) so live updates don't drop it.
  const focusedId = document.activeElement?.id;
  renderSide(); renderRiver();
  if (focusedId && !document.activeElement?.id) document.getElementById(focusedId)?.focus({ preventScroll: true });
}
// A visible bottom must remain in view for a full second. Unseen predecessors block advancement.
let savingRead = false;
async function sampleReading() {
  if (document.hidden || ui.edit || $('#overlay')) { ui.visibleSince.clear(); return; }
  const c = collection(); if (!c || savingRead) return;
  const bounds = $('#scroll').getBoundingClientRect(), now = performance.now();
  const present = new Set();
  for (const node of document.querySelectorAll('.entry')) {
    const id = node.dataset.id, rect = node.getBoundingClientRect(); present.add(id);
    if (rect.bottom > bounds.top && rect.bottom <= bounds.bottom && rect.right > bounds.left && rect.left < bounds.right) {
      if (!ui.visibleSince.has(id)) ui.visibleSince.set(id, now);
      if (now - ui.visibleSince.get(id) >= 1000) ui.seen.add(id);
    } else ui.visibleSince.delete(id);
  }
  for (const id of ui.visibleSince.keys()) if (!present.has(id)) ui.visibleSince.delete(id);
  const next = readHighWater(S.msgs.filter((m) => inCollection(c, m)), c.readAt ?? 0, ui.seen);
  if (next > (c.readAt ?? 0)) {
    c.readAt = next; savingRead = true;
    try { await saveCollections(); } finally { savingRead = false; }
  }
}
setInterval(() => sampleReading().catch(reportError), 100);
$('#scroll').addEventListener('scroll', () => sampleReading().catch(reportError), { passive: true });
document.addEventListener('visibilitychange', () => ui.visibleSince.clear());
const listenableChans = () => Object.values(S.chans).filter((c) => c.guild_id && !NOT_LISTENABLE.includes(c.type));
const channelIdsOf = (predicate) => listenableChans().filter(predicate).map((c) => c.id);
let returnFocus;
function openEdit(isNew) {
  const c = collection(); if (!c) return;
  returnFocus = document.activeElement; ui.visibleSince.clear();
  ui.edit = { name: c.name, emoji: emojiOf(c), ids: new Set(c.ids), q: '', isNew };
  $('.app').inert = true; drawSheet(); $('#cname').focus(); if (isNew) $('#cname').select();
}
function drawSheet() {
  const e = ui.edit, c = collection();
  const old = $('#scrim'), active = document.activeElement;
  if ($('#cname')) e.name = $('#cname').value;
  const position = old?.querySelector('.sh-body').scrollTop ?? 0;
  const activeKey = active?.id;
  const activePill = active?.dataset.pill;
  const q = e.q.toLowerCase();
  const picker = el('div');
  if (!c.all) {
    picker.append(el('label', { class: 'lab', for: 'sq' }, t('sourcesChannels')), el('div', { class: 'pickhead' }, el('input', { class: 'inp', id: 'sq', placeholder: t('searchSources'), value: e.q }), el('span', { class: 'selc' }, t(e.ids.size === 1 ? 'channelCountOne' : 'channelCountMany', [e.ids.size]))));
    const cards = el('div', { class: 'srccards' });
    const channels = listenableChans();
    for (const guild of [...new Set(channels.map((ch) => ch.guild_id))].sort((a, b) => guildName(a).localeCompare(guildName(b)))) {
      const all = channels.filter((ch) => ch.guild_id === guild);
      const shown = all.filter((ch) => !q || `${ch.name} ${guildName(guild)}`.toLowerCase().includes(q)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      if (!shown.length) continue;
      const on = all.filter((ch) => e.ids.has(ch.id)).length;
      const card = el('div', { class: `sc ${on ? 'active' : ''}` }, el('div', { class: 'sc-h' }, fav(guild), el('div', {}, el('b', {}, guildName(guild)), el('small', {}, on ? t('selectedChannels', [on, all.length]) : t(all.length === 1 ? 'channelCountOne' : 'channelCountMany', [all.length]))), button('', { class: `switch ${on === all.length ? 'on' : on ? 'part' : ''}`, role: 'switch', 'aria-checked': String(on === all.length), 'aria-label': t('allChannelsIn', [guildName(guild)]), 'data-all': guild })));
      for (const category of [...new Set(shown.map((ch) => ch.parent_id))]) {
        const group = el('div', { class: 'cg' });
        if (S.chans[category]) group.append(button(S.chans[category].name, { 'data-cat': category, title: t('toggleCategory', [S.chans[category].name]) }));
        group.append(el('div', { class: 'pills' }, shown.filter((ch) => ch.parent_id === category).map((ch) => button([`#${ch.name}`, ...(c.seen?.length && !c.seen.includes(ch.id) ? [el('span', { class: 'nw' }, t('newBadge'))] : [])], { class: `pill ${e.ids.has(ch.id) ? 'on' : ''}`, 'data-pill': ch.id, 'aria-pressed': String(e.ids.has(ch.id)) })))); card.append(group);
      }
      cards.append(card);
    }
    picker.append(cards.childElementCount ? cards : el('p', { class: 'mono' }, t(channels.length ? 'noSearchMatches' : 'unknownServers')));
  }
  const sheet = el('div', { class: 'scrim', id: 'scrim' }, el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sht' },
    el('div', { class: 'sh-head' }, el('h2', { id: 'sht' }, t(e.isNew ? 'newCollection' : 'editCollection')), el('p', {}, t(c.all ? 'allCollectionDescription' : 'collectionDescription')), button('\u00d7', { class: 'iconbtn x', id: 'sclose', 'aria-label': t('close') })),
    el('div', { class: 'sh-body' }, el('div', {}, el('label', { class: 'lab', for: 'cname' }, t('name')), el('div', { class: 'namerow' }, button(e.emoji, { class: 'emo', id: 'emo', title: t('changeIcon'), 'aria-label': t('changeIcon') }), el('input', { class: 'inp', id: 'cname', maxlength: '40', value: e.name }))), picker),
    el('div', { class: 'sh-foot' }, ...(!e.isNew ? [button(t('delete'), { class: 'btn danger', id: 'sdel' })] : []), el('span', { class: 'grow' }), button(t('cancel'), { class: 'btn ghost', id: 'scancel' }), button(t('done'), { class: 'btn primary', id: 'sdone' }))));
  if (old) old.replaceWith(sheet); else document.body.append(sheet);
  sheet.querySelector('.sh-body').scrollTop = position;
  if (activePill) [...sheet.querySelectorAll('[data-pill]')].find((node) => node.dataset.pill === activePill)?.focus();
  else if (activeKey) document.getElementById(activeKey)?.focus();
}
function restoreFocus() {
  $('.app').inert = false;
  if (returnFocus?.isConnected) returnFocus.focus(); else ($('#edit') ?? $('#add2') ?? $('#add'))?.focus();
}
function closeSheet() { ui.edit = null; $('#scrim')?.remove(); restoreFocus(); }
async function cancelSheet() {
  if (ui.edit?.isNew) { S.collections = S.collections.filter((c) => c.id !== ui.collection); ui.collection = S.collections[0]?.id ?? null; }
  closeSheet(); await refresh(true); restoreFocus();
}
const toast = (text) => { const node = el('div', { class: 'toast', role: 'status' }, text); document.body.append(node); setTimeout(() => node.remove(), 2200); };
function closeOverlay() { $('#overlay')?.remove(); restoreFocus(); }
function overlay(title, ...content) {
  ui.visibleSince.clear();
  if (!$('#overlay')) returnFocus = document.activeElement;
  $('#overlay')?.remove(); $('.app').inert = true;
  const node = el('div', { id: 'overlay', class: 'overlay' }, el('section', { class: 'overlay-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'overlay-title' }, el('h2', { id: 'overlay-title' }, title), ...content));
  document.body.append(node); node.querySelector('button, a, input')?.focus();
}
function showWelcome() {
  history.replaceState(null, '', '#welcome');
  overlay(t('welcome'), el('p', {}, t('welcomeCapture')), el('p', {}, t('welcomeLocal')), el('p', {}, t('welcomeRisk')), button(t('understand'), { class: 'btn primary', id: 'consent', onclick: async () => {
    await store.set({ consentedAt: Date.now() }); history.replaceState(null, '', location.pathname + location.search); showGuide();
  } }));
}
function showGuide() {
  overlay(t('guidedSteps'), el('ol', {}, el('li', {}, link(t('openDiscordStep'), 'https://discord.com/app')), el('li', { id: 'guide-signal' }, t(S.health?.state === 'ok' ? 'greenSignal' : 'waitSignal')), el('li', {}, button(t('createFirstCollection'), { class: 'textbtn', id: 'create-first', onclick: () => { closeOverlay(); newCollection(); } }))), button(t('done'), { class: 'btn', onclick: closeOverlay }));
}
function showRecovery(gap) {
  const targets = gapTargets(gap);
  overlay(t('recover'), el('p', {}, t('recoveryHint')), targets.length ? el('ul', {}, targets.map((target) => el('li', {}, link(`#${chanName(target.channelId)}`, target.url)))) : el('p', {}, t('recoveryUnavailable')), button(t('close'), { class: 'btn', onclick: closeOverlay }));
}
function showShortcuts() {
  const shortcuts = [['j / k', 'shortcutMove'], ['n', 'shortcutUnread'], ['m', 'markRead'], ['/', 'search'], ['e', 'editCollection'], ['Esc', 'close'], ['?', 'shortcuts']];
  overlay(t('shortcuts'), el('dl', {}, shortcuts.map(([key, name]) => [el('dt', {}, key), el('dd', {}, t(name))])), button(t('close'), { class: 'btn', onclick: closeOverlay }));
}
async function exportJSON(everything) {
  const selected = everything ? { all: true, ids: [] } : collection(); if (!selected) return;
  const [messages, channels, events] = await Promise.all([feedDB.recent(selected, S.chans, Number.MAX_SAFE_INTEGER), feedDB.channels(), feedDB.events(0)]);
  const payload = { version: 1, exportedAt: new Date().toISOString(), collections: everything ? S.collections : [selected], channels: everything ? channels : channels.filter((ch) => selected.all || selected.ids.includes(ch.id) || selected.ids.includes(ch.parent_id)), messages, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = el('a', { href: url, download: `reader-${everything ? 'all' : selected.id}-${Date.now()}.json` }); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function newCollection() {
  const c = { id: `c${Date.now()}`, name: t('newCollection'), emoji: '\u{1f4c1}', all: false, ids: [], seen: [], readAt: 0 };
  S.collections.push(c); ui.collection = c.id; ui.src = ui.conv = ui.q = ''; render(); openEdit(true);
}
async function markRead() {
  const c = collection(); if (!c) return;
  c.readAt = Math.max(c.readAt ?? 0, Date.now(), ...S.msgs.map((m) => Date.parse(m.timestamp)).filter(Number.isFinite));
  ui.openReadAt = c.readAt; ui.expanded = false; await saveCollections(); toast(t('readHere'));
}
async function click(event) {
  const menu = $('#menu');
  if (!event.target.closest('#menu, #menubtn, #mobilemenu')) { menu.hidden = true; $('#menubtn').setAttribute('aria-expanded', 'false'); }
  const b = event.target.closest('button'); if (!b) return;
  const e = ui.edit;
  if (b.id === 'menubtn' || b.id === 'mobilemenu') { menu.hidden = !menu.hidden; $('#menubtn').setAttribute('aria-expanded', String(!menu.hidden)); }
  else if (b.dataset.collection) { ui.collection = b.dataset.collection; ui.src = ui.conv = ui.q = ''; ui.feedKey = null; await refresh(true); }
  else if (b.dataset.src) { ui.src = ui.src === b.dataset.src ? '' : b.dataset.src; ui.conv = ''; render(); }
  else if (b.dataset.focus) { ui.conv = ui.conv === b.dataset.focus ? '' : b.dataset.focus; ui.hover = null; renderRiver(); }
  else if (b.dataset.clear) { ui[b.dataset.clear] = ''; render(); }
  else if (b.id === 'markread') await markRead();
  else if (b.id === 'themebtn') await store.set({ theme: isDark() ? 'light' : 'dark' });
  else if (b.id === 'edit' || b.id === 'emptyedit') openEdit(false);
  else if (b.id === 'add' || b.id === 'add2') newCollection();
  else if (e && b.dataset.pill) { e.ids.has(b.dataset.pill) ? e.ids.delete(b.dataset.pill) : e.ids.add(b.dataset.pill); drawSheet(); }
  else if (e && (b.dataset.cat || b.dataset.all)) {
    const ids = channelIdsOf((c) => b.dataset.cat ? c.parent_id === b.dataset.cat : c.guild_id === b.dataset.all);
    const full = ids.every((id) => e.ids.has(id)); ids.forEach((id) => full ? e.ids.delete(id) : e.ids.add(id)); drawSheet();
  } else if (e && b.id === 'emo') { e.emoji = EMOJIS[(EMOJIS.indexOf(e.emoji) + 1) % EMOJIS.length]; drawSheet(); }
  else if (b.id === 'sclose' || b.id === 'scancel') await cancelSheet();
  else if (e && b.id === 'sdone') {
    const c = collection(); c.name = $('#cname').value.trim() || t('unnamed'); c.emoji = e.emoji;
    if (!c.all) { c.ids = [...e.ids]; c.seen = channelIdsOf(() => true); }
    closeSheet(); await saveCollections(); await refresh(true); restoreFocus(); toast(t('collectionReady', [c.name]));
  } else if (e && b.id === 'sdel') {
    const c = collection(); if (!confirm(t('deleteCollection', [c.name]))) return;
    S.collections = S.collections.filter((x) => x.id !== c.id); ui.collection = S.collections[0]?.id ?? null; closeSheet(); await saveCollections(); await refresh(true); restoreFocus();
  } else if (b.id === 'clean') {
    const count = await feedDB.outside(S.collections, S.chans);
    if (!count) return toast(t('noOutside'));
    if (confirm(t('deleteOutside', [count]))) await command('clean');
  } else if (b.id === 'wipe') { if (confirm(t('wipeConfirm'))) await command('wipe'); }
  else if (b.id === 'export-current') await exportJSON(false);
  else if (b.id === 'export-all') await exportJSON(true);
  else if (b.id === 'welcome') showWelcome();
  else if (b.id === 'shortcuts') showShortcuts();
}
const reportError = (error) => console.error('[discord-feed]', error);
document.addEventListener('click', (event) => click(event).catch(reportError));
document.addEventListener('input', (event) => {
  if (event.target.id === 'q') { ui.q = event.target.value; renderRiver(); }
  if (event.target.id === 'sq') { ui.edit.q = event.target.value; drawSheet(); $('#sq').focus(); $('#sq').setSelectionRange(ui.edit.q.length, ui.edit.q.length); }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'theme') store.set({ theme: event.target.value }).catch(reportError);
  if (event.target.id === 'retention') store.set({ retentionDays: Number(event.target.value) }).catch(reportError);
});
document.addEventListener('keydown', (event) => {
  const dialog = $('#scrim [role="dialog"], #overlay [role="dialog"]');
  if (dialog) {
    if (event.key === 'Escape') { event.preventDefault(); ui.edit ? cancelSheet().catch(reportError) : closeOverlay(); return; }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, a[href], input, select, [tabindex="0"]')].filter((node) => !node.disabled && !node.hidden);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Enter' && event.target.id === 'cname') $('#sdone').click();
    return;
  }
  if (event.key === 'Escape') { $('#menu').hidden = true; $('#menubtn').setAttribute('aria-expanded', 'false'); return; }
  if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.altKey || event.metaKey) return;
  if (!['j', 'k', 'n', 'm', '/', 'e', '?'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === '/') $('#q')?.focus();
  else if (event.key === 'e') openEdit(false);
  else if (event.key === 'm') markRead().catch(reportError);
  else if (event.key === '?') showShortcuts();
  else {
    const entries = [...document.querySelectorAll('.entry')], index = entries.indexOf(document.activeElement?.closest('.entry'));
    const next = event.key === 'n' ? entries.find((node, i) => i > index && node.classList.contains('unread')) : entries[Math.max(0, Math.min(entries.length - 1, index + (event.key === 'k' ? -1 : 1)))];
    next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' });
  }
});
document.addEventListener('mousedown', (event) => { if (event.target.id === 'scrim') cancelSheet().catch(reportError); });
document.addEventListener('mouseover', (event) => { const id = event.target.closest('.river [data-c]')?.dataset.c ?? null; if (id !== ui.hover) { ui.hover = id; applyHover(); } });
const command = async (kind) => { const result = await api.runtime.sendMessage({ kind }); if (result?.error) throw new Error(result.error); await refresh(true); };
let refreshing = Promise.resolve();
const refresh = (force = false) => {
  refreshing = refreshing.then(async () => { if (await load(force)) render(); }).catch(reportError); return refreshing;
};
store.onChanged.addListener((changes) => { if (['rev', 'collections', 'theme', 'health', 'consentedAt', 'retentionDays'].some((key) => key in changes)) refresh(); });
setInterval(renderStatus, 30e3);
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
for (const attr of ['title', 'aria-label']) for (const node of document.querySelectorAll(`[data-i18n-${attr}]`)) node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
document.documentElement.lang = api.i18n.getUILanguage();
window.addEventListener('hashchange', () => { if (location.hash === '#welcome') showWelcome(); });
refresh().then(() => { if (location.hash === '#welcome' || !S.consentedAt) showWelcome(); });
