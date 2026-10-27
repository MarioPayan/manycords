// Render local SVG artwork without external services. Requires Playwright Chromium.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const iconDirectory = new URL('../icons/', import.meta.url);
let browser;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  await mkdir(iconDirectory, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const source = size <= 32 ? 'icon-small.svg' : 'icon.svg';
    const svg = await readFile(new URL(source, iconDirectory), 'utf8');
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    const output = fileURLToPath(new URL(`icon-${size}.png`, iconDirectory));
    await page.screenshot({ path: output, omitBackground: true });
    await page.close();
    console.log(`Rendered icons/icon-${size}.png from ${source}`);
  }
} catch (error) {
  console.error('Icon rendering failed. Run npm install and npx playwright install chromium, then retry node scripts/render-icons.mjs.');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
