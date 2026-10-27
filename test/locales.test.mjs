import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const en = JSON.parse(read('_locales/en/messages.json'));
const es = JSON.parse(read('_locales/es/messages.json'));

test('locale parity, placeholders, and every key referenced by extension code', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  const used = new Set();
  for (const file of readdirSync(new URL('../', import.meta.url)).filter((name) => /\.(js|html|json)$/.test(name) && name !== 'package.json')) {
    const source = read(file);
    for (const match of source.matchAll(/\b(?:t|h|getMessage)\(\s*(?:'([^']+)'|[^?;\n]*\?\s*'([^']+)'\s*:\s*'([^']+)')/g)) {
      for (const key of match.slice(1).filter(Boolean)) used.add(key);
    }
    for (const match of source.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"|__MSG_(\w+)__/g)) used.add(match[1] ?? match[2]);
  }
  for (const key of used) { assert.ok(en[key], `English key ${key}`); assert.ok(es[key], `Spanish key ${key}`); }
  assert.ok(used.size > 80, 'includes static, dynamic, plural, and manifest keys');
  for (const key of Object.keys(en)) {
    assert.deepEqual(en[key].placeholders, es[key].placeholders, `Placeholder parity: ${key}`);
    for (const entries of [en, es]) {
      for (const match of entries[key].message.matchAll(/\$([A-Z_]+)\$/gi)) assert.ok(entries[key].placeholders?.[match[1].toLowerCase()], `Declared placeholder in ${key}`);
    }
  }
  const productName = en.appName.message;
  for (const entries of [en, es]) assert.deepEqual(Object.keys(entries).filter((key) => entries[key].message.includes(productName)), ['appName']);
  for (const file of ['viewer.html', 'viewer.js', 'background.js', 'manifest.json', 'threads.js']) assert.ok(!read(file).includes(productName), `Product name uses its single locale key in ${file}`);
});
