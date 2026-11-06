// HTTP harness adapted from the approved reference: fake browser API, real database and reader UI.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
    let body = await readFile(path);
    if (pathname === '/viewer.html') body = body.toString().replace('<script src="viewer.js"></script>', '<script src="test/e2e/viewer-shim.js"></script><script src="viewer.js"></script>');
    if (pathname === '/viewer.js') body = `window.fixtureReady.then(() => {\n${body}\n});`;
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2' }[extname(path)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
// Reading flow: every section gets a fresh fixture. All run even if one fails, so a regression names each broken behaviour.
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done)))));
const arrive = (page, id, extra = {}) => page.evaluate(async ([id, extra]) => {
  window.arrivalClock = (window.arrivalClock ?? Date.now() + 1000) + 1000;
  await feedDB.writeMessage({ id, channel_id: 'gen', guild_id: 'g1', timestamp: new Date(window.arrivalClock).toISOString(), author: { id: '1', name: 'Nico' }, content: `Arrival ${id}`, ...extra });
  const { rev } = await browser.storage.local.get('rev');
  await browser.storage.local.set({ rev: rev + 1 });
}, [id, extra]);
const bump = (page) => page.evaluate(async () => {
  const count = viewerQueries.length, { rev } = await browser.storage.local.get('rev');
  await browser.storage.local.set({ rev: rev + 1 });
  while (viewerQueries.length === count) await new Promise((done) => setTimeout(done, 10));
  await new Promise((done) => setTimeout(done, 100));
});
const entryIds = (page) => page.$$eval('.entry', (nodes) => nodes.map((node) => node.dataset.id));
const edgeGap = (page, direction) => page.locator('#scroll').evaluate((s, direction) => direction === 'top' ? s.scrollTop : s.scrollHeight - s.clientHeight - s.scrollTop, direction);
const atEdge = (page, direction, message) => page.waitForFunction((direction) => { const s = document.querySelector('#scroll'); return (direction === 'top' ? s.scrollTop : s.scrollHeight - s.clientHeight - s.scrollTop) <= 2; }, direction).catch(() => assert.fail(message));
// Like a reader: reach the newest edge, then move away from it by `distance`.
const scrollTo = async (page, direction, distance) => {
  for (const offset of distance ? [0, distance] : [0]) {
    await page.locator('#scroll').evaluate((s, [direction, offset]) => { s.scrollTop = direction === 'top' ? offset : s.scrollHeight - s.clientHeight - offset; }, [direction, offset]);
    await settle(page);
  }
};
// A visible entry as a position reference.
const reference = (page) => page.evaluate(() => {
  const bounds = document.querySelector('#scroll').getBoundingClientRect();
  const node = [...document.querySelectorAll('.entry')].find((entry) => entry.getBoundingClientRect().top >= bounds.top + 40);
  return { id: node.dataset.id, top: node.getBoundingClientRect().top, scrollTop: document.querySelector('#scroll').scrollTop };
});
const topOf = (page, id) => page.locator(`.entry[data-id="${id}"]`).evaluate((node) => node.getBoundingClientRect().top);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);
const setDirection = async (page, direction) => { await page.evaluate((direction) => browser.storage.local.set({ readingDirection: direction }), direction); await page.waitForFunction((direction) => document.querySelector('#direction').value === direction, direction); await settle(page); };
// An attachment with no recorded size, whose image arrives late and grows the feed. Later than the one second a
// visible message needs to count as seen, so no read-state render can hide a missing reaction to the growth.
const lateImage = async (page, name) => {
  await page.route(`https://cdn.discordapp.com/attachments/**/${name}*`, async (route) => { await new Promise((done) => setTimeout(done, 2000)); await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"/>' }); });
  return { content: name, attachments: [{ filename: name, content_type: 'image/png', url: `https://cdn.discordapp.com/attachments/1/2/${name}` }] };
};
// Fixture people ids follow viewer-shim.js: Tito is person 2.
const TITO = String(1300000000000000000n + 2n * 4194304n);
const SHOTS = process.env.MINE_SHOTS;
const shot = async (page, name, options = {}) => {
  if (!SHOTS) return;
  const scheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  await settle(page); await page.screenshot({ path: resolve(SHOTS, `mine-${name}-${scheme}.png`), ...options });
};
const signalColor = (page) => page.evaluate(() => { const node = document.createElement('i'); node.style.color = 'var(--signal)'; document.body.append(node); const value = getComputedStyle(node).color; node.remove(); return value; });
const caughtUp = async (page) => { await page.click('#markread'); await page.waitForFunction(() => document.querySelectorAll('.entry').length >= 50); await settle(page); };
const sections = {
  async 'only mine filters the feed, combines with search and marks mine messages'(page) {
    await page.evaluate((self) => browser.storage.local.set({ selfId: self, keywords: ['Rerun'] }), TITO);
    // m9 matches the keyword in the unread block; Tito's own m8 never counts.
    await page.waitForFunction(() => document.querySelector('.entry[data-id="m9"]')?.classList.contains('mine'));
    assert.deepEqual(await page.$$eval('.entry.mine', (nodes) => nodes.map((node) => node.dataset.id)), ['m9'], 'only m9 is marked in the unread block');
    const marker = await page.locator('.entry[data-id="m9"] .who').evaluate((node) => getComputedStyle(node, '::before').backgroundColor);
    assert.equal(marker, await signalColor(page), 'the marker uses the accent');
    const chip = page.locator('#onlymine');
    assert.equal(await chip.getAttribute('aria-pressed'), 'false');
    await chip.click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 1);
    assert.equal(await chip.getAttribute('aria-pressed'), 'true');
    // Like every filter, the feed key resets the reading order: the unread mine message first, read ones collapsed.
    assert.deepEqual(await entryIds(page), ['m9'], 'only the unread mine message opens');
    await shot(page, 'head', { clip: { x: 272, y: 0, width: 1088, height: 200 } });
    await page.locator('.earlier').click();
    // Keyword in m0 and m9, mention of the user in m4; Tito's own messages never count.
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 3);
    assert.deepEqual(await entryIds(page), ['m9', 'm4', 'm0'], 'only mine, newest first');
    assert.equal(await page.locator('.entry:not(.mine)').count(), 0);
    await page.locator('#q').fill('rerun');
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 1 && document.querySelector('.earlier'));
    await page.locator('.earlier').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 2);
    assert.deepEqual(await entryIds(page), ['m9', 'm0'], 'combines with search');
    await page.locator('[data-clear="q"]').click();
    await page.locator('[data-src="g2"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 0);
    await page.locator('[data-src="g2"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 1);
    await chip.click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 8);
    assert.equal(await chip.getAttribute('aria-pressed'), 'false', 'off again: the unread block returns');
    await arrive(page, 'all-hands', { mention_everyone: true });
    await page.locator('.entry[data-id="all-hands"]').waitFor();
    assert.equal(await page.locator('.entry[data-id="all-hands"]').evaluate((node) => node.classList.contains('mine')), false, '@everyone is off by default');
    await page.evaluate(() => browser.storage.local.set({ mineEveryone: true }));
    await page.waitForFunction(() => document.querySelector('.entry[data-id="all-hands"]').classList.contains('mine'));
    assert.equal(await page.locator('.entry[data-id="m13"]').evaluate((node) => node.classList.contains('mine')), false, 'the @everyone text alone is not the captured flag');
  },
  async 'the keyword editor saves words, toggles and the marker follows'(page) {
    await page.click('#menubtn');
    assert.equal(await page.locator('#notify').isChecked(), true, 'Notify me defaults on');
    assert.equal(await page.locator('#mine-everyone').isChecked(), false, '@everyone defaults off');
    await page.locator('#notify').click();
    await page.waitForFunction(async () => (await browser.storage.local.get('notify')).notify === false);
    await page.locator('#mine-everyone').click();
    await page.waitForFunction(async () => (await browser.storage.local.get('mineEveryone')).mineEveryone === true);
    await page.click('#keywords');
    await page.locator('#kw-input').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'kw-input', 'the editor focuses its input');
    assert.equal(await page.locator('#overlay .health-copy').count(), 1, 'without an own id, the editor says only keywords count');
    await page.locator('#kw-input').fill('WEEKEND');
    await page.click('#kw-add');
    await page.locator('#kw-input').fill('jam');
    await page.keyboard.press('Enter');
    await page.locator('#kw-input').fill('weekend');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#kw-list .chipf').length === 2);
    assert.deepEqual(await page.evaluate(async () => (await browser.storage.local.get('keywords')).keywords), ['WEEKEND', 'jam'], 'saved, duplicates folded');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'kw-input', 'adding keeps the input focused');
    await shot(page, 'keywords');
    await page.locator('[data-kw-remove="jam"]').click();
    await page.locator('#kw-input').fill('Maintenance');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => (await browser.storage.local.get('keywords')).keywords.join() === 'WEEKEND,Maintenance');
    await page.locator('#overlay .btn.primary').click();
    assert.equal(await page.locator('#overlay').count(), 0);
    // "Game jam this weekend." and "Maintenance starts at 08:30." are unread and now mine.
    await page.waitForFunction(() => document.querySelectorAll('.entry.mine').length === 2);
    assert.deepEqual(await page.$$eval('.entry.mine', (nodes) => nodes.map((node) => node.dataset.id)), ['m14', 'm13']);
    await page.mouse.move(0, 0);
    await shot(page, 'feed', { clip: { x: 272, y: 0, width: 1088, height: 640 } });
  },
  async 'a notification link opens the reader on its message'(page) {
    const reader = await page.context().newPage();
    try {
      await reader.route('https://cdn.discordapp.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' }));
      const lang = new URL(page.url()).searchParams.get('lang');
      // m3 is read and older than the unread block, so the reader must expand the earlier messages to show it.
      await reader.goto(`http://127.0.0.1:${server.address().port}/viewer.html?lang=${lang}&consented=1&m=m3`);
      await reader.waitForFunction(() => document.activeElement?.dataset?.id === 'm3');
      assert.ok(await reader.locator('.entry[data-id="m3"]').evaluate((node) => { const box = node.getBoundingClientRect(), scroll = document.querySelector('#scroll').getBoundingClientRect(); return box.top >= scroll.top && box.bottom <= scroll.bottom; }), 'the message is in view');
    } finally { await reader.close(); }
  },
  async 'hover dims other conversations without flashing'(page) {
    const hovered = await page.locator('.entry[data-id="m13"]').getAttribute('data-c');
    await page.locator('.entry[data-id="m13"]').hover();
    await page.waitForTimeout(300);
    const states = await page.$$eval('.river .entry, .river .conv', (nodes) => nodes.map((node) => [node.dataset.c, getComputedStyle(node).opacity]));
    assert.ok(states.some(([c]) => c !== hovered), 'the fixture has another conversation to dim');
    for (const [c, opacity] of states) assert.equal(opacity === '1', c === hovered, `conversation ${c} has opacity ${opacity}`);
    assert.equal(await page.locator('.entry[data-id="m13"] .tools').isVisible(), true, 'the hovered message still shows its tools');
    await page.locator('.entry[data-id="m13"] [data-focus]').click();
    assert.deepEqual(await entryIds(page), ['m13'], 'the focus button still filters to the channel');
    await page.locator('[data-clear="conv"]').click();
    assert.equal(await page.locator('.entry').count(), 8);
    // The pointer crosses margins and day separators between messages; none of them may undim the feed.
    await page.locator('.river .entry').first().hover();
    const start = await page.locator('.river .entry').first().boundingBox(), box = await page.locator('.river').boundingBox(), dimmed = () => page.$$eval('.river .dim', (nodes) => nodes.length);
    for (let y = start.y + 4; y < Math.min(box.y + box.height, 840); y += 3) { await page.mouse.move(box.x + 120, y); assert.ok(await dimmed() > 0, `nothing dimmed at y=${y}`); }
  },
  async 'revisions and read state keep every node, scroll, focus and typed text'(page) {
    await page.setViewportSize({ width: 1360, height: 500 });
    await arrive(page, 'pic', { content: '||hidden||', attachments: [{ filename: 'a.png', content_type: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/a.png', width: 1000, height: 500 }] });
    await page.locator('.entry[data-id="pic"]').waitFor();
    const size = await page.locator('.thumbnail').evaluate((node) => [node.offsetWidth, node.offsetHeight]);
    assert.deepEqual(size, [320, 160], 'the thumbnail box is reserved from the capture dimensions');
    await page.locator('.spoiler').click();
    // A space matches every message, so the whole feed stays on screen with text typed in the search box.
    await page.locator('#q').pressSequentially(' ');
    await settle(page);
    await page.locator('#scroll').evaluate((s) => { s.scrollTop = 60; });
    await settle(page);
    await page.evaluate(() => {
      window.tracked = [...document.querySelectorAll('.entry, .entry img, #side img, .pulse, .conv, .day, #q, #scroll .river')];
      window.removed = 0;
      new MutationObserver((records) => { for (const record of records) if (!record.target.closest?.('.graph')) window.removed += record.removedNodes.length; }).observe(document.querySelector('#scroll'), { childList: true, subtree: true });
      window.pulseStart = document.querySelector('.pulse').getAnimations()[0].startTime;
    });
    const before = await page.evaluate(() => ({ count: tracked.length, unread: document.querySelectorAll('.entry.unread').length, top: document.querySelector('#scroll').scrollTop }));
    assert.ok(before.count > 12 && before.unread > 0, 'the tracked set is meaningful');
    const check = async (step) => {
      const after = await page.evaluate(() => ({ gone: tracked.filter((node) => !node.isConnected).length, removed: window.removed, top: document.querySelector('#scroll').scrollTop, pulse: document.querySelector('.pulse').getAnimations()[0].startTime === window.pulseStart, focus: document.activeElement.id, value: document.querySelector('#q').value, selection: document.querySelector('#q').selectionStart, spoiler: document.querySelector('.spoiler').classList.contains('revealed') }));
      assert.deepEqual(after, { gone: 0, removed: 0, top: before.top, pulse: true, focus: 'q', value: ' ', selection: 1, spoiler: true }, step);
    };
    await bump(page);
    await check('after an unrelated revision');
    await page.evaluate(async () => { const { collections } = await browser.storage.local.get('collections'); collections[0].readAt = Date.now() + 864e5; await browser.storage.local.set({ collections }); });
    await page.waitForFunction(() => document.querySelectorAll('.entry.unread').length === 0);
    await settle(page);
    await check('after a read advance');
    assert.equal(await page.locator('.newpill').count(), 0, 'the head counter follows the read state');
    assert.equal(await page.locator('.item.on .n').textContent(), '', 'the sidebar counter follows the read state');
    await page.locator('[data-clear="q"]').click();
    assert.equal(await page.inputValue('#q'), '', 'clearing the chip clears the input');
  },
  async 'a broken image stays on its fallback across renders'(page) {
    await page.route('https://cdn.discordapp.com/avatars/**', (route) => route.fulfill({ status: 404, body: '' }));
    await arrive(page, 'broken', { author: { id: '42', name: 'Broken Face', avatar: 'nope' } });
    await page.waitForFunction(() => document.querySelector('.entry[data-id="broken"] span.av'));
    const initial = await page.locator('.entry[data-id="broken"] span.av').evaluate((node) => { window.fallbackNode = node; return node.textContent; });
    assert.equal(initial, 'BF');
    await bump(page);
    assert.equal(await page.evaluate(() => window.fallbackNode.isConnected), true, 'the fallback is not re-created');
    assert.equal(await page.locator('.entry[data-id="broken"] img.av').count(), 0);
  },
  async 'embeds render as cards that load images only from Discord proxies'(page) {
    const DISCORD = ['cdn.discordapp.com', 'media.discordapp.net', 'images-ext-1.discordapp.net', 'images-ext-2.discordapp.net'];
    const requested = [];
    page.on('request', (request) => requested.push(request.url()));
    for (const host of DISCORD.slice(1)) await page.route(`https://${host}/**`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>' }));
    await page.route(/evil\.example/, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>' }));
    await arrive(page, 'old-embeds', { content: 'Old row', embeds: 2 });
    await arrive(page, 'bare-link', { content: 'https://example.org/bare', embeds: [{ type: 'link', url: 'https://example.org/bare' }] });
    await arrive(page, 'video', { content: 'Clip', embeds: [{ type: 'video', url: 'https://www.youtube.com/watch?v=x', title: 'Trailer', provider: { name: 'YouTube' },
      thumbnail: { proxy_url: 'https://images-ext-2.discordapp.net/external/v/https/i.ytimg.com/vi/x/hq.jpg', width: 480, height: 360 }, video: { url: 'https://www.youtube.com/embed/x', width: 1280, height: 720 } }] });
    // Stored rows are not trusted either: the reader checks hosts again.
    await arrive(page, 'offhost', { content: 'Cat', embeds: [{ type: 'rich', title: 'Cat', image: { proxy_url: 'https://evil.example/cat.png', width: 100, height: 100 },
      thumbnail: { proxy_url: 'https://media.discordapp.net.evil.example/cat.png', width: 50, height: 50 } }] });
    await arrive(page, 'rich', { content: 'Read https://example.org/post', embeds: [{ type: 'rich', url: 'https://example.org/post', title: 'A post', description: 'Some **bold** text', color: 0x5865f2,
      author: { name: 'Example', url: 'https://example.org/me' }, provider: { name: 'Example Site' }, footer: { text: 'Footer' },
      fields: [{ name: 'Inline A', value: '1', inline: true }, { name: 'Inline B', value: '2', inline: true }, { name: 'Wide', value: '3' }],
      image: { proxy_url: 'https://images-ext-1.discordapp.net/external/abc/https/example.org/full.png', width: 1200, height: 600 } }] });
    await page.locator('.entry[data-id="rich"] .embed img').waitFor();
    const rich = page.locator('.entry[data-id="rich"] .embed');
    const lineColor = await page.evaluate(() => { const node = document.createElement('i'); node.style.color = 'var(--line)'; document.body.append(node); const value = getComputedStyle(node).color; node.remove(); return value; });
    assert.equal(await rich.evaluate((node) => getComputedStyle(node).borderLeftColor), 'rgb(88, 101, 242)', 'the card rule uses the embed colour');
    assert.equal(await page.locator('.entry[data-id="offhost"] .embed').evaluate((node) => getComputedStyle(node).borderLeftColor), lineColor, 'no colour falls back to the line token');
    const title = rich.locator('.em-title a');
    assert.deepEqual([await title.textContent(), await title.getAttribute('href'), await title.getAttribute('target'), await title.getAttribute('rel')], ['A post', 'https://example.org/post', '_blank', 'noopener noreferrer']);
    assert.equal(await rich.locator('.em-desc strong').textContent(), 'bold', 'the description uses message formatting');
    assert.equal(await rich.locator('.em-field.inline').count(), 2);
    assert.equal(await rich.locator('.em-small').first().textContent(), 'Example Site');
    assert.equal(await rich.locator('.em-foot').textContent(), 'Footer');
    const image = await rich.locator('img.em-img').evaluate((node) => ({ host: new URL(node.src).hostname, size: [node.offsetWidth, node.offsetHeight] }));
    assert.deepEqual(image, { host: 'images-ext-1.discordapp.net', size: [400, 200] }, 'the image box is reserved from the embed size, at most 400 px wide');
    assert.equal(await page.locator('.entry[data-id="offhost"] .em-title').textContent(), 'Cat', 'an off-host embed still shows its text');
    assert.equal(await page.locator('.entry[data-id="offhost"] img').count(), 1, 'an off-host embed shows no image, only the avatar');
    const video = page.locator('.entry[data-id="video"] .embed a.em-video');
    assert.deepEqual([await video.getAttribute('href'), await video.getAttribute('rel'), await video.locator('img').count(), await video.locator('.em-play').count()], ['https://www.youtube.com/embed/x', 'noopener noreferrer', 1, 1], 'a video is a still frame linking out');
    assert.equal(await page.locator('iframe, video, audio, embed, object').count(), 0, 'no player elements');
    assert.equal(await page.locator('.entry[data-id="bare-link"] .embed').count(), 0, 'a bare link already in the text shows no card');
    assert.equal(await page.locator('.entry[data-id="old-embeds"] .tag').textContent(), await page.evaluate(() => browser.i18n.getMessage('embedCount', ['2'])), 'a numeric row keeps its count label');
    await settle(page);
    const sources = await page.$$eval('img', (nodes) => nodes.map((node) => node.src));
    for (const src of sources) assert.ok(DISCORD.includes(new URL(src).hostname), `image source outside Discord: ${src}`);
    assert.deepEqual(requested.filter((url) => /evil\.example|example\.org|ytimg|youtube/.test(new URL(url).hostname)), [], 'no third-party image is requested');
    // An update re-renders only that message: the other cards keep their image nodes.
    await page.locator('.entry[data-id="video"] img.em-img').evaluate((node) => { window.videoFrame = node; });
    await page.evaluate(async () => {
      const row = await feedDB.get('messages', 'rich');
      await feedDB.writeMessage({ ...row, embeds: [{ ...row.embeds[0], title: 'A better post' }] });
      const { rev } = await browser.storage.local.get('rev'); await browser.storage.local.set({ rev: rev + 1 });
    });
    await page.waitForFunction(() => document.querySelector('.entry[data-id="rich"] .em-title')?.textContent === 'A better post');
    assert.equal(await page.evaluate(() => window.videoFrame.isConnected), true, 'an unrelated card is not rebuilt');
  },
  async 'a reply quotes its original and jumps to it'(page) {
    await page.setViewportSize({ width: 1360, height: 420 });
    await arrive(page, 'orig', { author: { id: '9', name: 'Ola' }, content: 'First line of the **original** ||spoiler||\nsecond line' });
    for (let i = 0; i < 12; i++) await arrive(page, `filler${i}`);
    await arrive(page, 'rep', { content: 'Agreed', reply_to: 'orig' });
    await arrive(page, 'lost', { content: 'Who?', reply_to: 'nope', reply_author: 'Ghost' });
    const quote = page.locator('.entry[data-id="rep"] button.quote');
    await quote.waitFor();
    await page.waitForFunction(() => !document.querySelector('.arrive, .pop') && document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.target?.classList?.contains('pulse')));
    await settle(page);
    assert.equal((await quote.locator('.q-text').textContent()), 'First line of the original ░░░', 'first line, formatting flattened, spoiler covered');
    assert.equal(await quote.locator('b').textContent(), 'Ola');
    assert.equal(await quote.evaluate((node) => getComputedStyle(node.querySelector('.q-text')).textOverflow), 'ellipsis');
    assert.equal(await quote.evaluate((node) => node.getBoundingClientRect().height < 24), true, 'one line');
    assert.equal(await page.locator('.entry[data-id="rep"] .re').count(), 0, 'the quote replaces the header reply marker');
    const inView = (id) => page.locator(`.entry[data-id="${id}"]`).evaluate((node) => { const box = node.getBoundingClientRect(), scroll = document.querySelector('#scroll').getBoundingClientRect(); return box.top >= scroll.top && box.bottom <= scroll.bottom; });
    assert.equal(await inView('orig'), false, 'the original starts off screen');
    await quote.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const node = document.querySelector('.entry[data-id="orig"]'), box = node.getBoundingClientRect(), scroll = document.querySelector('#scroll').getBoundingClientRect(); return box.top >= scroll.top && box.bottom <= scroll.bottom; });
    assert.equal(await page.locator('.entry[data-id="orig"]').evaluate((node) => node.classList.contains('flash')), true, 'the original is highlighted');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'orig', 'focus moves to the original');
    await page.waitForFunction(() => !document.querySelector('.entry.flash'), null, { timeout: 3000 });
    const missing = page.locator('.entry[data-id="lost"] .quote');
    assert.equal(await missing.evaluate((node) => node.tagName), 'DIV', 'an unloaded original is not clickable');
    assert.match(await missing.textContent(), new RegExp(`Ghost.*${await page.evaluate(() => browser.i18n.getMessage('replyNotLoaded'))}`));
    // m7 replies to m3, which is loaded but collapsed among earlier read messages.
    await page.locator('.entry[data-id="m7"] button.quote').click();
    assert.equal(await page.locator('.toast').textContent(), await page.evaluate(() => browser.i18n.getMessage('replyHidden')), 'a collapsed original explains why nothing moved');
    // Editing the original updates the quote.
    await page.evaluate(async () => {
      const row = await feedDB.get('messages', 'orig');
      await feedDB.writeMessage({ ...row, content: 'Edited original', edited_timestamp: new Date().toISOString() });
      const { rev } = await browser.storage.local.get('rev'); await browser.storage.local.set({ rev: rev + 1 });
    });
    await page.waitForFunction(() => document.querySelector('.entry[data-id="rep"] .q-text')?.textContent === 'Edited original');
  },
  async 'status strip expands in place and colours its dot by capture health'(page) {
    const message = (key) => page.evaluate((key) => browser.i18n.getMessage(key), key);
    // Computed colours, compared with the tokens resolved on a probe element.
    const colors = () => page.evaluate(() => {
      const probe = (token) => { const node = document.createElement('i'); node.style.color = `var(${token})`; document.body.append(node); const value = getComputedStyle(node).color; node.remove(); return value; };
      return { dot: getComputedStyle(document.querySelector('#status-toggle .pulse')).backgroundColor, ok: probe('--ok'), warn: probe('--warn'), off: probe('--unread') };
    });
    const strip = page.locator('#status-toggle');
    assert.equal((await strip.innerText()).trim(), '', 'the collapsed strip shows no text');
    assert.equal(await strip.locator('.pulse').isVisible(), true, 'the collapsed strip shows the dot');
    assert.equal(await page.locator('#status-panel').isVisible(), false, 'the panel starts collapsed');
    assert.ok((await strip.getAttribute('title')).startsWith(`${await message('listening')} · `), 'the title names the state and its age');
    assert.equal(await strip.getAttribute('aria-label'), await strip.getAttribute('title'));
    let c = await colors();
    assert.equal(c.dot, c.ok, 'a fresh signal is green');
    await strip.click();
    assert.equal(await strip.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#status-panel .spark').isVisible(), true, 'expanding shows the 24 h bars');
    assert.equal(await page.locator('#status-panel .health-copy').count(), 0, 'ok shows no sentence');
    assert.ok(await page.locator('#status-panel .spark i.gap[title]').count() > 0, 'gap bars name their time range');
    await page.evaluate(() => { window.statusNodes = [...document.querySelectorAll('#status *')]; });
    await bump(page);
    assert.equal(await page.locator('#status-panel').isVisible(), true, 'a revision keeps the panel open');
    assert.equal(await page.evaluate(() => statusNodes.filter((node) => !node.isConnected).length), 0, 'a revision keeps every status node');
    await page.evaluate(() => browser.storage.local.set({ health: { state: 'multi-tab', since: Date.now(), detail: {} } }));
    await page.locator('#status-panel .health-copy').waitFor();
    assert.equal(await page.locator('#status-panel .health-copy').textContent(), await message('healthMultiTab'));
    assert.ok((await strip.getAttribute('title')).startsWith(`${await message('unstable')} · `));
    c = await colors();
    assert.equal(c.dot, c.warn, 'multiple tabs turn the dot yellow');
    assert.equal(new Set(Object.values(c)).size, 3, 'ok, warn and off are distinct colours');
    assert.equal(await page.locator('#status-toggle .pulse').evaluate((node) => node.getAnimations().length), 0, 'yellow does not pulse');
    await page.evaluate(() => browser.storage.local.set({ health: { state: 'broken', since: Date.now(), detail: {} } }));
    await page.waitForFunction(() => document.querySelector('#status-panel .health-copy')?.textContent === browser.i18n.getMessage('healthBroken'));
    c = await colors();
    assert.equal(c.dot, c.off, 'broken capture turns the dot red');
    await page.evaluate(() => browser.storage.local.set({ health: { state: 'ok', since: Date.now(), detail: {} } }));
    await page.waitForFunction(() => !document.querySelector('#status-panel .health-copy'));
    // A healthy state with a late signal: yellow past two minutes, red past three.
    for (const [seconds, level] of [[150, 'warn'], [200, 'off']]) {
      await page.evaluate((seconds) => browser.storage.local.set({ lastSignal: Date.now() - seconds * 1000 }), seconds);
      await bump(page);
      assert.equal(await page.locator('#status-panel .health-copy').textContent(), await page.evaluate((seconds) => browser.i18n.getMessage('healthLate', [browser.i18n.getMessage('minutesAgo', [String(Math.round(seconds / 60))])]), seconds), `late sentence at ${seconds} s`);
      c = await colors();
      assert.equal(c.dot, c[level], `a signal ${seconds} s old is ${level}`);
    }
    await page.evaluate(() => browser.storage.local.set({ lastSignal: Date.now() }));
    await bump(page);
    assert.equal(await page.locator('#status-panel .health-copy').count(), 0, 'a fresh signal clears the sentence');
    await strip.click();
    assert.equal(await page.locator('#status-panel').isVisible(), false, 'a second click collapses the panel');
  },
  async 'caught up keeps the history as messages arrive, in both directions'(page) {
    for (const direction of ['bottom', 'top']) {
      await setDirection(page, direction);
      await caughtUp(page);
      const before = await entryIds(page);
      await arrive(page, `up-${direction}`);
      await page.locator(`.entry[data-id="up-${direction}"]`).waitFor();
      await settle(page);
      const after = await entryIds(page);
      assert.equal(after.length, before.length + 1, `${direction}: the arrival adds to the history`);
      assert.ok(before.every((id) => after.includes(id)), `${direction}: nothing leaves the feed`);
      assert.equal(await page.locator('.earlier').count(), 1, `${direction}: older messages stay reachable`);
    }
    // Opening a feed with nothing unread behaves the same way.
    await caughtUp(page);
    await page.click('[data-collection="club"]');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Game Club');
    await page.click('[data-collection="all"]');
    await page.waitForFunction(() => document.querySelectorAll('.entry').length >= 50);
    const shown = await page.locator('.entry').count();
    await arrive(page, 'up-open');
    await page.locator('.entry[data-id="up-open"]').waitFor();
    await settle(page);
    assert.equal(await page.locator('.entry').count(), shown + 1, 'a feed opened caught up keeps its history');
  },
  async 'following keeps the newest edge in view, including a burst during a smooth scroll'(page) {
    const long = 'long line\n'.repeat(30);
    for (const direction of ['bottom', 'top']) {
      await setDirection(page, direction);
      await caughtUp(page);
      await scrollTo(page, direction, 0);
      await arrive(page, `f-${direction}`, { content: long });
      await page.locator(`.entry[data-id="f-${direction}"]`).waitFor();
      await atEdge(page, direction, `${direction}: follows a single arrival`);
      await settle(page);
      await scrollTo(page, direction, 40); // inside the slack, so a top-mode prepend is anchored and has to travel
      await arrive(page, `b1-${direction}`, { content: long });
      await page.locator(`.entry[data-id="b1-${direction}"]`).waitFor();
      await page.waitForTimeout(30);
      // The arrival unfolds from zero height, so the river keeps growing while the view follows it.
      assert.ok(await page.locator(`.entry[data-id="b1-${direction}"]`).evaluate((node) => node.getAnimations().some((a) => a.playState === 'running' && a.effect.getKeyframes().some((k) => k.height === '0px'))), `${direction}: the burst lands while its height is still opening`);
      await arrive(page, `b2-${direction}`, { content: long });
      await page.locator(`.entry[data-id="b2-${direction}"]`).waitFor();
      await atEdge(page, direction, `${direction}: a burst still ends at the edge`);
      await page.waitForTimeout(600);
      assert.ok(await edgeGap(page, direction) <= 2, `${direction}: stays at the edge`);
      await arrive(page, `b3-${direction}`, { content: long });
      await page.locator(`.entry[data-id="b3-${direction}"]`).waitFor();
      await atEdge(page, direction, `${direction}: still following after the burst`);
      assert.ok(await page.locator(`.entry[data-id="b3-${direction}"]`).evaluate((node) => { const box = node.getBoundingClientRect(), view = document.querySelector('#scroll').getBoundingClientRect(); return box.top < view.bottom && box.bottom > view.top; }), `${direction}: the newest message is in view`);
    }
    await setDirection(page, 'bottom');
    await caughtUp(page);
    await scrollTo(page, 'bottom', 0);
    await arrive(page, 'late', await lateImage(page, 'late.png'));
    await page.locator('.entry[data-id="late"]').waitFor();
    await atEdge(page, 'bottom', 'the arrival is followed');
    await page.waitForFunction(() => document.querySelector('.entry[data-id="late"] .thumbnail')?.complete && document.querySelector('.entry[data-id="late"] .thumbnail').naturalWidth > 0);
    await page.waitForTimeout(50);
    await atEdge(page, 'bottom', 'following keeps the edge when an image loads later');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setDirection(page, 'bottom');
    await caughtUp(page);
    await scrollTo(page, 'bottom', 0);
    await page.evaluate(() => { window.instant = null; new MutationObserver(() => { const s = document.querySelector('#scroll'); requestAnimationFrame(() => { window.instant ??= s.scrollHeight - s.clientHeight - s.scrollTop; }); }).observe(document.querySelector('.river'), { childList: true }); });
    await arrive(page, 'calm', { content: long });
    await page.waitForFunction(() => window.instant !== null);
    assert.ok(await page.evaluate(() => window.instant) <= 2, 'reduced motion jumps straight to the edge');
  },
  async 'scrolled away stays put, in both directions, until the edge is reached again'(page) {
    for (const direction of ['bottom', 'top']) {
      await setDirection(page, direction);
      await caughtUp(page);
      await scrollTo(page, direction, 600);
      const before = await reference(page);
      await arrive(page, `away-${direction}`, { content: 'long line\n'.repeat(10) });
      await page.locator(`.entry[data-id="away-${direction}"]`).waitFor();
      await page.waitForTimeout(500);
      near(await topOf(page, before.id), before.top, `${direction}: the reference entry does not move on screen`);
      const scrollTop = await page.locator('#scroll').evaluate((s) => s.scrollTop);
      if (direction === 'bottom') assert.equal(scrollTop, before.scrollTop, 'bottom: scrollTop is untouched');
      else assert.ok(scrollTop > before.scrollTop + 100, 'top: anchoring compensates for the prepend');
      if (direction === 'top') {
        await arrive(page, 'late-above', await lateImage(page, 'late-above.png'));
        await page.waitForFunction(() => document.querySelector('.entry[data-id="late-above"] .thumbnail')?.naturalWidth > 0);
        await page.waitForTimeout(100);
        near(await topOf(page, before.id), before.top, 'top: a late image above does not move the reference entry');
      }
      await scrollTo(page, direction, 0);
      await arrive(page, `back-${direction}`);
      await page.locator(`.entry[data-id="back-${direction}"]`).waitFor();
      await atEdge(page, direction, `${direction}: returning to the edge resumes following`);
    }
  },
  async 'the earlier button keeps its anchor and never yanks to the edge'(page) {
    await setDirection(page, 'bottom');
    // Everything fits, so the reader is following when the history expands above them. Too little sits below
    // the anchor to hold it at the same pixel, but the reader must not travel: the same block stays on screen.
    await page.setViewportSize({ width: 1360, height: 1500 });
    await settle(page);
    assert.equal(await edgeGap(page, 'bottom'), 0, 'the unread block fits the viewport');
    await page.locator('.earlier').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length > 300);
    await page.waitForTimeout(600);
    const view = await page.locator('#scroll').evaluate((s) => s.getBoundingClientRect().bottom);
    assert.ok(await topOf(page, 'm7') >= 0 && await topOf(page, 'm7') < view, 'expanding while following keeps the same message on screen');
    await page.locator('.earlier').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length < 300);
    await page.setViewportSize({ width: 1360, height: 860 });
    await settle(page);
    for (const direction of ['bottom', 'top']) {
      await setDirection(page, direction);
      await caughtUp(page);
      await scrollTo(page, direction, 300);
      const before = await reference(page);
      await page.locator('.earlier').evaluate((node) => node.click());
      await page.waitForFunction(() => document.querySelectorAll('.entry').length > 300);
      await page.waitForTimeout(300);
      near(await topOf(page, before.id), before.top, `${direction}: expanding keeps the reference entry in place`);
      await page.locator('.earlier').evaluate((node) => node.click());
      await page.waitForFunction(() => document.querySelectorAll('.entry').length < 300);
      await page.waitForTimeout(300);
      near(await topOf(page, before.id), before.top, `${direction}: collapsing keeps the reference entry in place`);
    }
  },
  async 'only a truly new message animates'(page) {
    await page.evaluate(() => {
      window.animated = []; window.popped = [];
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.matches?.('.entry.arrive')) animated.push(node.dataset.id);
          if (node.matches?.('circle.pop')) popped.push(node);
        }
      }).observe(document.querySelector('#scroll'), { childList: true, subtree: true });
    });
    const none = async (step) => assert.deepEqual(await page.evaluate(() => [animated.length, popped.length, document.querySelectorAll('.arrive, .pop').length]), [0, 0, 0], step);
    await bump(page); await none('a revision');
    await page.locator('#q').pressSequentially('a'); await settle(page); await none('filtering');
    await page.locator('[data-clear="q"]').click(); await settle(page); await none('clearing a filter');
    await page.locator('.earlier').click();
    await page.waitForFunction(() => document.querySelectorAll('.entry').length === 420);
    await none('expanding earlier messages');
    await page.locator('.earlier').click(); await settle(page); await none('collapsing');
    await page.click('[data-collection="club"]'); await page.waitForFunction(() => document.querySelector('h1').textContent === 'Game Club');
    await page.click('[data-collection="all"]'); await page.waitForFunction(() => document.querySelector('h1').textContent !== 'Game Club');
    await settle(page); await none('opening a feed');
    await arrive(page, 'recovered', { timestamp: new Date(Date.now() - 600e3).toISOString() });
    await page.locator('.entry[data-id="recovered"]').waitFor();
    await none('recovering an older message');
    await arrive(page, 'fresh');
    await page.locator('.entry[data-id="fresh"]').waitFor();
    assert.deepEqual(await page.evaluate(() => animated), ['fresh'], 'the arrival is the only animated message');
    assert.equal(await page.evaluate(() => popped.length), 1, 'its graph dot pops once');
    assert.match(await page.locator('.entry[data-id="fresh"]').evaluate((node) => getComputedStyle(node).animationName), /entry-fade/);
    await page.waitForFunction(() => !document.querySelector('.arrive, .pop'));
    await arrive(page, 'next');
    await page.locator('.entry[data-id="next"]').waitFor();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.arrive')].map((node) => node.dataset.id)), ['next'], 'reused nodes do not animate again');
  },
  async 'being at the top reads everything; filters and chat style still need each message seen'(page) {
    await page.setViewportSize({ width: 1360, height: 420 });
    const readAt = () => page.evaluate(async () => (await browser.storage.local.get('collections')).collections[0].readAt);
    const newest = await page.locator('.entry[data-id="m14"] time').evaluate((node) => Date.parse(node.dateTime));
    const oldest = page.locator('.entry[data-id="m7"]');
    await page.locator('.conv button[data-focus="gen"]').first().click();
    await page.waitForTimeout(1500);
    assert.ok(await readAt() < newest, 'a channel filter does not settle messages it hides');
    await page.locator('[data-clear="conv"]').click();
    assert.equal(await oldest.evaluate((node) => node.getBoundingClientRect().top > document.querySelector('#scroll').getBoundingClientRect().bottom), true, 'the oldest unread is off screen');
    await page.locator('.newpill').waitFor({ state: 'detached' });
    assert.equal(await readAt(), newest, 'read state reaches the newest message');
    assert.equal(await page.locator('.entry').count(), 8, 'reading does not collapse the feed');
    assert.equal(await page.locator('.entry.unread').count(), 0);
  },
  async 'chat style still advances read state only through seen messages'(page) {
    await page.setViewportSize({ width: 1360, height: 420 });
    await page.evaluate(() => browser.storage.local.set({ readingDirection: 'bottom' }));
    await settle(page);
    const newest = await page.locator('.entry[data-id="m14"] time').evaluate((node) => Date.parse(node.dateTime));
    await page.waitForTimeout(1500);
    assert.ok(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections[0].readAt) < newest, 'the off-screen newest message stays unread');
  },
  async 'the direction setting orders the feed, its graph, positions and keys'(page) {
    assert.equal(await page.evaluate(async () => (await browser.storage.local.get('readingDirection')).readingDirection), undefined);
    const newestFirst = ['m14', 'm13', 'm12', 'm11', 'm10', 'm9', 'm8', 'm7'];
    assert.equal(await page.inputValue('#direction'), 'top', 'top is the default on a fresh profile');
    assert.equal(await page.locator('#direction option').first().getAttribute('value'), 'top', 'the default is listed first');
    assert.deepEqual(await entryIds(page), newestFirst, 'a fresh profile opens newest first');
    assert.equal(await page.locator('#scroll').evaluate((s) => s.scrollTop), 0, 'a fresh profile opens at the top');
    assert.equal(await page.evaluate(() => [...document.querySelector('.river').children].at(-2).className.trim()), 'endcap', 'top: the up-to-date line closes the feed, so it never sits above unread messages');
    await page.evaluate(() => browser.storage.local.set({ readingDirection: 'sideways' }));
    await settle(page);
    assert.equal(await page.inputValue('#direction'), 'top', 'an unknown value means top');
    assert.deepEqual(await entryIds(page), newestFirst, 'an unknown value keeps newest first');
    await page.click('#menubtn');
    await page.evaluate(() => browser.storage.local.set({ readingDirection: 'bottom' }));
    await page.waitForFunction(() => document.querySelector('.entry')?.dataset.id === 'm7');
    assert.equal(await page.evaluate(async () => (await browser.storage.local.get('readingDirection')).readingDirection), 'bottom', 'choosing bottom persists');
    await page.locator('h1').click();
    await settle(page);
    const bottomOrder = await entryIds(page);
    assert.deepEqual(bottomOrder, ['m7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'], 'bottom keeps oldest to newest');
    assert.ok(await page.evaluate(() => { const first = document.querySelector('.entry.unread').getBoundingClientRect(), scroll = document.querySelector('#scroll').getBoundingClientRect(); return first.top >= scroll.top - 1 && first.top < scroll.top + 40; }), 'bottom opens at the first unread');
    await page.click('#menubtn');
    await page.selectOption('#direction', 'top');
    await page.waitForFunction(() => document.querySelector('.entry')?.dataset.id === 'm14');
    assert.equal(await page.evaluate(async () => (await browser.storage.local.get('readingDirection')).readingDirection), 'top', 'the setting persists');
    await page.locator('h1').click();
    await settle(page);
    assert.deepEqual(await entryIds(page), bottomOrder.toReversed(), 'top shows newest first');
    assert.equal(await page.locator('#scroll').evaluate((s) => s.scrollTop), 0, 'switching opens at the top');
    const structure = await page.evaluate(() => {
      const kids = [...document.querySelector('.river').children], last = kids.findLastIndex((node) => node.matches('.entry'));
      return { closing: kids.at(-2).className.trim(), cap: kids.at(-2).textContent, earlierAfterEntries: kids.findIndex((node) => node.matches('.earlier')) > last, firstEntry: kids.findIndex((node) => node.matches('.entry')), positions: [...document.querySelectorAll('.entry')].map((node) => [node.getAttribute('aria-posinset'), node.getAttribute('aria-setsize')].join('/')) };
    });
    assert.equal(structure.closing, 'endcap');
    assert.match(structure.cap, new RegExp(await page.evaluate(() => browser.i18n.getMessage('feedEndTop').slice(4, 20))));
    assert.equal(structure.earlierAfterEntries, true, 'the earlier button sits at the old end');
    assert.deepEqual(structure.positions, bottomOrder.map((_, i) => `${i + 1}/8`), 'positions follow display order');
    const graph = await page.evaluate(() => {
      const river = document.querySelector('.river');
      const parents = [...document.querySelectorAll('.entry, .conv')].every((node) => node.offsetParent === river);
      const dots = [...document.querySelectorAll('.graph circle')].map((node) => Number(node.getAttribute('cy'))).sort((a, b) => a - b);
      const expected = [...document.querySelectorAll('.entry')].map((node) => node.offsetTop + 17).sort((a, b) => a - b);
      const svg = document.querySelector('.graph');
      return { parents, dots, expected, paths: [...document.querySelectorAll('.graph path')].map((node) => node.getAttribute('d')).join(' '), height: Number(svg.getAttribute('height')), riverHeight: river.offsetHeight };
    });
    assert.equal(graph.parents, true, '.river is the offsetParent of entries and labels');
    assert.deepEqual(graph.dots, graph.expected, 'every graph dot lines up with its entry');
    assert.doesNotMatch(graph.paths, /NaN|undefined|Infinity/);
    assert.equal(graph.height, graph.riverHeight);
    await page.locator('h1').click();
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm14', 'top: j selects the first message shown');
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm13', 'top: j moves down the screen');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm14', 'top: k moves up the screen');
    await page.keyboard.press('n');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm13', 'top: n moves to the next unread down the screen');
    await page.click('#menubtn');
    await page.evaluate(() => browser.storage.local.set({ readingDirection: 'bottom' }));
    await page.waitForFunction(() => document.querySelector('.entry')?.dataset.id === 'm7');
    await page.locator('h1').click();
    assert.deepEqual(await entryIds(page), bottomOrder, 'switching back restores chronological order');
    assert.equal(await page.evaluate(() => [...document.querySelector('.river').children].at(-2).className.trim()), 'endcap', 'bottom: the endcap closes the feed, before the graph');
  },
  async 'the settings menu fits the sidebar and a 400px viewport'(page) {
    const fits = () => page.evaluate(() => {
      const menu = document.querySelector('#menu'), box = menu.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth || menu.scrollWidth > menu.clientWidth || box.left < 0 || box.right > innerWidth, escaped: [...menu.querySelectorAll('label, select, button')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width && (rect.left < box.left || rect.right > box.right); }).length };
    });
    await page.click('#menubtn');
    assert.equal(await page.locator('#direction').isVisible(), true);
    assert.deepEqual(await fits(), { overflow: false, escaped: 0 }, 'menu at the 272px sidebar');
    await page.click('#menubtn');
    await page.setViewportSize({ width: 400, height: 800 });
    await settle(page);
    await page.click('#mobilemenu');
    assert.equal(await page.locator('#direction').isVisible(), true);
    const narrow = await fits();
    assert.equal(narrow.overflow, false, 'no overflow at 400px with the menu open');
    assert.equal(narrow.escaped, 0, 'every control stays inside the menu at 400px');
  },
};
let browser;
try {
  browser = await chromium.launch();
  for (const [language, colorScheme] of [['en', 'light'], ['es', 'dark']]) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://cdn.discordapp.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/viewer.html?lang=${language}#welcome`);
      await page.locator('#consent').waitFor();
      // This flow proves the chat-style order; the default direction has its own section below.
      await page.evaluate(() => browser.storage.local.set({ readingDirection: 'bottom' }));
      assert.equal(await page.evaluate(async () => (await browser.storage.local.get('consentedAt')).consentedAt), undefined);
      await page.click('#consent');
      await page.locator('#create-first').waitFor();
      assert.ok(await page.evaluate(async () => (await browser.storage.local.get('consentedAt')).consentedAt > 0), 'welcome stores consent');
      assert.equal(await page.locator('#overlay ol li').count(), 3, 'three guided steps');
      await page.click('#create-first');
      await page.locator('#cname').waitFor();
      await page.click('#scancel');
      await page.locator('.entry').first().waitFor();
      assert.equal(await page.locator('.entry:not(.unread)').count(), 0, 'earlier read messages start collapsed');
      assert.equal(await page.locator('.entry').count(), 8, 'unread block shows oldest to newest');
      assert.ok(await page.evaluate(() => {
        const first = document.querySelector('.entry.unread').getBoundingClientRect();
        const scroll = document.querySelector('#scroll').getBoundingClientRect();
        return first.top >= scroll.top - 1 && first.top < scroll.top + 40;
      }), 'opening starts at the top of unread');
      await page.locator('h1').click();
      await page.keyboard.press('j');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm7', 'j selects first unread message');
      await page.keyboard.press('n');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'm8', 'n selects next unread message');
      assert.equal(await page.evaluate(() => viewerQueries.at(-1).limit), 400, 'initial history query stays capped at MAX_SHOWN');
      await page.locator('.earlier').click();
      await page.waitForFunction(() => document.querySelectorAll('.entry').length === 420);
      assert.equal(await page.locator('.entry').count(), 420, 'expanding earlier messages loads complete history on demand');
      await page.locator('.earlier').click();
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      const queryCount = await page.evaluate(() => viewerQueries.length);
      await page.evaluate(async () => {
        const { rev } = await browser.storage.local.get('rev');
        await browser.storage.local.set({ lastSignal: Date.now() });
        await browser.storage.local.set({ rev });
      });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => viewerQueries.length), queryCount, 'same rev and signal-only writes do not re-query');
      await page.click('[data-collection="club"]');
      await page.locator('.entry').first().waitFor();
      if (await page.locator('.earlier').count()) await page.locator('.earlier').click();
      await page.waitForFunction(() => document.querySelectorAll('.entry').length === 14);
      assert.equal(await page.locator('h1').textContent(), 'Game Club');
      await page.click('#edit');
      await page.locator('#sdone').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sclose', 'Tab wraps to the first sheet control');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sdone', 'Shift+Tab wraps to the last sheet control');
      await page.fill('#cname', 'Reading list');
      await page.click('[data-pill="mem"]');
      await page.click('#sdone');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Reading list');
      assert.ok(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.find((c) => c.id === 'club').ids.includes('mem')));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'edit', 'sheet restores focus to edit');
      await page.click('#add');
      await page.fill('#cname', 'Art');
      await page.click('[data-pill="eve"]');
      await page.click('#sdone');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Art' && document.querySelectorAll('.entry').length === 1);
      assert.deepEqual(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.find((c) => c.name === 'Art').ids), ['eve']);
      assert.match(await page.locator('.entry .txt').textContent(), /Game jam/);
      // New arrivals append without moving the current reading position.
      const scrollBefore = await page.locator('#scroll').evaluate((node) => node.scrollTop);
      await page.evaluate(async () => {
        await feedDB.writeMessage({ id: 'arrival', channel_id: 'eve', guild_id: 'g2', timestamp: new Date().toISOString(), author: { id: '1', name: 'Nico' }, content: '**Arrival** https://example.org ||secret||' });
        const { rev } = await browser.storage.local.get('rev');
        await browser.storage.local.set({ rev: rev + 1 });
      });
      await page.locator('.entry[data-id="arrival"]').waitFor();
      assert.equal(await page.locator('#scroll').evaluate((node) => node.scrollTop), scrollBefore, 'arrival preserves scroll position');
      assert.equal(await page.locator('.entry').last().getAttribute('data-id'), 'arrival');
      assert.equal(await page.locator('.entry[data-id="arrival"] strong').textContent(), 'Arrival');
      assert.equal(await page.locator('.entry[data-id="arrival"] .txt a').getAttribute('rel'), 'noopener noreferrer');
      await page.locator('.spoiler').click();
      assert.equal(await page.locator('.spoiler').getAttribute('aria-expanded'), 'true');
      // Incoming revisions preserve the draft and its typed name; cancel never saves it.
      await page.click('#add'); await page.fill('#cname', 'Draft'); await page.click('[data-pill="gen"]');
      const beforeRevision = await page.evaluate(() => viewerQueries.length);
      await page.evaluate(async () => { const { rev } = await browser.storage.local.get('rev'); await browser.storage.local.set({ rev: rev + 1 }); });
      await page.waitForFunction((count) => viewerQueries.length > count, beforeRevision);
      assert.equal(await page.inputValue('#cname'), 'Draft');
      await page.click('#scancel');
      assert.equal(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.some((c) => c.name === 'Draft')), false);
      await page.click('[data-collection="club"]');
      await page.locator('.entry').first().waitFor();
      if (await page.locator('.earlier').count()) await page.locator('.earlier').click();
      await page.waitForFunction(() => document.querySelectorAll('.entry').length === 14);
      await page.setViewportSize({ width: 400, height: 800 });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no document overflow at 400px');
      assert.equal(await page.evaluate(() => document.querySelector('#scroll').scrollWidth > document.querySelector('#scroll').clientWidth), false, 'no feed overflow at 400px');
      await page.click('#edit');
      assert.equal(await page.evaluate(() => document.querySelector('.sheet').scrollWidth > innerWidth), false, 'no sheet overflow at 400px');
      await page.click('#scancel');
      // Same guarantees in the chat-style direction: sections above run on the default.
const revisionsSection = 'revisions and read state keep every node, scroll, focus and typed text';
sections[`${revisionsSection} (chat style)`] = async (page) => { await setDirection(page, 'bottom'); await sections[revisionsSection](page); };
const failures = [];
      for (const [name, section] of Object.entries(sections)) {
        const sectionPage = await context.newPage();
        sectionPage.setDefaultTimeout(10000);
        sectionPage.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
        try {
          await sectionPage.route('https://cdn.discordapp.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' }));
          await sectionPage.goto(`http://127.0.0.1:${server.address().port}/viewer.html?lang=${language}`);
          await sectionPage.locator('#consent').click();
          await sectionPage.locator('#create-first').waitFor();
          await sectionPage.locator('#overlay button.btn').click();
          await sectionPage.locator('.entry').first().waitFor();
          await section(sectionPage);
        } catch (error) { failures.push(`${name}: ${error.message.split('\n').slice(0, 12).join(' ')}`); }
        finally { await sectionPage.close(); }
      }
      assert.deepEqual(failures, [], `${language} reading flow`);
      assert.deepEqual(errors, [], `${language} viewer page errors`);
      console.log(`Viewer ${language}/${colorScheme}: save, create, revisions, 400px layout and ${Object.keys(sections).length} reading flow sections passed`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
