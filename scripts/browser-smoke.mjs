import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mockModelReply } from './mock-models.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.argv[2] || process.cwd()] }));
const requests = [];
const groups = [{ name: '插件开发', description: 'Chrome extension development', include: [], exclude: [], color: 'blue' }];
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/page/')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const relevant = request.url.includes('chrome');
    response.end(`<html><head><title>${relevant ? 'Chrome extension guide' : 'Cooking recipe'} ${request.url}</title><meta name="description" content="${relevant ? 'Chrome extension documentation' : 'Pasta cooking'}"></head><body><article><h1>${relevant ? 'Chrome extensions' : 'Cooking'}</h1>${'<p>BODY_MARKER Detailed article with practical browser examples and documentation.</p>'.repeat(40)}</article></body></html>`);
    return;
  }
  response.setHeader('Content-Type', 'application/json'); response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method === 'OPTIONS') { response.end('{}'); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw || '{}'); requests.push({ path: request.url, body });
  const reply = mockModelReply(request.url, body, groups);
  if (reply) response.end(JSON.stringify(reply)); else { response.writeHead(404); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve('output/playwright'); await mkdir(output, { recursive: true });
const profile = resolve('.browser-test', `organizer-${Date.now()}`);
const extension = resolve('.output/chrome-mv3');
let context;
const launchOptions = {
  executablePath: process.argv[3] || undefined, headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--no-first-run'],
  viewport: { width: 440, height: 980 },
};
try {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  let ui = await context.newPage(); const errors = [];
  ui.on('pageerror', e => errors.push(e.message));
  await ui.goto(`chrome-extension://${extensionId}/options.html`);
  await ui.getByRole('heading', { name: '模型服务', exact: true }).waitFor();
  const rpc = async command => {
    const result = await ui.evaluate(command => chrome.runtime.sendMessage(command), command);
    if (!result?.ok) throw new Error(result?.error || 'No reply'); return result.data;
  };
  let windowId = await ui.evaluate(async () => (await chrome.windows.getCurrent()).id);
  const state = () => rpc({ type: 'workspace-state', windowId });
  const finished = async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await state();
      if (result.task && result.task.status !== 'running' && !result.busy) {
        assert.notEqual(result.task.status, 'failed', result.task.message); return result;
      }
      await delay(50);
    }
    throw new Error(`Task did not finish: ${JSON.stringify((await state()).task)}`);
  };
  // Fill actual config form; testing must not save a draft.
  await ui.getByLabel('Base URL', { exact: true }).fill(`${base}/v1`);
  await ui.getByLabel('模型名称', { exact: true }).fill('mock-chat');
  await ui.getByRole('button', { name: '测试 Chat 连接（不保存）' }).click();
  await ui.getByText('连接成功 · 当前草稿', { exact: true }).waitFor();
  assert.equal((await state()).settings.generator.model, '');
  await ui.getByRole('button', { name: '保存配置', exact: true }).click();
  await ui.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await state()).settings.generator.model, 'mock-chat');
  assert.equal((await state()).settings.classifierUseChat, true);
  assert.equal(await ui.getByRole('button', { name: '更新分组', exact: true }).count(), 0);
  await ui.screenshot({ path: resolve(output, 'configuration.png'), fullPage: true });
  // Three eligible pages, one irrelevant, one pinned. All only on local fixture server.
  const pages = [];
  for (const name of ['chrome1', 'chrome2', 'chrome3', 'cooking']) { const page = await context.newPage(); await page.goto(`${base}/page/${name}`); pages.push(page); }
  const pinnedId = await ui.evaluate(async base => (await chrome.tabs.create({ url: `${base}/page/chrome-pinned`, pinned: true, active: false })).id, base);
  const otherWindow = await ui.evaluate(async base => {
    const win = await chrome.windows.create({ url: `${base}/page/chrome-other-window`, focused: false });
    const groupId = await chrome.tabs.group({ tabIds: [win.tabs[0].id], createProperties: { windowId: win.id } });
    await chrome.tabGroups.update(groupId, { title: '其他窗口已有组', color: 'green' });
    return { windowId: win.id, groupId, tabId: win.tabs[0].id };
  }, base);
  await ui.goto(`chrome-extension://${extensionId}/sidepanel.html`); await ui.bringToFront();
  await ui.getByRole('heading', { name: '本窗口整理' }).waitFor();
  let snapshot = await state(); const targetId = snapshot.tabs.find(t => t.url === `${base}/page/chrome1`).id;
  const beforeSingle = requests.length;
  await assert.rejects(rpc({ type: 'organize', action: 'organize-current', windowId, tabId: targetId }), /没有分组/);
  assert.equal(requests.length, beforeSingle);
  await ui.getByRole('button', { name: '更新分组', exact: true }).click();
  snapshot = await finished();
  assert.equal(snapshot.groups.length, 1, JSON.stringify({ task: snapshot.task, requests }));
  assert.equal(snapshot.task.items.filter(i => i.status === 'applied').length, 3);
  assert.equal(snapshot.tabs.find(t => t.id === pinnedId).groupId, -1);
  assert.equal(await ui.evaluate(async id => (await chrome.tabs.get(id)).groupId, otherWindow.tabId), otherWindow.groupId);
  const nativeId = snapshot.groups[0].nativeId;
  assert(snapshot.groups[0].description);
  assert(!JSON.stringify(requests).includes('BODY_MARKER'));
  await ui.screenshot({ path: resolve(output, 'sidebar-result.png'), fullPage: true });
  // Drag out: cache hit despite an artificially old cache timestamp. This manipulates test fixtures only.
  await ui.evaluate(async id => {
    await chrome.tabs.ungroup(id);
    const stored = await chrome.storage.session.get('organizer.decisions.v2');
    for (const value of Object.values(stored['organizer.decisions.v2'] || {})) value.at = 0;
    await chrome.storage.session.set(stored);
  }, targetId);
  // First join to a native candidate establishes that exact candidate context's cache.
  await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: targetId }); await finished();
  await ui.evaluate(async id => {
    await chrome.tabs.ungroup(id);
    const stored = await chrome.storage.session.get('organizer.decisions.v2');
    for (const value of Object.values(stored['organizer.decisions.v2'] || {})) value.at = 0;
    await chrome.storage.session.set(stored);
  }, targetId);
  const beforeCached = requests.length;
  await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: targetId }); snapshot = await finished();
  assert.equal(requests.length, beforeCached); assert.equal(snapshot.task.items[0].cached, true);
  assert.equal(snapshot.tabs.find(t => t.id === targetId).groupId, nativeId);
  // Grouped navigation stays grouped and does not invoke classification.
  await pages[0].goto(`${base}/page/chrome-navigated`);
  const beforeGrouped = requests.length;
  await assert.rejects(rpc({ type: 'organize', action: 'organize-current', windowId, tabId: targetId }), /已在分组/);
  assert.equal(requests.length, beforeGrouped);
  // External group description is filled on an explicit update, never on a state refresh.
  await ui.evaluate(async base => {
    const tab = await chrome.tabs.create({ url: `${base}/page/chrome-user`, active: false });
    const id = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(id, { title: '手动原生组', color: 'orange' });
  }, base);
  const beforeView = requests.length; await state(); assert.equal(requests.length, beforeView);
  await rpc({ type: 'organize', action: 'organize-window', windowId }); snapshot = await finished();
  assert(snapshot.groups.find(g => g.name === '手动原生组').description);
  assert.equal(snapshot.groups.length, 2);
  // No-op classification did not replace prior effective undo.
  assert(snapshot.journal.records.some(r => r.tab.id === targetId));
  // Native APIs register commands; this does not pretend to verify OS key delivery.
  const commands = await ui.evaluate(() => chrome.commands.getAll());
  assert.deepEqual(commands.filter(c => !c.name.startsWith('_')).map(c => c.name).sort(), ['organize-current', 'organize-window', 'organize-window-with-new']);
  console.log('Registered commands:', commands.map(c => ({ name: c.name, shortcut: c.shortcut })));
  // Manual one-page creation via real UI.
  await ui.getByRole('button', { name: '手动建组', exact: true }).click();
  const editor = ui.locator('form');
  await editor.getByLabel('名称', { exact: true }).fill('烹饪');
  await editor.getByRole('checkbox').first().check();
  await ui.getByRole('button', { name: '保存分组' }).click();
  await ui.getByText('分组已保存', { exact: true }).waitFor();
  snapshot = await state(); assert(snapshot.groups.some(g => g.name === '烹饪' && g.members.length === 1));
  await rpc({ type: 'undo' }); snapshot = await state(); assert(!snapshot.groups.some(g => g.name === '烹饪'));
  await ui.locator('.native-group').filter({ hasText: '烹饪' }).waitFor({ state: 'hidden' });
  await ui.setViewportSize({ width: 320, height: 900 });
  await ui.screenshot({ path: resolve(output, 'sidebar-320.png'), fullPage: true });
  assert(await ui.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  // A genuine extension-page click opens a native SIDE_PANEL context.
  await ui.evaluate(windowId => {
    const button = globalThis.document.createElement('button'); button.id = 'smoke-open-panel'; button.textContent = 'Test native panel';
    button.addEventListener('click', () => { void chrome.sidePanel.open({ windowId }); });
    globalThis.document.body.append(button);
  }, windowId);
  await ui.locator('#smoke-open-panel').click();
  let sidePanelContexts = [];
  for (let i = 0; i < 40; i++) {
    sidePanelContexts = await ui.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
    if (sidePanelContexts.length) break;
    await delay(50);
  }
  assert(sidePanelContexts.some(c => c.documentUrl.endsWith('/sidepanel.html')), 'Native side panel context must load');
  console.log('PASS native SIDE_PANEL context opened by user gesture');
  // Full browser restart: restore native groups, rebind descriptions, never reuse the old session.
  const previousSession = snapshot.sessionId;
  const previousGroups = (await state()).groups.map(g => ({ name: g.name, description: g.description }));
  await ui.evaluate(id => chrome.windows.remove(id), otherWindow.windowId);
  await context.close();
  context = await chromium.launchPersistentContext(profile, { ...launchOptions, args: [...launchOptions.args, '--restore-last-session'] });
  const restoredWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(restoredWorker.url()).host, extensionId);
  ui = await context.newPage(); ui.on('pageerror', e => errors.push(e.message));
  await ui.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await ui.getByRole('heading', { name: '本窗口整理' }).waitFor();
  windowId = await ui.evaluate(async () => (await chrome.windows.getCurrent()).id);
  snapshot = await state();
  assert.notEqual(snapshot.sessionId, previousSession);
  assert.deepEqual(snapshot.groups.map(g => ({ name: g.name, description: g.description })).sort((a, b) => a.name.localeCompare(b.name)),
    previousGroups.sort((a, b) => a.name.localeCompare(b.name)));
  await assert.rejects(rpc({ type: 'undo' }), /会话/);
  const newPage = await context.newPage(); await newPage.goto(`${base}/page/chrome-restored`);
  const newTabId = (await state()).tabs.find(t => t.url.endsWith('/page/chrome-restored')).id;
  const beforeRestoreJoin = snapshot.groups.length;
  await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: newTabId });
  snapshot = await finished();
  assert.equal(snapshot.groups.length, beforeRestoreJoin); assert.equal(snapshot.task.items[0].status, 'applied');
  await ui.screenshot({ path: resolve(output, 'sidebar-restored.png'), fullPage: true });
  // Existing provider adapters must remain usable through the new config UI and workflow.
  await ui.goto(`chrome-extension://${extensionId}/options.html`);
  await ui.getByRole('heading', { name: '模型服务', exact: true }).waitFor();
  await ui.getByLabel('复用标准 Chat 服务').uncheck();
  for (const backend of ['jev', 'openai-decisions', 'llm']) {
    console.log('Testing independent backend:', backend, 'reuse:', await ui.getByLabel('复用标准 Chat 服务').isChecked());
    await ui.getByLabel('分类后端', { exact: true }).selectOption(backend);
    if (backend === 'llm') {
      await ui.getByLabel('接口协议', { exact: true }).selectOption('anthropic');
      await ui.getByLabel('Base URL', { exact: true }).nth(1).fill(`${base}/v1`);
      await ui.getByLabel('模型名称', { exact: true }).nth(1).fill('mock-anthropic');
    } else {
      await ui.getByLabel('完整接口 URL', { exact: true }).fill(`${base}/v1/${backend === 'jev' ? 'systemone' : 'decisions'}`);
      await ui.getByLabel('分类模型名称', { exact: true }).fill(`mock-${backend}`);
    }
    await ui.getByRole('button', { name: '测试归组连接（不保存）' }).click();
    await ui.getByText('连接成功 · 当前草稿', { exact: true }).waitFor();
    await ui.getByRole('button', { name: '保存配置', exact: true }).click();
    await ui.getByText('已保存', { exact: true }).waitFor();
    const extra = await context.newPage(); await extra.goto(`${base}/page/chrome-${backend}`);
    const extraId = (await state()).tabs.find(t => t.url.endsWith(`/page/chrome-${backend}`)).id;
    await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: extraId });
    snapshot = await finished(); assert.equal(snapshot.task.items[0].status, 'applied');
  }
  assert(requests.some(r => r.path === '/v1/systemone'));
  assert(requests.some(r => r.path === '/v1/decisions'));
  assert(requests.some(r => r.path === '/v1/messages'));
  console.log('PASS Jev, Decisions and independent Anthropic-compatible Chat through config UI and real groups');
  assert.deepEqual(errors, []);
  console.log(`PASS native grouping, config draft tests, initialization, pinned exclusion, metadata-only, cached drag-out, grouped navigation, external descriptions, manual small group, undo, narrow UI, native side panel and browser restart. ${requests.length} local model requests.`);
} catch (error) {
  const failed = context?.pages().find(p => /options\.html/.test(p.url()));
  if (failed) await failed.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
