import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractPage } from '../extraction/readability';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], registration: 'runtime',
  main() {
    // Repeated manual injections must not add duplicate listeners.
    const marker = '__autoTabGroupsExtractorV1';
    const world = globalThis as typeof globalThis & Record<string, unknown>;
    if (world[marker]) return;
    world[marker] = true;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id || message?.type !== 'extract-page') return;
      const limit = Math.max(500, Math.min(20000, Number(message.maxChars) || 6000));
      reply({ page: extractPage(document, message.readContent === true, limit), documentUrl: location.href });
    });
  },
});
