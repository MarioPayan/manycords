// Full Chromium extension pipeline, including MAIN-world gateway capture and real IndexedDB.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const extension = fileURLToPath(new URL('../../dist/chrome/', import.meta.url));
const context = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium', // full Chromium: the headless shell cannot load extensions
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  // capture is gated on consent: wait for the schema init, then consent as the welcome screen would
  await worker.evaluate(async () => {
    while (!(await chrome.storage.local.get('schema')).schema) await new Promise((r) => setTimeout(r, 50));
    await chrome.storage.local.set({ consentedAt: Date.now() });
  });
  const errors = [];
  worker.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const timestamp = new Date().toISOString();
  const frames = [
    { op: 10, s: null, t: null, d: { heartbeat_interval: 41250 } },
    { op: 0, s: 1, t: 'READY', d: { guilds: [{ id: 'g1', properties: { name: 'Community' }, channels: [
      { id: 'k1', name: 'Information', type: 4, position: 0 },
      { id: 'c1', name: 'news', type: 0, parent_id: 'k1', position: 0 },
      { id: 'c2', name: 'general', type: 0, position: 1 },
    ] }] } },
    { op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: '100', channel_id: 'c1', guild_id: 'g1', content: 'Patch 2.3 tomorrow', timestamp, author: { id: 'u1', username: 'Leo' } } },
    { op: 0, s: 3, t: 'MESSAGE_CREATE', d: { id: '101', channel_id: 'c2', guild_id: 'g1', content: 'Hello from the gateway', timestamp, author: { id: 'u2', username: 'Ana' } } },
    // an HTTP history page (what Discord loads when the user scrolls up): an array of messages without guild_id
    [{ id: '090', channel_id: 'c2', content: 'Older message from history', timestamp: new Date(Date.now() - 3600e3).toISOString(), author: { id: 'u3', username: 'Mo' } }],
  ];
  await page.route('https://discord.com/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<script>for (const frame of ${JSON.stringify(frames.map((frame) => JSON.stringify(frame)))}) JSON.parse(frame);</script>`,
  }));
  await page.goto('https://discord.com/app');
  // Poll committed state instead of sleeping through the capture pipeline.
  const viewer = await context.newPage();
  viewer.on('pageerror', (error) => errors.push(error.message));
  await viewer.goto(`chrome-extension://${id}/viewer.html`);
  await viewer.waitForFunction(async () => (await feedDB.recent({ all: true }, {}, 10)).length === 3);
  const history = await viewer.evaluate(async () => feedDB.get('messages', '090'));
  assert.equal(history.source, 'history', 'history pages are captured passively');
  assert.equal(history.guild_id, 'g1', 'history rows get guild_id from the stored channel');
  await viewer.locator('.entry .txt').filter({ hasText: 'Patch 2.3 tomorrow' }).waitFor();
  await viewer.locator('.entry .txt').filter({ hasText: 'Hello from the gateway' }).waitFor();
  // rev is announced through the background queue after writes: wait for it, fail if it never comes
  await viewer.waitForFunction(async () => ((await chrome.storage.local.get('rev')).rev ?? 0) > 0, null, { timeout: 5000 });
  const snapshot = await viewer.evaluate(async () => ({
    settings: await chrome.storage.local.get(null),
    channels: await feedDB.channels(),
    events: await feedDB.events(0),
  }));
  assert.equal(snapshot.settings.collections[0].all, true);
  assert.ok(snapshot.settings.rev > 0, 'background publishes committed writes');
  assert.deepEqual(snapshot.channels.map((c) => c.id).sort(), ['c1', 'c2', 'k1']);
  assert.ok(snapshot.events.some((event) => event.type === 'start'));
  assert.ok(!Object.keys(snapshot.settings).some((key) => /^[mce]:/.test(key)), 'large records stay out of storage.local');
  // A partial update and delete must retain the original author and body in both DB and UI.
  await page.evaluate(() => {
    JSON.parse(JSON.stringify({ op: 0, s: 4, t: 'MESSAGE_UPDATE', d: { id: '100', channel_id: 'c1', guild_id: 'g1', content: 'Patch edited', edited_timestamp: new Date().toISOString() } }));
    JSON.parse(JSON.stringify({ op: 0, s: 5, t: 'MESSAGE_DELETE', d: { id: '100', channel_id: 'c1', guild_id: 'g1' } }));
  });
  await viewer.locator('.entry.deleted .txt').filter({ hasText: 'Patch edited' }).waitFor();
  assert.equal(await viewer.evaluate(async () => (await feedDB.get('messages', '100')).author.name), 'Leo');
  assert.equal(await viewer.locator('.entry').count(), 3); // two gateway messages + one history message
  assert.deepEqual(errors, []);
  if (process.argv[2]) await viewer.screenshot({ path: resolve(process.argv[2]), fullPage: true });
  console.log('Chrome gateway → IndexedDB → viewer passed');
} finally {
  await context.close();
}
