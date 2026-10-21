// Targeted real-browser usability checks. Run after building; all model traffic stays local.
// node scripts/usability-regression.mjs . <chromium.exe> <round>
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mockModelReply } from './mock-models.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.argv[2] || process.cwd()] }));
const round = process.argv[4] || 'usability-regression';
assert.match(round, /^[a-zA-Z0-9_-]+$/);
const output = resolve('output/playwright/ui', round);
await mkdir(output, { recursive: true });
const extension = resolve('.output/chrome-mv3');
const held = new Set();
let mode = 'normal', onHeld;
const releaseAll = () => { for (const release of held) release(); held.clear(); };
const report = { round, checks: [], screenshots: [], pageErrors: [], modelRequests: 0 };
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/page/')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<html><head><title>Chrome 扩展开发指南</title><meta name="description" content="Chrome extension development documentation"></head><body><h1>Chrome extension development</h1></body></html>'); return;
  }
  if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/messages'].includes(request.url)) { response.writeHead(404); response.end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  report.modelRequests++;
  if (mode === 'hold') await new Promise(resolve => {
    const release = () => { held.delete(release); resolve(); };
    held.add(release); response.once('close', release); onHeld?.();
  });
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(mockModelReply(request.url, JSON.parse(raw), [{ name: '浏览器开发', description: 'Chrome extension development', include: [], exclude: [], color: 'blue' }])));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context, sidebar, options, rpc, windowId;
const poll = async (read, accept, name, timeout = 15000) => {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await read(); if (accept(value)) return value; await delay(40); }
  throw Error(`${name}: ${JSON.stringify(value)}`);
};
const state = () => rpc({ type: 'workspace-state', windowId });
const nextTask = previousId => poll(state, value => value.task && value.task.id !== previousId, 'New task');
const finished = id => poll(state, value => value.task?.id === id && value.task.status !== 'running' && !value.busy, 'Task completion', 30000);
const shot = async name => { await sidebar.screenshot({ path: resolve(output, `${name}.png`), fullPage: false }); report.screenshots.push(name); };
const check = async (name, work) => { await work(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); };

try {
  context = await chromium.launchPersistentContext(resolve('.browser-test', `${round}-${Date.now()}`), {
    executablePath: process.argv[3], headless: false,
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-background-networking'],
    viewport: { width: 400, height: 720 }, reducedMotion: 'reduce',
  });
  context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  sidebar = await context.newPage();
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await check('Settings opens from the sidebar as a reusable browser tab; packaged icons are valid', async () => {
    await sidebar.getByRole('button', { name: '打开配置', exact: true }).first().click();
    options = await poll(() => context.pages().find(page => page.url() === `chrome-extension://${extensionId}/options.html`), value => !!value, 'Options tab');
    const manifest = await options.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.options_ui.open_in_tab, true);
    for (const size of [16, 32, 48, 128]) {
      for (const map of [manifest.icons, manifest.action.default_icon]) {
        assert(map?.[String(size)], `Missing ${size}px icon`);
        const png = await readFile(resolve(extension, map[String(size)]));
        assert.equal(png.readUInt32BE(0), 0x89504e47); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
      }
    }
    await sidebar.getByRole('button', { name: '打开配置', exact: true }).first().click();
    const settingsTabs = await options.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url === chrome.runtime.getURL('options.html')));
    assert.equal(settingsTabs.length, 1, 'Repeated settings entry should reuse the existing tab');
    report.optionsEntry = { openInTab: true, tabCount: settingsTabs.length };
  });
  rpc = async command => { const result = await options.evaluate(value => chrome.runtime.sendMessage(value), command); if (!result.ok) throw Error(result.error); return result.data; };
  windowId = await options.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await options.getByRole('tab', { name:'服务', exact:true }).click();
  await options.getByLabel('Base URL', { exact: true }).fill(`${base}/v1`);
  await options.getByLabel('模型名称', { exact: true }).fill('mock-chat');
  await options.getByRole('button', { name: '保存配置', exact: true }).click();
  await poll(state, value => value.settings.generator.model === 'mock-chat', 'Saved settings');
  await options.getByText('已保存', { exact: true }).waitFor();
  const fixture = await context.newPage(); await fixture.goto(`${base}/page/chrome-one`);
  await poll(state, value => value.tabs.some(tab => tab.active && tab.eligible), 'Active fixture');
  await poll(() => sidebar.locator('.current-title').textContent(), text => text.includes('Chrome'), 'Current title');
  await check('Single-page initialization keeps concise actions and excludes unsupported pages', async () => {
    await poll(() => sidebar.getByRole('button', { name: '整理当前页', exact: true }).isDisabled(), value => value, 'No existing target disables current-page grouping');
    assert.equal(await sidebar.locator('.batch-section .action-scope,.batch-section .sidebar-hint').count(), 0);
    assert.equal(await sidebar.locator('.batch-section').getByRole('button', { name: /手动建组/ }).count(), 0);
    assert.equal(await sidebar.getByRole('button', { name: /手动建组/ }).count(), 1);
    assert.equal(await sidebar.locator('.groups-section').getByRole('button', { name: '手动建组', exact: true }).isVisible(), true);
    await sidebar.getByRole('button', { name: /^查看不参与页面/ }).click();
    assert.match(await sidebar.locator('.scope-pages').innerText(), /扩展页面|浏览器页面/);
    assert.equal(await sidebar.locator('.scope-pages li').count(), (await state()).tabs.filter(tab => !tab.eligible).length);
    await shot('one-page-guidance');
    const previous = (await state()).task?.id, before = report.modelRequests;
    await sidebar.getByRole('button', { name: '更新分组', exact: true }).click();
    const task = (await nextTask(previous)).task; const result = await finished(task.id);
    assert.equal(result.groups.length, 0); assert.equal(report.modelRequests, before, 'Below-minimum initialization must not call a model');
    await options.getByRole('tab', {name:'常规',exact:true}).click();
    await options.locator('#activity > summary').click();
    assert.equal(await sidebar.locator('.recent-section,.task-details').count(), 0);
    await poll(() => options.locator('.task-state strong').textContent(), text => text === '本次未移动标签', 'No-move result');
    assert.match(result.task.items[0].message, /3/); await shot('one-page-result');
  });
  const manualGroup = async () => {
    await sidebar.locator('.groups-section').getByRole('button', { name: '手动建组', exact: true }).click();
    await sidebar.getByLabel('名称', { exact: true }).fill('浏览器开发');
    await sidebar.getByLabel('分组说明', { exact: true }).fill('Chrome extension development');
    await sidebar.getByRole('dialog').getByRole('checkbox').first().check();
    await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
    await sidebar.getByRole('dialog').waitFor({ state: 'hidden' });
  };
  await check('Manual one-page exception and undo remain usable without stale undo text in the next result', async () => {
    await manualGroup(); assert.equal((await state()).groups[0].members.length, 1);
    await options.getByRole('button', { name: /撤销最近变更/ }).click();
    await poll(state, value => !value.groups.length, 'Manual undo');
    const previous = (await state()).task.id;
    await sidebar.getByRole('button', { name: '更新分组', exact: true }).click();
    await finished((await nextTask(previous)).task.id);
    await poll(() => options.locator('.task-state strong').textContent(), text => text === '本次未移动标签', 'New result');
    assert(!/已撤销/.test(await options.locator('.recent-section').innerText()), 'Previous undo must not appear as part of the new result');
    await poll(() => sidebar.locator('.sidebar-feedback').innerText(), text => !/已撤销/.test(text), 'Old undo notice cleared');
    await shot('new-result-after-undo');
  });
  await manualGroup();
  await worker.evaluate(() => {
    const setTitle = chrome.action.setTitle.bind(chrome.action);
    globalThis.__usabilityTitleDelay = 0;
    chrome.action.setTitle = async (...args) => {
      if (globalThis.__usabilityTitleDelay) await new Promise(resolve => globalThis.setTimeout(resolve, globalThis.__usabilityTitleDelay));
      return setTitle(...args);
    };
  });
  await options.getByRole('tab', {name:'服务',exact:true}).click();
  report.recovery = [];
  for (const delayMs of [0, 600]) await check(`Cancel restores both pages and an actual UI restart succeeds (${delayMs}ms final API delay)`, async () => {
    await worker.evaluate(ms => { globalThis.__usabilityTitleDelay = ms; }, delayMs);
    const page = await context.newPage(); await page.goto(`${base}/page/chrome-cancel-${delayMs}`);
    const target = await poll(state, value => value.tabs.some(tab => tab.active && tab.eligible && tab.url.endsWith(`/page/chrome-cancel-${delayMs}`)), 'Cancellation fixture');
    const tabId = target.tabs.find(tab => tab.active && tab.eligible).id;
    await poll(() => sidebar.getByRole('button', { name: '整理当前页', exact: true }).isDisabled(), value => !value, 'Current-page action ready');
    mode = 'hold';
    const requestArrived = new Promise(resolve => { onHeld = resolve; });
    try {
      const previous = (await state()).task?.id;
      await sidebar.getByRole('button', { name: '整理当前页', exact: true }).click();
      const started = await nextTask(previous);
      assert.equal(started.task.items[0].tab.id, tabId, 'Current-page entry must use the selected fixture');
      await Promise.race([requestArrived, delay(10000).then(() => { throw Error('Expected held model request'); })]);
      await sidebar.getByRole('button', { name: '取消任务', exact: true }).waitFor();
      await poll(() => options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).isDisabled(), value => value, 'Running lock received by configuration');
      await options.getByLabel('模型名称', { exact: true }).fill(`unsaved-cancel-draft-${delayMs}`);
      assert.equal(await options.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true);
      const cancelledAt = Date.now();
      await sidebar.getByRole('button', { name: '取消任务', exact: true }).click();
      mode = 'normal'; releaseAll(); onHeld = undefined;
      const cancelled = await finished(started.task.id);
      assert.equal(cancelled.task.status, 'cancelled');
      const backgroundIdleMs = Date.now() - cancelledAt;
      await poll(() => sidebar.getByRole('button', { name: '更新分组', exact: true }).isDisabled(), value => !value, 'Sidebar must unlock without external tab/storage events', 5000);
      await poll(() => options.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), value => !value, 'Configuration must unlock without external events', 5000);
      assert.equal(await options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).isDisabled(), false);
      const uiReadyMs = Date.now() - cancelledAt;
      assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), `unsaved-cancel-draft-${delayMs}`);
      await shot(`cancel-recovered-${delayMs}`);
      await sidebar.getByRole('button', { name: '更新分组', exact: true }).click();
      const restarted = await nextTask(started.task.id);
      const completed = await finished(restarted.task.id);
      assert(completed.task.items.some(item => item.tab.id === tabId && item.status === 'applied'), 'UI restart must apply the previously cancelled tab');
      report.recovery.push({ delayMs, backgroundIdleMs, uiReadyMs, actualUiRestart: true });
    } finally { mode = 'normal'; releaseAll(); onHeld = undefined; }
  });
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.checks.push({ name: 'Usability regression', passed: false, error: error.stack || error.message });
  console.error(error);
  await sidebar?.screenshot({ path: resolve(output, 'failure-sidebar.png'), fullPage: true }).catch(() => {});
  await options?.screenshot({ path: resolve(output, 'failure-options.png'), fullPage: true }).catch(() => {});
} finally {
  mode = 'normal'; releaseAll();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
console.log(`${report.checks.filter(item => item.passed).length}/${report.checks.length} usability checks passed; ${output}`);
if (report.checks.some(item => !item.passed)) process.exitCode = 1;
