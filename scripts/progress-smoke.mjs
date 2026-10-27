// Uses an isolated Chromium profile and local mock models; no real API credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { mockModelReply } from './mock-models.mjs';

let hold = false;
const pending = new Set();
const groups = [{ name: '插件开发', description: 'Chrome extension development', include: [], exclude: [], color: 'blue' }];
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/page/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Chrome extension guide ${req.url}</title><meta name="description" content="Chrome extension development"><main>Local test page</main>`);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end('{}'); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const reply = mockModelReply(req.url, JSON.parse(raw || '{}'), groups);
  if (hold) await new Promise(resolve => {
    const release = () => { pending.delete(release); resolve(); };
    pending.add(release); res.once('close', release);
  });
  res.end(JSON.stringify(reply));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve('output/playwright/progress'); await mkdir(output, { recursive: true });
const extension = resolve('.output/chrome-mv3');
const poll = async (read, predicate) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await delay(30); }
  throw new Error('Progress smoke condition timed out');
};
let context;
try {
  context = await chromium.launchPersistentContext(resolve('.browser-test', `progress-${Date.now()}`), {
    executablePath: process.argv[2] || undefined, headless: false,
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--no-first-run'],
    viewport: { width: 440, height: 980 },
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const root = `chrome-extension://${new URL(worker.url()).host}`;
  const ui = await context.newPage(); const errors = [];
  ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`${root}/sidepanel.html`);
  await ui.getByRole('heading', { name: '本窗口整理' }).waitFor();
  const rpc = async command => {
    const result = await ui.evaluate(command => chrome.runtime.sendMessage(command), command);
    assert(result?.ok, result?.error); return result.data;
  };
  const windowId = await ui.evaluate(async () => (await chrome.windows.getCurrent()).id);
  const state = () => rpc({ type: 'workspace-state', windowId });
  const initial = await state();
  const native = await ui.evaluate(() => ({ manifest: chrome.runtime.getManifest(), name: chrome.i18n.getMessage('extensionName'), description: chrome.i18n.getMessage('extensionDescription') }));
  assert.equal(native.manifest.default_locale, 'zh_CN');
  assert.equal(native.manifest.name, native.name);
  assert.equal(native.manifest.description, native.description);
  assert(!JSON.stringify(native).includes('__MSG_'), 'Chrome must resolve the bundled native locale');
  await rpc({ type: 'save-config', revision: initial.revision, settings: { ...initial.settings, classifierUseChat: true,
    generator: { ...initial.settings.generator, baseUrl: `${base}/v1`, model: 'mock-chat' } } });
  for (let i = 0; i < 4; i++) { const page = await context.newPage(); await page.goto(`${base}/page/chrome-${i}`); }
  await ui.bringToFront();
  hold = true;
  await ui.getByRole('button', { name: '更新分组', exact: true }).click();
  const progress = ui.getByRole('region', { name: '整理进度' });
  await progress.getByText('分析新组', { exact: true }).waitFor();
  await progress.locator('progress:not([value])').waitFor();
  assert.equal(await progress.locator('ol').count(), 0);
  await ui.screenshot({ path: resolve(output, 'plan.png'), fullPage: true });
  const releaseOne = async () => { await poll(() => pending.size, size => size > 0); pending.values().next().value(); };
  await releaseOne();
  await progress.locator('progress[value="0"][max="4"]').waitFor();
  await releaseOne();
  await progress.locator('progress[value="1"][max="4"]').waitFor();
  await progress.getByText('正在判断', { exact: true }).waitFor();
  await ui.screenshot({ path: resolve(output, 'pages.png'), fullPage: true });
  await ui.setViewportSize({ width: 320, height: 980 });
  await rpc({ type: 'save-ui-preferences', patch: { theme: 'dark', locale: 'en' } });
  await ui.getByRole('region', { name: 'Organizing progress' }).getByText('Stage progress', { exact: true }).waitFor();
  assert.equal(await ui.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
  await ui.screenshot({ path: resolve(output, 'narrow-dark.png'), fullPage: true });
  await rpc({ type: 'save-ui-preferences', patch: { theme: 'light', locale: 'zh-CN' } });
  hold = false; for (const release of pending) release();
  const finished = await poll(state, value => value.task?.status !== 'running' && !value.busy);
  assert.equal(finished.task.items.filter(item => item.status === 'applied').length, 4);
  assert.equal(finished.task.version, 3);
  assert.equal(finished.task.outputLocale, 'zh-CN', 'Changing UI language must not change a running task output language');
  assert.equal(finished.task.message.code, 'task.finished');
  assert(finished.task.items.every(item => item.message.code === 'task.joined'), 'Persist structured messages for language switching');
  assert.equal(finished.groups.length, 1);
  await progress.waitFor({ state: 'hidden' });
  // Start a new uncached classification, then cancel using the visible progress control.
  const extra = await context.newPage(); await extra.goto(`${base}/page/chrome-extra`);
  hold = true; await ui.bringToFront();
  await ui.getByRole('button', { name: '更新分组', exact: true }).click();
  await poll(() => pending.size, size => size > 0);
  await progress.getByRole('button', { name: '取消任务', exact: true }).click();
  const cancelled = await poll(state, value => value.task?.status === 'cancelled' && !value.busy);
  assert.equal(cancelled.groups.length, 1);
  await progress.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS progress: native locales, structured task messages, fixed task output language, indeterminate planning, per-page counts, current page, no stage diagram, 320px dark English, native grouping, cancel. Models use local mocks only.');
} finally {
  hold = false; for (const release of pending) release();
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
