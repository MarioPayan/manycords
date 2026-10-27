import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { module: { exports: {} }, URL };
vm.runInNewContext(readFileSync('threads.js', 'utf8'), context);
const { laneIndex, assignConversations, readHighWater, readingOrder, markdownTokens, safeLink } = context.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const message = (id, time, channel_id = 'a', extra = {}) => ({ id, channel_id, timestamp: new Date(time).toISOString(), ...extra });

test('stable channel colors, separate thread branches, only in-view explicit replies', () => {
  const rows = [message('a', 10), message('b', 20, 'b', { reply_to: 'a' }), message('thread', 30, 't', { reply_to: 'outside' })];
  const options = { isThread: (id) => id === 't', parentId: () => 'a' };
  const result = assignConversations(rows, options);
  assert.equal(result.convs.size, 3);
  assert.equal(result.convOf.get('b'), 'b', 'cross-channel reply never changes lanes');
  assert.equal(result.convs.get('t').parent_id, 'a');
  assert.deepEqual(plain(result.replies), [{ from: 'a', to: 'b' }]);
  assert.equal(assignConversations(rows.toReversed(), options).convs.get('b').color, laneIndex('b'));
  assert.equal(assignConversations(rows.slice(1), options).convs.get('b').color, laneIndex('b'));
});

test('read high-water stops at every unseen predecessor and advances only forward', () => {
  const rows = [message('a', 10), message('b', 20), message('c', 30)];
  assert.equal(readHighWater(rows, 0, new Set(['b', 'c'])), 0);
  assert.equal(readHighWater(rows.toReversed(), 0, new Set(['a', 'c'])), 10);
  assert.equal(readHighWater(rows, 10, new Set(['b', 'c'])), 30);
  assert.equal(readHighWater(rows, 40, new Set()), 40);
  assert.equal(readHighWater([...rows, message('peer', 20)], 10, new Set(['a', 'b', 'c'])), 10, 'timestamp peers must all be seen');
  assert.equal(readHighWater([...rows, message('peer', 20)], 10, new Set(['b', 'c', 'peer'])), 30);
  assert.equal(readHighWater([...rows, message('hidden-channel', 15, 'other')], 10, new Set(['b', 'c'])), 10, 'filtered-out unread messages still block readAt');
});

test('unread starts at the top, earlier read expands chronologically, all-read ends with fifty', () => {
  const rows = Array.from({ length: 80 }, (_, i) => message(String(i), i + 1));
  const order = readingOrder(rows.toReversed(), 70);
  assert.equal(order.earlier.length, 70);
  assert.deepEqual(plain(order.visible.map((m) => m.id)), rows.slice(70).map((m) => m.id));
  assert.equal(readingOrder(rows, 70, true).visible.length, 80);
  assert.deepEqual(plain(readingOrder(rows, 100).visible.map((m) => m.id)), rows.slice(-50).map((m) => m.id));
  assert.deepEqual(plain(readingOrder([...rows, message('arrival', 90)], 70).unread.map((m) => m.id)), [...rows.slice(70).map((m) => m.id), 'arrival']);
});

test('markdown produces safe DOM-free tokens for Discord formatting', () => {
  const tokens = plain(markdownTokens('**bold** *italic* __under__ ~~gone~~ ||secret|| `a<b`\n```js\n<script>\n```\n> quote\nhttps://example.com/?a=1&b=2 [site](https://example.org) <@123> <#456> <:wave:789>'));
  const types = new Set(tokens.map((token) => token.type));
  for (const type of ['strong', 'em', 'u', 's', 'spoiler', 'code', 'pre', 'blockquote', 'link', 'discord']) assert.ok(types.has(type), type);
  assert.equal(tokens.find((token) => token.type === 'pre').text, '<script>\n');
  assert.equal(tokens.find((token) => token.type === 'code').text, 'a<b');
  assert.deepEqual(plain(markdownTokens('<img src=x onerror=alert(1)> [bad](javascript:alert(1))')), [{ type: 'text', text: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' }]);
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,test'), null);
  assert.equal(safeLink('//example.org'), null);
  assert.equal(safeLink('https://example.org'), 'https://example.org/');
  const nested = plain(markdownTokens('**bold *inside***'));
  assert.equal(nested[0].type, 'strong');
  assert.equal(nested[0].children[1].type, 'em', 'bold can contain italic text');
  assert.ok(!JSON.stringify(tokens).includes('innerHTML'));
});

const luminance = (hex) => {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test('WCAG contrast for actual body text, badges, large text and UI glyph tokens in both themes', () => {
  const source = readFileSync('viewer.html', 'utf8');
  const definitions = [...source.matchAll(/:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?\s*\{([^}]+)/g)];
  assert.equal(definitions.length, 3, 'light, automatic dark and explicit dark');
  for (const block of definitions) {
    const tokens = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((m) => [m[1], m[2]]));
    for (const fg of ['ink', 'soft', 'faint', 'signal', 'unread', 'ok', 'l0', 'l1', 'l2', 'l3', 'l4', 'l5']) {
      for (const bg of ['bg', 'side', 'surface', 'sunk', 'hover']) assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${block[0].slice(0, 35)} ${fg}/${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)}`);
    }
    assert.ok(contrast(tokens['signal-ink'], tokens.signal) >= 4.5, 'signal button text');
    assert.ok(contrast(tokens.bg, tokens.ink) >= 4.5, 'primary button, avatar fallback, selected pill');
    assert.ok(contrast(tokens.ink, tokens.bg) >= 3, 'large heading');
    assert.ok(contrast(tokens.faint, tokens.bg) >= 3, 'UI glyphs');
    // Lane labels use an 11% tinted background, hover increases it to 18%.
    for (const lane of ['l0', 'l1', 'l2', 'l3', 'l4', 'l5']) {
      const mix = (alpha) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(tokens[lane].slice(i + 1, i + 3), 16) * alpha + parseInt(tokens.bg.slice(i + 1, i + 3), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
      assert.ok(contrast(tokens[lane], mix(.18)) >= 4.5, `lane label ${lane} on tinted hover background`);
    }
  }
});

test('viewer builds DOM, declares accessible feed, and uses bundled scripts only', () => {
  const source = readFileSync('viewer.js', 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(source, /'aria-posinset'/);
  assert.match(source, /'aria-setsize'/);
  assert.match(source, /role: 'feed'/);
  assert.match(source, /rel: 'noopener noreferrer'/);
  assert.doesNotMatch(source + readFileSync('threads.js', 'utf8') + readFileSync('viewer.html', 'utf8'), /[^\x00-\x7f]/);
});
