import { readFileSync } from 'node:fs';
export const messages = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url)));
export const i18n = {
  getUILanguage: () => 'en',
  getMessage(key, substitutions = []) {
    const entry = messages[key];
    if (!entry) throw new Error(`Unknown locale key: ${key}`);
    return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name) => {
      const index = Number(entry.placeholders[name.toLowerCase()].content.slice(1)) - 1;
      return [].concat(substitutions)[index] ?? '';
    });
  },
};
