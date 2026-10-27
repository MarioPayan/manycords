// Runs inside Discord's page (MAIN world). The web client decodes every gateway
// frame with JSON.parse (ETF is desktop-only), so wrapping it sees all events
// whatever the socket compression is, without touching the socket.
(() => {
  const parse = JSON.parse;
  let lastAlive = -Infinity;
  const samples = [];
  const send = (kind, data) => window.postMessage({ 'discord-feed': true, kind, data }, location.origin);

  const pickMessage = (d) => ({
    id: d.id,
    channel_id: d.channel_id,
    guild_id: d.guild_id ?? null,
    author: d.author && { id: d.author.id, name: d.member?.nick || d.author.global_name || d.author.username, avatar: d.author.avatar, member_avatar: d.member?.avatar },
    content: d.content,
    timestamp: d.timestamp,
    edited_timestamp: d.edited_timestamp,
    reply_to: d.message_reference?.message_id,
    mentions: d.mentions?.map((u) => u.id),
    attachments: d.attachments?.map((a) => ({ filename: a.filename, url: a.url,
      proxy_url: a.proxy_url, content_type: a.content_type, width: a.width, height: a.height, size: a.size })),
    embeds: d.embeds?.length,
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
  // Liveness comes only from gateway frames, including heartbeat acknowledgements.
  const pulse = () => {
    const now = Date.now();
    if (now - lastAlive >= 60e3) {
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
