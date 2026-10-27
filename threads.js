// Pure reader models. Channels determine lanes; replies are only secondary arcs.
function laneIndex(id, count = 6) {
  return [...String(id)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % count;
}
function assignConversations(messages, { isThread = () => false, threadName = () => null, channelName = () => null, parentId = () => null, noText = '' } = {}) {
  const convOf = new Map(), convs = new Map(), replies = [];
  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || String(a.id).localeCompare(String(b.id)));
  const ids = new Set(sorted.map((m) => m.id));
  for (const m of sorted) {
    const id = m.channel_id;
    if (!convs.has(id)) convs.set(id, { id, channel_id: id, parent_id: isThread(id) ? parentId(id) : null,
      title: (isThread(id) ? threadName(id) : channelName(id)) ?? noText, color: laneIndex(id), first: Date.parse(m.timestamp), count: 0 });
    const lane = convs.get(id);
    lane.last = Date.parse(m.timestamp); lane.count++;
    convOf.set(m.id, id);
    if (m.reply_to && ids.has(m.reply_to) && m.reply_to !== m.id) replies.push({ from: m.reply_to, to: m.id });
  }
  return { convOf, convs, replies };
}

// Timestamp peers advance together: readAt cannot represent part of a timestamp.
function readHighWater(messages, readAt, seen) {
  const groups = new Map();
  for (const m of messages) {
    const time = Date.parse(m.timestamp);
    if (time > readAt) { if (!groups.has(time)) groups.set(time, []); groups.get(time).push(m.id); }
  }
  let next = readAt;
  for (const [time, ids] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (!ids.every((id) => seen.has(id))) break;
    next = time;
  }
  return next;
}
function readingOrder(messages, readAt, expanded = false) {
  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || String(a.id).localeCompare(String(b.id)));
  const earlier = sorted.filter((m) => Date.parse(m.timestamp) <= readAt);
  const unread = sorted.filter((m) => Date.parse(m.timestamp) > readAt);
  return { earlier, unread, visible: unread.length ? [...(expanded ? earlier : []), ...unread] : earlier.slice(-50) };
}
function safeLink(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
// DOM-free tokens. No message text ever becomes markup or attribute names.
function markdownTokens(value, depth = 0) {
  const text = String(value ?? '');
  if (depth > 16) return [{ type: 'text', text }];
  const tokens = [];
  const pattern = /```(?:[^\n`]*\n)?([\s\S]*?)```|`([^`\n]+)`|^> ?([^\n]*)|\*\*([\s\S]+?)\*\*(?!\*)|__([\s\S]+?)__(?!_)|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\||\*([^*\n]+)\*|\b_([^_\n]+)_|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>]+|<(@!?\d+|@&\d+|#\d+|a?:\w+:\d+)>|@(everyone|here)\b/gm;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) tokens.push({ type: 'text', text: text.slice(end, match.index) });
    const [raw, block, code, quote, bold, underline, strike, spoiler, italic, underscore, label, href, discord, broadcast] = match;
    if (block !== undefined || code !== undefined) tokens.push({ type: block !== undefined ? 'pre' : 'code', text: block ?? code });
    else if (href) tokens.push({ type: 'link', href: safeLink(href), children: markdownTokens(label, depth + 1) });
    else if (/^https?:/.test(raw)) {
      const url = raw.replace(/[.,!?;:]+$/, '');
      tokens.push({ type: 'link', href: safeLink(url), children: [{ type: 'text', text: url }] });
      if (url.length < raw.length) tokens.push({ type: 'text', text: raw.slice(url.length) });
    } else if (discord || broadcast) tokens.push({ type: 'discord', text: discord ?? broadcast });
    else {
      const fields = [['blockquote', quote], ['strong', bold], ['u', underline], ['s', strike], ['spoiler', spoiler], ['em', italic ?? underscore]];
      const [type, content] = fields.find(([, content]) => content !== undefined);
      tokens.push({ type, children: markdownTokens(content, depth + 1) });
    }
    end = match.index + raw.length;
  }
  if (end < text.length) tokens.push({ type: 'text', text: text.slice(end) });
  return tokens;
}
if (typeof module !== 'undefined') module.exports = { assignConversations, laneIndex, readHighWater, readingOrder, markdownTokens, safeLink };
