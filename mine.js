// Pure "concerns me" rules, shared by the background (badge, notifications) and the reader (filter, marker).
// A captured message is mine when someone else wrote it and it mentions me, replies to me, matches one of my
// keywords, or (only when that setting is on) mentions @everyone/@here.
const foldText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let keywordCache = { key: null, patterns: [] };
// Case- and accent-insensitive whole-word patterns; a keyword may be a phrase.
function keywordPatterns(keywords = []) {
  const key = JSON.stringify(keywords);
  if (keywordCache.key !== key) {
    const words = [...new Set(keywords.map((word) => foldText(word).trim().replace(/\s+/g, ' ')).filter(Boolean))];
    keywordCache = { key, patterns: words.map((word) => new RegExp(`(?<![\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u')) };
  }
  return keywordCache.patterns;
}
function matchesKeyword(text, keywords) {
  const folded = foldText(text);
  return keywordPatterns(keywords).some((pattern) => pattern.test(folded));
}
// embeds is a count in older rows and may be an array of { title, description } in newer ones.
const embedTexts = (embeds) => Array.isArray(embeds) ? embeds.flatMap((embed) => [embed?.title, embed?.description]).filter((text) => typeof text === 'string') : [];
// `original` is the stored message that `reply_to` points at, when there is one.
function isMine(message, { selfId, keywords = [], everyone = false, original } = {}) {
  if (!message) return false;
  if (selfId && message.author?.id === selfId) return false;
  if (selfId && (message.mentions?.includes(selfId) || message.reply_to_author === selfId
    || (message.reply_to && original?.id === message.reply_to && original.author?.id === selfId))) return true;
  if (everyone && message.mention_everyone === true) return true;
  return keywords.length > 0 && [message.content, ...embedTexts(message.embeds)].some((text) => text && matchesKeyword(text, keywords));
}
// Settings as stored: keywords trimmed, folded duplicates removed, at most 50 of at most 40 characters.
function cleanKeywords(list) {
  const seen = new Set(), result = [];
  for (const word of Array.isArray(list) ? list : []) {
    const value = String(word ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), folded = foldText(value);
    if (value && !seen.has(folded) && result.length < 50) { seen.add(folded); result.push(value); }
  }
  return result;
}
const badgeText = (count) => count > 99 ? '99+' : count > 0 ? String(count) : '';
// Notification text without Discord markup: mentions resolve through the callbacks, formatting symbols go.
function plainText(content, { user = () => '', channel = () => '', limit = 140 } = {}) {
  const text = String(content ?? '')
    .replace(/<@!?(\d+)>/g, (_, id) => `@${user(id) ?? ''}`).replace(/<@&\d+>/g, '@').replace(/<#(\d+)>/g, (_, id) => `#${channel(id) ?? ''}`)
    .replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/```[^\n`]*\n?|`|\*\*|__|~~|\|\||^>+ ?/gm, '').replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}\u2026` : text;
}
if (typeof module !== 'undefined') module.exports = { foldText, matchesKeyword, isMine, cleanKeywords, badgeText, plainText };
