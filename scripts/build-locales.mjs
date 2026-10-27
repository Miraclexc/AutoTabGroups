import { readFile, writeFile, mkdir } from 'node:fs/promises';
const keys = { extensionName: 'extension.name', extensionDescription: 'extension.description', openExtension: 'extension.open', commandCurrent: 'extension.commandCurrent', commandWindow: 'extension.commandWindow', commandNew: 'extension.commandNew' };
for (const [locale, chromeLocale] of [['en', 'en'], ['zh-CN', 'zh_CN']]) {
  const catalog = JSON.parse(await readFile(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'));
  const messages = Object.fromEntries(Object.entries(keys).map(([key, resource]) => {
    if (!catalog[resource]) throw new Error(`Missing ${locale}: ${resource}`);
    return [key, { message: catalog[resource] }];
  }));
  const directory = new URL(`../public/_locales/${chromeLocale}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('messages.json', directory), JSON.stringify(messages, null, 2) + '\n');
}
