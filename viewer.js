// Discord Feed viewer, ported from design/prototype.html onto the extension's storage.
// Storage: trays (collections), c:<id> channel meta, m:<id> messages, e:* coverage events, lastSignal, theme.
const api = globalThis.browser ?? chrome;
const store = api.storage.local;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtFull = (t) => new Date(t).toLocaleString();
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// golden-angle spread so neighbouring ids (snowflakes created close together) still get distinct colours
const hue = (id) => Math.round(([...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) * 137.508) % 360);
const THREAD_TYPES = [10, 11, 12];
const NOT_LISTENABLE = [4, ...THREAD_TYPES]; // categories; threads follow their parent channel
const MAX_SHOWN = 400;
const LANE_COLORS = 6, MAX_LANES = 8;
const EMOJIS = ['📣', '⭐', '🎨', '🛠️', '🎮', '🔥', '📰', '🧪', '🌐', '💬', '📁'];

let S = { trays: [], chans: {}, guilds: {}, icons: {}, msgs: [], events: [], people: new Map() };
const ui = { tray: null, src: '', conv: '', q: '', hover: null, edit: null, feedKey: null };

async function load() {
  // ponytail: loads the whole store each render; move messages to IndexedDB with indexes if it gets slow
  const all = await store.get(null);
  // a collection being created is not stored until "Listo": keep it across the reloads incoming messages trigger
  const pending = ui.edit?.isNew && S.trays.find((t) => t.id === ui.tray);
  S = { trays: all.trays ?? [], chans: {}, guilds: {}, icons: {}, msgs: [], events: [], people: new Map(), lastSignal: all.lastSignal, theme: all.theme ?? 'system' };
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('m:')) { S.msgs.push(v); if (v.author?.id) S.people.set(v.author.id, v.author.name); }
    else if (k.startsWith('e:')) S.events.push(v);
    else if (k.startsWith('c:')) {
      S.chans[v.id] = v;
      if (v.guild_name) S.guilds[v.guild_id] = v.guild_name;
      if (v.guild_icon) S.icons[v.guild_id] = v.guild_icon;
    }
  }
  if (pending && !S.trays.some((t) => t.id === pending.id)) S.trays.push(pending);
  if (!S.trays.some((t) => t.id === ui.tray)) ui.tray = S.trays[0]?.id ?? null;
}

const tray = () => S.trays.find((t) => t.id === ui.tray);
const saveTrays = () => store.set({ trays: S.trays });
const isThread = (id) => THREAD_TYPES.includes(S.chans[id]?.type);
const baseChannel = (m) => (isThread(m.channel_id) ? S.chans[m.channel_id].parent_id : m.channel_id);
const inTray = (t, m) => t.all || t.ids.includes(m.channel_id) || t.ids.includes(baseChannel(m));
const isUnread = (t, m) => Date.parse(m.timestamp) > (t.readAt ?? 0);
const chanName = (id) => S.chans[id]?.name ?? id;
const emojiOf = (t) => t.emoji ?? (t.all ? '🌐' : '📁');
const guildName = (g) => S.guilds[g] ?? 'Servidor';
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
  .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => `<span class="ment">@${esc(S.people.get(id) ?? 'mención')}</span>`)
  .replace(/&lt;@&amp;\d+&gt;/g, '<span class="ment">@rol</span>')
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
  const t = tray();
  const unreadIn = (x, f = () => true) => S.msgs.filter((m) => inTray(x, m) && isUnread(x, m) && f(m)).length;
  let html = `<div class="group"><span>Colecciones</span><button id="add" aria-label="Nueva colección" title="Nueva colección">${I.plus}</button></div>`
    + S.trays.map((x) => {
      const n = unreadIn(x);
      return `<button class="item ${x.id === ui.tray ? 'on' : ''} ${n ? 'unread' : ''}" data-tray="${esc(x.id)}"><span class="em">${esc(emojiOf(x))}</span><span class="nm">${esc(x.name)}</span><span class="n">${n > 999 ? '999+' : n || ''}</span></button>`;
    }).join('');
  if (t) {
    const srcs = [...new Set(S.msgs.filter((m) => inTray(t, m)).map((m) => m.guild_id))].sort((a, b) => guildName(a).localeCompare(guildName(b)));
    if (ui.src && !srcs.includes(ui.src)) ui.src = '';
    if (srcs.length) html += `<div class="group"><span>Fuentes en ${esc(t.name)}</span></div>` + srcs.map((g) => {
      const n = unreadIn(t, (m) => m.guild_id === g);
      return `<button class="item ${ui.src === g ? 'on' : ''} ${n ? 'unread' : ''}" data-src="${esc(g)}">${fav(g)}<span class="nm">${esc(guildName(g))}</span><span class="n">${n || ''}</span></button>`;
    }).join('');
  }
  $('#side').innerHTML = html;

  // Listening status + 24 h coverage: one bar per hour, height = messages captured, red = a known gap.
  const age = S.lastSignal ? (Date.now() - S.lastSignal) / 1000 : Infinity;
  const live = age <= 180;
  const now = Date.now(), H = 3600e3;
  const buckets = Array(24).fill(0);
  for (const m of S.msgs) { const i = 23 - Math.floor((now - (m.captured_at ?? Date.parse(m.timestamp))) / H); if (i >= 0 && i < 24) buckets[i]++; }
  const gaps = S.events.filter((e) => e.type === 'gap' && e.to > now - 24 * H);
  const inGap = (i) => gaps.some((g) => g.from < now - (23 - i) * H && g.to > now - (24 - i) * H);
  const max = Math.max(1, ...buckets);
  const lastGap = [...gaps].sort((a, b) => b.to - a.to)[0];
  const ageLabel = !S.lastSignal ? 'nunca' : age < 60 ? `hace ${Math.max(1, Math.round(age))} s` : age < 3600 ? `hace ${Math.round(age / 60)} min` : fmtFull(S.lastSignal);
  $('#status').className = `status ${live ? '' : 'off'}`;
  $('#status').innerHTML = `<div class="row"><span class="pulse"></span><b>${live ? 'Escuchando' : 'Sin señal'}</b><small>${ageLabel}</small></div>
    ${live ? '' : `<div class="warnline">${S.lastSignal ? 'La pestaña de Discord no responde: lo que pase ahora no se guarda.' : 'Abre discord.com en una pestaña para empezar.'}</div>`}
    <div class="spark" title="Mensajes capturados por hora, últimas 24 h">${buckets.map((n, i) => (inGap(i) ? '<i class="gap"></i>' : n ? `<i style="height:${10 + (n / max) * 90}%"></i>` : '<i class="none"></i>')).join('')}</div>
    <div class="legend"><span>-24 h</span>${lastGap ? `<span class="g" title="Hueco: ${esc(fmtFull(lastGap.from))} → ${esc(fmtFull(lastGap.to))}">hueco ${hm(lastGap.from)}</span>` : '<span>sin huecos</span>'}<span>ahora</span></div>`;
}

/* ---------------- header ---------------- */
function renderHead(t, list, convs) {
  const n = list.filter((m) => isUnread(t, m)).length;
  const chans = t.ids.length;
  const srcN = new Set(t.ids.map((id) => S.chans[id]?.guild_id).filter(Boolean)).size;
  const chips = [];
  if (ui.src) chips.push(`<span class="chipf">${fav(ui.src)}<span>${esc(guildName(ui.src))}</span><button data-clear="src" aria-label="Quitar filtro">${I.x}</button></span>`);
  if (ui.conv && convs.has(ui.conv)) chips.push(`<span class="chipf"><span class="sw" style="background:${laneColor(ui.conv)}"></span><span>${esc(convs.get(ui.conv).title)}</span><button data-clear="conv" aria-label="Quitar filtro">${I.x}</button></span>`);
  if (ui.q) chips.push(`<span class="chipf"><span>“${esc(ui.q)}”</span><button data-clear="q" aria-label="Quitar búsqueda">${I.x}</button></span>`);
  const hadFocus = document.activeElement?.id === 'q';
  $('#head').innerHTML = `<div class="titlerow"><span class="em">${esc(emojiOf(t))}</span><h1>${esc(t.name)}</h1><button class="iconbtn" id="edit" aria-label="Editar colección" title="Editar colección">${I.pen}</button>
      <span class="grow"></span><label class="search">${I.search}<input id="q" placeholder="Buscar en ${esc(t.name)}" value="${esc(ui.q)}" aria-label="Buscar"></label>
      <button class="iconbtn" id="themebtn" aria-label="Cambiar tema" title="Cambiar tema">${isDark() ? I.sun : I.moon}</button></div>
    <div class="subrow">${n ? `<span class="newpill">${n} nuevo${n > 1 ? 's' : ''}</span>` : '<span class="mono" style="font-size:12px">Al día</span>'}
      <span>${t.all ? 'Todas tus fuentes' : `${chans} canal${chans === 1 ? '' : 'es'} · ${srcN} fuente${srcN === 1 ? '' : 's'}`}</span>
      ${chips.join('')}<span class="grow"></span>${n ? '<button class="textbtn" id="markread">Marcar como leído</button>' : ''}</div>`;
  if (hadFocus) { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

/* ---------------- river with conversation lanes ---------------- */
let laneIdx = new Map();
const laneColor = (k) => `var(--l${(laneIdx.get(k) ?? 0) % LANE_COLORS})`;

function renderRiver() {
  const t = tray();
  if (!t) {
    $('#head').innerHTML = '';
    $('#scroll').innerHTML = `<div class="empty"><h2>No tienes colecciones</h2><p>Crea una para elegir qué canales quieres leer.</p><button class="btn primary" id="add2">Nueva colección</button></div>`;
    return;
  }
  const all = S.msgs.filter((m) => inTray(t, m));
  const { convOf, convs } = assignConversations(all, { isThread, threadName: (id) => S.chans[id]?.name });
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
  renderHead(t, list, convs);

  if (!t.all && !t.ids.length) {
    $('#scroll').innerHTML = `<div class="empty"><svg width="96" height="72" viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"><path d="M10 60c20 0 26-48 46-48s20 30 30 30"/><path d="M10 60c12 0 18-20 34-20s22 20 42 20"/><circle cx="10" cy="60" r="4"/><circle cx="86" cy="42" r="4"/></svg>
      <h2>Esta colección está vacía</h2><p>Elige de qué fuentes y canales quieres leer. Solo se guardará lo que elijas.</p><button class="btn primary" id="emptyedit">Elegir canales</button></div>`;
    ui.feedKey = null;
    return;
  }
  if (!list.length) {
    $('#scroll').innerHTML = all.length
      ? '<div class="empty"><h2>Nada por aquí</h2><p>Ningún mensaje coincide con los filtros.</p></div>'
      : '<div class="empty"><h2>Todavía no hay mensajes</h2><p>Aparecerán aquí mientras la pestaña de Discord siga abierta.</p></div>';
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

  let html = filtered.length > list.length ? `<div class="more">Mostrando los ${MAX_SHOWN} más recientes de ${filtered.length}. Usa los filtros para ver otros.</div>` : '';
  let lastDay = '';
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString();
  list.forEach((m, i) => {
    const k = convOf.get(m.id), cv = convs.get(k), d = new Date(m.timestamp).toDateString();
    if (d !== lastDay) { html += `<div class="day">${d === today ? 'Hoy' : d === yesterday ? 'Ayer' : esc(new Date(m.timestamp).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`; lastDay = d; }
    const base = baseChannel(m);
    if (first.get(k) === i) {
      const n = list.filter((x) => convOf.get(x.id) === k).length;
      html += `<div class="conv" data-c="${esc(k)}" style="--c:${laneColor(k)}"><button data-focus="${esc(k)}" title="Ver solo esta conversación"><span class="tt">${k.startsWith('thread:') ? 'Hilo · ' : ''}${esc(cv.title)}</span></button>`
        + `<span class="cm">${n} mensaje${n > 1 ? 's' : ''} · #${esc(chanName(base))} · ${esc(guildName(m.guild_id))}</span></div>`;
    }
    const reply = m.reply_to && S.msgs.find((x) => x.id === m.reply_to);
    const link = esc(`https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.id}`);
    const files = (m.attachments ?? []).map((a) => `<div class="file"><span class="ft">${esc((a.filename.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span><div>${esc(a.filename)}<small>no analizado</small></div></div>`).join('');
    const extras = [...(m.stickers ?? []).map((s) => `sticker: ${s}`), m.embeds ? `${m.embeds} embed` : ''].filter(Boolean);
    html += `<div class="entry ${isUnread(t, m) ? 'unread' : ''} ${m.deleted_at ? 'deleted' : ''}" data-c="${esc(k)}">
      ${avatar(m.author, m.guild_id)}
      <div><div class="h"><span class="who">${esc(m.author?.name ?? '?')}</span><span class="t" title="${esc(fmtFull(m.timestamp))}">${hm(m.timestamp)}</span>
        <a class="where" href="${link}" target="_blank" title="Abrir en Discord">${fav(m.guild_id)}#${esc(chanName(base))}${isThread(m.channel_id) ? ` › ${esc(chanName(m.channel_id))}` : ''}</a>
        ${reply ? `<span class="re">↳ ${esc(reply.author?.name ?? '')}</span>` : m.reply_to ? '<span class="re">↳ respuesta</span>' : ''}
        ${m.edited_timestamp ? '<span class="tag">editado</span>' : ''}${m.deleted_at ? '<span class="tag">borrado en Discord</span>' : ''}</div>
      ${m.content ? `<div class="txt">${richText(m.content)}</div>` : ''}${extras.length ? `<div class="tag">${esc(extras.join(' · '))}</div>` : ''}${files}</div>
      <div class="tools"><button data-focus="${esc(k)}" title="Ver solo esta conversación" aria-label="Ver solo esta conversación">${I.focus}</button><a href="${link}" target="_blank" title="Abrir en Discord" aria-label="Abrir en Discord">${I.ext}</a></div></div>`;
  });
  html += `<div class="endcap"><span class="ok">${I.check}</span>Estás al día. Lo nuevo aparecerá aquí abajo.</div>`;

  const sc = $('#scroll');
  const key = `${t.id}|${ui.src}|${ui.conv}|${ui.q}`;
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
  const t = tray();
  ui.edit = { name: t.name, emoji: emojiOf(t), ids: new Set(t.ids), q: '', isNew };
  drawSheet();
  setTimeout(() => { const n = $('#cname'); n?.focus(); if (isNew) n?.select(); }, 40);
}

const listenableChans = () => Object.values(S.chans).filter((c) => c.guild_id && !NOT_LISTENABLE.includes(c.type));
const channelIdsOf = (pred) => listenableChans().filter(pred).map((c) => c.id);

function drawSheet() {
  const e = ui.edit, t = tray(), q = e.q.toLowerCase();
  if ($('#cname')) e.name = $('#cname').value; // keep what was typed across redraws
  const chans = Object.values(S.chans);
  const listenable = listenableChans();
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.name ?? '').localeCompare(b.name ?? '');
  const isNewCh = (c) => t.seen?.length > 0 && !t.seen.includes(c.id);
  const guilds = [...new Set(listenable.map((c) => c.guild_id))].sort((a, b) => guildName(a).localeCompare(guildName(b)));
  const cards = guilds.map((g) => {
    const mine = listenable.filter((c) => c.guild_id === g);
    const shown = mine.filter((c) => !q || (c.name ?? '').toLowerCase().includes(q) || guildName(g).toLowerCase().includes(q));
    if (!shown.length) return '';
    const on = mine.filter((c) => e.ids.has(c.id)).length;
    const pills = (list) => `<div class="pills">${[...list].sort(byPos).map((c) =>
      `<button class="pill ${e.ids.has(c.id) ? 'on' : ''}" data-pill="${esc(c.id)}" aria-pressed="${e.ids.has(c.id)}">#${esc(c.name)}${isNewCh(c) ? '<span class="nw">NUEVO</span>' : ''}</button>`).join('')}</div>`;
    const loose = shown.filter((c) => !S.chans[c.parent_id]);
    const cats = chans.filter((c) => c.guild_id === g && c.type === 4).sort(byPos)
      .map((cat) => [cat, shown.filter((c) => c.parent_id === cat.id)]).filter(([, kids]) => kids.length);
    return `<div class="sc ${on ? 'active' : ''}"><div class="sc-h">${fav(g)}<div><b>${esc(guildName(g))}</b><small>${on ? `${on} de ${mine.length} canales` : `${mine.length} canales`}</small></div>
      <button class="switch ${on === mine.length ? 'on' : on ? 'part' : ''}" data-all="${esc(g)}" role="switch" aria-checked="${on === mine.length}" aria-label="Todos los canales de ${esc(guildName(g))}"></button></div>
      ${loose.length ? `<div class="cg">${pills(loose)}</div>` : ''}
      ${cats.map(([cat, kids]) => `<div class="cg"><button data-cat="${esc(cat.id)}" title="Marcar o desmarcar ${esc(cat.name)}">${esc(cat.name)}</button>${pills(kids)}</div>`).join('')}</div>`;
  }).join('');
  const picker = t.all ? '' : !listenable.length
    ? '<p class="mono" style="color:var(--faint);font-size:13px">Aún no conozco tus servidores. Recarga la pestaña de Discord y vuelve aquí.</p>'
    : `<div><label class="lab" for="sq">Fuentes y canales</label><div class="pickhead"><input class="inp" id="sq" placeholder="Buscar fuente o canal" value="${esc(e.q)}"><span class="selc"><b>${e.ids.size}</b> canales</span></div><div class="srccards">${cards || '<p class="mono" style="color:var(--faint);font-size:13px">Nada coincide con la búsqueda.</p>'}</div></div>`;
  const html = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sht">
    <div class="sh-head"><h2 id="sht">${e.isNew ? 'Nueva colección' : 'Editar colección'}</h2><p>${t.all ? 'Esta colección incluye siempre todas tus fuentes y canales, también los nuevos.' : 'Elige qué canales lees aquí. Lo que no esté en ninguna colección no se guarda.'}</p>
      <button class="iconbtn x" id="sclose" aria-label="Cerrar">${I.x.replace(/12px/g, '16px')}</button></div>
    <div class="sh-body">
      <div><label class="lab" for="cname">Nombre</label><div class="namerow"><button class="emo" id="emo" title="Cambiar icono" aria-label="Cambiar icono">${esc(e.emoji)}</button><input class="inp" id="cname" maxlength="40" value="${esc(e.name)}"></div></div>
      ${picker}
    </div>
    <div class="sh-foot">${e.isNew ? '' : '<button class="btn danger" id="sdel">Eliminar</button>'}<span class="grow"></span><button class="btn ghost" id="scancel">Cancelar</button><button class="btn primary" id="sdone">Listo</button></div>
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
  else if (b.dataset.tray) { ui.tray = b.dataset.tray; ui.src = ui.conv = ui.q = ''; render(); }
  else if (b.dataset.src) { ui.src = ui.src === b.dataset.src ? '' : b.dataset.src; ui.conv = ''; render(); }
  else if (b.dataset.focus) { ui.conv = ui.conv === b.dataset.focus ? '' : b.dataset.focus; ui.hover = null; renderRiver(); }
  else if (b.dataset.clear) { ui[b.dataset.clear] = ''; render(); }
  else if (b.id === 'markread') { tray().readAt = Date.now(); await saveTrays(); toast('Marcado como leído aquí. En Discord no cambia nada.'); }
  else if (b.id === 'themebtn') store.set({ theme: isDark() ? 'light' : 'dark' });
  else if (b.id === 'edit' || b.id === 'emptyedit') openEdit(false);
  else if (b.id === 'add' || b.id === 'add2') {
    const t = { id: `t${Date.now()}`, name: 'Nueva colección', emoji: '📁', all: false, ids: [], seen: [], readAt: 0 };
    S.trays.push(t); ui.tray = t.id; ui.src = ui.conv = ui.q = ''; render(); openEdit(true);
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
    if (e?.isNew) { S.trays = S.trays.filter((t) => t.id !== ui.tray); ui.tray = S.trays[0]?.id ?? null; }
    closeSheet(); render();
  }
  else if (b.id === 'sdone') {
    const t = tray();
    t.name = $('#cname').value.trim() || 'Sin nombre';
    t.emoji = e.emoji;
    if (!t.all) { t.ids = [...e.ids]; t.seen = channelIdsOf(() => true); }
    closeSheet();
    await saveTrays();
    toast(`«${t.name}» lista`);
  }
  else if (b.id === 'sdel') {
    const t = tray();
    if (!confirm(`¿Eliminar la colección «${t.name}»? Los mensajes guardados no se borran.`)) return;
    S.trays = S.trays.filter((x) => x.id !== t.id); ui.tray = S.trays[0]?.id ?? null;
    closeSheet(); await saveTrays();
  }
  else if (b.id === 'clean') {
    const out = S.msgs.filter((m) => !S.trays.some((t) => inTray(t, m)));
    if (!out.length) return toast('No hay mensajes fuera de las colecciones.');
    if (confirm(`¿Borrar ${out.length} mensajes de canales que no están en ninguna colección?`)) await store.remove(out.map((m) => `m:${m.id}`));
  }
  else if (b.id === 'wipe') {
    if (!confirm('¿Borrar todos los mensajes capturados? Las colecciones se conservan.')) return;
    await store.remove(Object.keys(await store.get(null)).filter((k) => /^[me]:|^lastSignal$/.test(k)));
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

let timer;
const refresh = async () => { await load(); render(); };
store.onChanged.addListener(() => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
setInterval(renderSide, 30e3); // keeps "hace X s" and the no-signal warning honest
refresh();
