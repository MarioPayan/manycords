// Node >= 20. The extension runs directly from these files, without bundling.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const files = ['hook.js', 'relay.js', 'background.js', 'db.js', 'gaps.js', 'threads.js', 'viewer.html', 'viewer.js', '_locales', 'fonts'];
const hasZip = !spawnSync('zip', ['-v'], { stdio: 'ignore' }).error;
for (const browser of ['chrome', 'firefox']) {
  const destination = resolve(root, 'dist', browser);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of files) await cp(resolve(root, file), resolve(destination, file), { recursive: true });
  const output = structuredClone(manifest);
  if (browser === 'chrome') {
    delete output.background.scripts;
    delete output.browser_specific_settings;
  } else delete output.background.service_worker;
  await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(output, null, 2)}\n`);
  if (hasZip) {
    const archive = resolve(root, 'dist', `discord-feed-${browser}-${manifest.version}.zip`);
    await rm(archive, { force: true });
    const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: destination, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Could not package ${browser}`);
  }
  console.log(`Built dist/${browser}${hasZip ? ' and zip archive' : ''}`);
}
