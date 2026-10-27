// Groups messages into conversations with four rules, first match wins:
//   1. reply      — a Discord reply joins the replied message's conversation
//   2. thread     — every message inside a Discord thread is one conversation
//   3. follow-up  — a mention of someone who just spoke, or the author speaking again, joins that conversation
//   4. silence    — conversations idle for IDLE ms cannot be joined by rule 3; anything unmatched starts a new one
// Pure function: shared by the viewer and design/prototype.html (inlined there), tested by test.mjs.
const IDLE = 10 * 60e3;

function assignConversations(msgs, { isThread = () => false, threadName = () => null } = {}) {
  const sorted = [...msgs].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const convOf = new Map(); // message id -> conversation id
  const convs = new Map(); // conversation id -> { id, channel_id, title, first, last, count, rule }
  const lastByAuthor = new Map(); // `${channel}|${author}` -> conversation id
  const touch = (c, m, rule) => {
    convOf.set(m.id, c.id);
    c.last = Date.parse(m.timestamp);
    c.count++;
    c.rules[rule] = (c.rules[rule] ?? 0) + 1;
    lastByAuthor.set(`${m.channel_id}|${m.author?.id}`, c.id);
  };
  const open = (id, m, title) => {
    const c = { id, channel_id: m.channel_id, title, first: Date.parse(m.timestamp), last: 0, count: 0, rules: {} };
    convs.set(id, c);
    return c;
  };
  const live = (id, t) => id && convs.has(id) && t - convs.get(id).last <= IDLE ? convs.get(id) : null;

  for (const m of sorted) {
    const t = Date.parse(m.timestamp);
    if (m.reply_to && convOf.has(m.reply_to)) { touch(convs.get(convOf.get(m.reply_to)), m, 'reply'); continue; }
    if (isThread(m.channel_id)) {
      const id = `thread:${m.channel_id}`;
      touch(convs.get(id) ?? open(id, m, threadName(m.channel_id) ?? excerpt(m.content)), m, 'thread');
      continue;
    }
    const mentioned = (m.mentions ?? []).map((u) => live(lastByAuthor.get(`${m.channel_id}|${u}`), t)).find(Boolean);
    const followUp = mentioned ?? live(lastByAuthor.get(`${m.channel_id}|${m.author?.id}`), t);
    if (followUp) { touch(followUp, m, mentioned ? 'mention' : 'author'); continue; }
    touch(open(`c:${m.id}`, m, excerpt(m.content)), m, 'new');
  }
  return { convOf, convs };
}

const excerpt = (s = '') => {
  const clean = s.replace(/<a?(:\w+:)\d+>/g, '$1').replace(/\s+/g, ' ').trim();
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean || 'Sin texto';
};

if (typeof module !== 'undefined') module.exports = { assignConversations, IDLE };
