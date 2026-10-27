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
      await page.goto(`http://127.0.0.1:${server.address().port}/viewer.html?lang=${language}`);
      await page.locator('.entry').first().waitFor();
      assert.equal(await page.locator('.entry').count(), 400, 'all collection is capped at MAX_SHOWN');
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
      await page.waitForFunction(() => document.querySelectorAll('.entry').length === 14);
      assert.equal(await page.locator('h1').textContent(), 'Game Club');
      await page.click('#edit');
      await page.fill('#cname', 'Reading list');
      await page.click('[data-pill="mem"]');
      await page.click('#sdone');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Reading list');
      assert.ok(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.find((c) => c.id === 'club').ids.includes('mem')));
      await page.click('#add');
      await page.fill('#cname', 'Art');
      await page.click('[data-pill="eve"]');
      await page.click('#sdone');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Art' && document.querySelectorAll('.entry').length === 1);
      assert.deepEqual(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.find((c) => c.name === 'Art').ids), ['eve']);
      assert.match(await page.locator('.entry .txt').textContent(), /Game jam/);
      // Incoming revisions preserve the draft and its typed name; cancel never saves it.
      await page.click('#add'); await page.fill('#cname', 'Draft'); await page.click('[data-pill="gen"]');
      const beforeRevision = await page.evaluate(() => viewerQueries.length);
      await page.evaluate(async () => { const { rev } = await browser.storage.local.get('rev'); await browser.storage.local.set({ rev: rev + 1 }); });
      await page.waitForFunction((count) => viewerQueries.length > count, beforeRevision);
      assert.equal(await page.inputValue('#cname'), 'Draft');
      await page.click('#scancel');
      assert.equal(await page.evaluate(async () => (await browser.storage.local.get('collections')).collections.some((c) => c.name === 'Draft')), false);
      await page.click('[data-collection="club"]');
      await page.waitForFunction(() => document.querySelectorAll('.entry').length === 14);
      await page.setViewportSize({ width: 400, height: 800 });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no document overflow at 400px');
      assert.equal(await page.evaluate(() => document.querySelector('#scroll').scrollWidth > document.querySelector('#scroll').clientWidth), false, 'no feed overflow at 400px');
      await page.click('#edit');
      assert.equal(await page.evaluate(() => document.querySelector('.sheet').scrollWidth > innerWidth), false, 'no sheet overflow at 400px');
      await page.click('#scancel');
      assert.deepEqual(errors, [], `${language} viewer page errors`);
      console.log(`Viewer ${language}/${colorScheme}: save, create, revisions and 400px layout passed`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
