import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { isMine, matchesKeyword, cleanKeywords, badgeText, plainText } = createRequire(import.meta.url)('../mine.js');
const SELF = '900';
const msg = (extra = {}) => ({ id: 'm', channel_id: 'c', author: { id: 'u', name: 'Ana' }, content: '', ...extra });

test('mentions and replies to the user are mine; the user\'s own messages never are', () => {
  assert.equal(isMine(msg({ mentions: ['1', SELF] }), { selfId: SELF }), true);
  assert.equal(isMine(msg({ mentions: ['1'] }), { selfId: SELF }), false);
  assert.equal(isMine(msg({ mentions: [SELF] }), {}), false, 'no own id yet: mentions cannot be resolved');
  const original = { id: 'o', author: { id: SELF } };
  assert.equal(isMine(msg({ reply_to: 'o' }), { selfId: SELF, original }), true, 'reply to a stored own message');
  assert.equal(isMine(msg({ reply_to: 'o' }), { selfId: SELF, original: { id: 'o', author: { id: '2' } } }), false);
  assert.equal(isMine(msg({ reply_to: 'x' }), { selfId: SELF, original }), false, 'the original must be the replied message');
  assert.equal(isMine(msg({ reply_to: 'gone', reply_to_author: SELF }), { selfId: SELF }), true, 'reply author captured from the gateway');
  assert.equal(isMine(msg({ author: { id: SELF }, mentions: [SELF], content: 'deploy' }), { selfId: SELF, keywords: ['deploy'], everyone: true }), false, 'own messages are excluded from every rule');
  assert.equal(isMine(null, { selfId: SELF }), false);
});

test('@everyone and @here count only behind their setting', () => {
  assert.equal(isMine(msg({ mention_everyone: true }), { selfId: SELF }), false);
  assert.equal(isMine(msg({ mention_everyone: true }), { selfId: SELF, everyone: true }), true);
  assert.equal(isMine(msg({ content: '@everyone' }), { selfId: SELF, everyone: true }), false, 'the captured flag decides, not the text');
});

test('keywords match whole words, ignoring case and accents, in content and embed text', () => {
  assert.equal(matchesKeyword('The NEW Canción is out', ['cancion']), true);
  assert.equal(matchesKeyword('la cancion nueva', ['Canción']), true);
  assert.equal(matchesKeyword('Patchwork and dispatch', ['patch']), false, 'no partial words');
  assert.equal(matchesKeyword('patch_notes', ['patch']), false, 'underscore joins a word');
  assert.equal(matchesKeyword('(patch), patch!', ['patch']), true);
  assert.equal(matchesKeyword('ñandú', ['nandu']), true);
  assert.equal(matchesKeyword('Game Jam this weekend', ['game  jam']), true, 'phrases with any spacing');
  assert.equal(matchesKeyword('we love c++ here', ['c++']), true, 'regex characters are literal');
  assert.equal(matchesKeyword('we love c here', ['c++']), false);
  assert.equal(matchesKeyword('anything', []), false);
  assert.equal(isMine(msg({ content: 'Release DAY' }), { keywords: ['release'] }), true, 'keywords work before the own id is known');
  assert.equal(isMine(msg({ embeds: [{ title: 'Server maintenance', description: 'Tonight' }] }), { keywords: ['maintenance'] }), true, 'embed title');
  assert.equal(isMine(msg({ embeds: [{ title: 'x', description: 'A RELEASE' }] }), { keywords: ['release'] }), true, 'embed description');
  assert.equal(isMine(msg({ embeds: 2 }), { keywords: ['release'] }), false, 'older rows keep only an embed count');
  assert.equal(isMine(msg({ embeds: [null, { title: 3 }] }), { keywords: ['release'] }), false, 'malformed embeds are ignored');
});

test('stored keywords, badge text and notification plain text', () => {
  assert.deepEqual(cleanKeywords(['  Patch ', 'patch', 'Canción', 'cancion', '', null, 'a'.repeat(60)]), ['Patch', 'Canción', 'a'.repeat(40)]);
  assert.equal(cleanKeywords(Array.from({ length: 80 }, (_, i) => `w${i}`)).length, 50);
  assert.deepEqual(cleanKeywords('patch'), []);
  assert.deepEqual([0, 1, 99, 100, 5000].map(badgeText), ['', '1', '99', '99+', '99+']);
  assert.equal(plainText('**Bold** *it* _also_ __under__ ~~gone~~ ||spoiler|| `code` [label](https://example.org) <:wave:1> <@&5>'), 'Bold it also under gone spoiler code label :wave: @');
  assert.equal(plainText('> quoted\n```js\nlet a\n```'), 'quoted let a');
  assert.equal(plainText('<@1> in <#2>', { user: () => 'Ana', channel: () => 'news' }), '@Ana in #news');
  assert.equal(plainText('<@1> in <#2>'), '@ in #');
  assert.equal(plainText('x'.repeat(300)).length, 140);
  assert.equal(plainText('snake_case_name stays'), 'snake_case_name stays');
});

test('the matcher is a plain ASCII script shared by background and reader', () => {
  const source = readFileSync(new URL('../mine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[^\x00-\x7f]/);
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.background.scripts.indexOf('mine.js') < manifest.background.scripts.indexOf('background.js'));
  assert.ok(manifest.permissions.includes('notifications'));
  assert.match(readFileSync(new URL('../background.js', import.meta.url), 'utf8'), /importScripts\([^)]*'mine\.js'/);
  const html = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="mine.js"') > 0 && html.indexOf('src="mine.js"') < html.indexOf('src="viewer.js"'));
  assert.match(readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8'), /'mine\.js'/);
});
