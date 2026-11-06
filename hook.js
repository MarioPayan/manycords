// Runs inside Discord's page (MAIN world). The web client decodes every gateway
// frame with JSON.parse (ETF is desktop-only), so wrapping it sees all events
// whatever the socket compression is, without touching the socket.
(() => {
  const parse = JSON.parse;
  let lastAlive = -Infinity;
  const samples = [];
  const send = (kind, data) => window.postMessage({ 'discord-feed': true, kind, data }, location.origin);

  // Embeds keep only what the reader draws. Media keep Discord's own proxy copy, never the third-party url
  // (a video keeps its url only as a link target); anything outside Discord's image hosts is dropped.
  const MEDIA_HOSTS = ['media.discordapp.net', 'images-ext-1.discordapp.net', 'images-ext-2.discordapp.net', 'cdn.discordapp.com'];
  const text = (value, max) => typeof value === 'string' && value ? value.slice(0, max) : undefined;
  const web = (value) => typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= 2048 ? value : undefined;
  const size = (value) => Number.isFinite(value) && value > 0 ? value : undefined;
  const media = (m, keepUrl) => {
    let proxy;
    try { proxy = m?.proxy_url && new URL(m.proxy_url); } catch {}
    const proxy_url = proxy && proxy.protocol === 'https:' && MEDIA_HOSTS.includes(proxy.hostname) ? proxy.href : undefined;
    const url = keepUrl ? web(m?.url) : undefined;
    return proxy_url || url ? { proxy_url, url, width: size(m.width), height: size(m.height) } : undefined;
  };
  const pickEmbed = (e) => ({
    type: text(e?.type, 32),
    url: web(e?.url),
    title: text(e?.title, 256),
    description: text(e?.description, 2000),
    color: Number.isInteger(e?.color) && e.color >= 0 && e.color <= 0xffffff ? e.color : undefined,
    author: e?.author?.name ? { name: text(e.author.name, 256), url: web(e.author.url) } : undefined,
    provider: e?.provider?.name ? { name: text(e.provider.name, 256) } : undefined,
    footer: e?.footer?.text ? { text: text(e.footer.text, 2048) } : undefined,
    fields: Array.isArray(e?.fields) && e.fields.length ? e.fields.slice(0, 10).map((f) => ({ name: text(f?.name, 256), value: text(f?.value, 1024), inline: f?.inline === true })) : undefined,
    image: media(e?.image),
    thumbnail: media(e?.thumbnail),
    video: media(e?.video, true),
  });

  const pickMessage = (d) => ({
    id: d.id,
    channel_id: d.channel_id,
    guild_id: d.guild_id ?? null,
    author: d.author && { id: d.author.id, name: d.member?.nick || d.author.global_name || d.author.username, avatar: d.author.avatar, member_avatar: d.member?.avatar },
    content: d.content,
    timestamp: d.timestamp,
    edited_timestamp: d.edited_timestamp,
    reply_to: d.message_reference?.message_id,
    reply_author: d.referenced_message?.author && (d.referenced_message.member?.nick || d.referenced_message.author.global_name || d.referenced_message.author.username),
    mentions: d.mentions?.map((u) => u.id),
    attachments: d.attachments?.map((a) => ({ filename: a.filename, url: a.url,
      proxy_url: a.proxy_url, content_type: a.content_type, width: a.width, height: a.height, size: a.size })),
    // Absent on partial updates, so a stored list survives; an update that carries the key replaces it.
    embeds: Array.isArray(d.embeds) ? d.embeds.slice(0, 10).map(pickEmbed) : undefined,
    stickers: d.sticker_items?.map((s) => s.name),
  });
  const channel = (c, g = {}) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    position: c.position,
    parent_id: c.parent_id ?? null,
    guild_id: c.guild_id ?? g.id ?? null,
    guild_name: g.name ?? g.properties?.name,
    guild_icon: g.icon ?? g.properties?.icon,
  });
  const channelsOf = (g) => [...(g.channels ?? []), ...(g.threads ?? [])].map((c) => channel(c, g));

  const handle = ({ op, t, d }) => {
    if (op === 0) switch (t) {
      case 'MESSAGE_CREATE': {
        const malformed = !d || typeof d.id !== 'string' || !d.id
          || typeof d.channel_id !== 'string' || !d.channel_id
          || typeof d.timestamp !== 'string' || !Number.isFinite(Date.parse(d.timestamp));
        samples.push(malformed);
        if (samples.length > 50) samples.shift();
        send('validation', { malformed: samples.filter(Boolean).length, total: samples.length });
        if (!malformed) send('message', pickMessage(d));
        break;
      }
      case 'MESSAGE_UPDATE':
        send('message', pickMessage(d));
        break;
      case 'MESSAGE_DELETE':
        send('delete', { id: d.id, channel_id: d.channel_id, guild_id: d.guild_id ?? null });
        break;
      case 'READY':
        send('ready', null); // new session: events since the last one are NOT replayed
        send('channels', (d.guilds ?? []).flatMap(channelsOf));
        break;
      case 'RESUMED':
        send('resumed', null); // Discord replayed what was missed
        break;
      case 'GUILD_CREATE':
        send('channels', channelsOf(d));
        break;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE':
        send('channels', [channel(d)]);
        break;
      case 'THREAD_LIST_SYNC':
        send('channels', (d.threads ?? []).map((c) => channel(c)));
        break;
    }
  };
  // Liveness comes only from gateway frames, including heartbeat acknowledgements (about every 41 s on a quiet channel).
  // ponytail: 15 s throttle; each alive bumps the viewer's rev, so lower it only if that reload is cheap.
  const pulse = () => {
    const now = Date.now();
    if (now - lastAlive >= 15e3) {
      lastAlive = now;
      send('alive', null);
    }
  };

  JSON.parse = function (text, reviver) {
    const r = parse.call(this, text, reviver);
    try {
      if (r && typeof r === 'object' && 'op' in r && 't' in r && 's' in r) {
        // Elect a leader before a first message; READY must still precede ALIVE
        // so the session gap reads the previous lastSignal.
        if (r.t !== 'READY') pulse();
        try { handle(r); } finally { if (r.t === 'READY') pulse(); }
      }
      else if (Array.isArray(r) && r.length && r.every((message) => message
        && typeof message.id === 'string' && message.id
        && typeof message.channel_id === 'string' && message.channel_id
        && message.author && typeof message.author.id === 'string'
        && typeof message.timestamp === 'string' && Number.isFinite(Date.parse(message.timestamp))
        && typeof message.content === 'string')) send('history', r.map(pickMessage));
    } catch (e) {
      console.warn('[discord-feed]', e);
    }
    return r;
  };
})();
