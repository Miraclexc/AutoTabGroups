import { mockModelReply } from './mock-models.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

// Usage: npm run test:browser -- [playwright node_modules directory] [chromium executable]
// Uses an isolated profile and only local mock endpoints. No user Chrome profile is touched.
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.argv[2] || process.cwd()] }));
const requests = [];
const groups = [{ name: '插件开发', description: '浏览器插件开发和 Chrome API 文档', include: ['Chrome', 'extension'], exclude: ['烹饪'], color: 'blue' }];
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/page/')) {
    const relevant = request.url.includes('chrome');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<html><head><title>${relevant ? 'Chrome extension guide' : 'Cooking recipe'}</title><meta name="description" content="${relevant ? 'Browser extension development guide' : 'Pasta recipe'}"></head><body><article><h1>${relevant ? 'Extension API' : 'Cooking'}</h1>${'<p>LOCAL_BODY_MARKER: This is a detailed article about the subject, with practical steps, examples and explanations for the reader.</p>'.repeat(40)}</article></body></html>`);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method === 'OPTIONS') { response.end('{}'); return; }
  let text = ''; for await (const chunk of request) text += chunk;
  const body = JSON.parse(text || '{}'); requests.push({ url: request.url, body });
  const reply = mockModelReply(request.url, body, groups);
    if (reply) response.end(JSON.stringify(reply));
    else { response.writeHead(404); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve('.browser-test');
await mkdir(output, { recursive: true });
let context;
let ui;
const profile = resolve(output, `profile-${Date.now()}`);
const extension = resolve('.output/chrome-mv3');
const launchOptions = {
  executablePath: process.argv[3] || undefined,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--no-first-run'],
  viewport: { width: 460, height: 1050 },
};
try {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  console.log('Browser capabilities:', await worker.evaluate(() => ({ userAgent: navigator.userAgent, localAccess: typeof chrome.storage.local.setAccessLevel, sessionAccess: typeof chrome.storage.session.setAccessLevel })));
  const extensionId = new URL(worker.url()).host;
  const relevant = await context.newPage(); await relevant.goto(`${base}/page/chrome`);
  const other = await context.newPage(); await other.goto(`${base}/page/cooking`);
  ui = await context.newPage();
  const pageErrors = [];
  ui.on('pageerror', error => pageErrors.push(error.message));
  await ui.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await ui.getByRole('heading', { name: 'AutoTabGroups', exact: true }).waitFor();
  console.log('UI state response:', await ui.evaluate(async () => {
    try { const result = await chrome.runtime.sendMessage({ type: 'state' }); return { ok: result?.ok, error: result?.error }; }
    catch (error) { return { error: String(error) }; }
  }));
  const protectedTabs = await ui.evaluate(async base => {
    const pinned = await chrome.tabs.create({ url: `${base}/page/chrome-pinned`, pinned: true, active: false });
    const grouped = await chrome.tabs.create({ url: `${base}/page/chrome-existing`, active: false });
    const groupId = await chrome.tabs.group({ tabIds: [grouped.id] });
    await chrome.tabGroups.update(groupId, { title: 'User managed', color: 'red' });
    return { pinnedId: pinned.id, groupedId: grouped.id, groupId };
  }, base);
  await ui.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await ui.getByLabel('思考强度', { exact: true }).inputValue(), 'off');
  const urls = ui.getByLabel('Base URL', { exact: true });
  await urls.nth(0).fill(`${base}/v1`); await urls.nth(1).fill(`${base}/v1/systemone`);
  const models = ui.getByLabel('模型名称', { exact: true });
  await models.nth(0).fill('mock-generator'); await models.nth(1).fill('mock-jev');
  await ui.getByLabel('思考强度', { exact: true }).selectOption('high');
  await ui.getByRole('button', { name: '保存设置', exact: true }).click();
  await ui.getByText('设置已保存', { exact: true }).waitFor();
  await ui.getByRole('button', { name: '分类', exact: true }).click();
  // A two-tab scan needs no plan and must not call any model.
  const beforeSmallPlan = requests.length;
  await ui.getByRole('button', { name: 'AI 生成分类', exact: true }).click();
  await ui.getByText('当前没有必要新增分类，零散标签保持未分组。', { exact: true }).waitFor();
  assert.equal(requests.length, beforeSmallPlan);
  await ui.getByRole('button', { name: '分类', exact: true }).click();
  // Name-only save, then explicit description generation with review before save.
  await ui.getByRole('button', { name: '＋ 添加分类', exact: true }).click();
  await ui.getByLabel('名称', { exact: true }).fill('临时分类');
  await ui.getByRole('button', { name: '保存分类', exact: true }).click();
  await ui.getByText('分类已保存', { exact: true }).waitFor();
  const namedOnly = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data.categories);
  assert.equal(namedOnly[0].description, '');
  await ui.getByRole('button', { name: '编辑', exact: true }).click();
  await ui.getByRole('button', { name: 'AI 生成描述', exact: true }).click();
  await ui.waitForFunction(() => globalThis.document.querySelector('form textarea')?.value.includes('学习资料'));
  const beforeDescriptionSave = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data.categories);
  assert.equal(beforeDescriptionSave[0].description, '');
  const descriptionCall = requests.at(-1);
  assert.deepEqual(JSON.parse(descriptionCall.body.messages.find(message => message.role === 'user').content), { name: '临时分类' });
  await ui.getByRole('button', { name: '保存分类', exact: true }).click();
  await ui.getByText('分类已保存', { exact: true }).waitFor();
  await ui.getByRole('button', { name: '删除分类 临时分类', exact: true }).click();
  let extraOne = await context.newPage(); await extraOne.goto(`${base}/page/chrome-extra-one`);
  let extraTwo = await context.newPage(); await extraTwo.goto(`${base}/page/chrome-extra-two`);
  await ui.getByRole('button', { name: 'AI 生成分类', exact: true }).click();
  await ui.getByRole('button', { name: '采用分类方案', exact: true }).waitFor();
  await ui.getByRole('button', { name: '采用分类方案', exact: true }).click();
  await ui.getByText('方案已合并到分类列表，可以点击更新分组', { exact: true }).waitFor();
  assert.equal(requests.find(item => item.url === '/v1/chat/completions').body.reasoning_effort, 'high');
  const readState = async () => ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data);
  const pollState = async predicate => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const current = await readState();
      if (predicate(current)) return current;
      await delay(100);
    }
    throw new Error('Timed out waiting for task state');
  };
  const waitComplete = async oldId => {
    const current = await pollState(state => state.task.id !== oldId && state.task.status !== 'running');
    assert.equal(current.task.status, 'completed', current.task.message);
  };
  const taskId = async () => ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data.task?.id);
  const initialCategory = (await readState()).categories[0];
  const candidateCategories = [initialCategory, ...['B', 'C', 'D'].map((letter, i) => ({ ...initialCategory, id: `candidate-${letter}`, name: `候选${letter}`, color: ['green', 'orange', 'purple'][i], description: `测试分类 ${letter}` }))];
  const savedCandidates = await ui.evaluate(async categories => chrome.runtime.sendMessage({ type: 'save-categories', categories }), candidateCategories);
  assert(savedCandidates.ok, savedCandidates.error);
  await extraOne.close(); await extraTwo.close();
  let oldId = await taskId();
  await ui.getByRole('button', { name: '更新分组', exact: true }).click(); await waitComplete(oldId);
  let smallState = await readState();
  assert.equal(smallState.task.items.filter(item => item.status === 'skipped').length, 1);
  assert.equal(smallState.nativeGroups.length, 1);
  assert.equal(smallState.task.items.find(item => item.status === 'skipped').candidates[0].score, 1);
  extraOne = await context.newPage(); await extraOne.goto(`${base}/page/chrome-extra-one`);
  oldId = await taskId();
  await ui.getByRole('button', { name: '更新分组', exact: true }).click(); await waitComplete(oldId);
  smallState = await readState();
  assert.equal(smallState.task.items.filter(item => item.status === 'skipped').length, 2);
  assert.equal(smallState.nativeGroups.length, 1);
  extraTwo = await context.newPage(); await extraTwo.goto(`${base}/page/chrome-extra-two`);
  oldId = await taskId();
  await ui.getByRole('button', { name: '更新分组', exact: true }).click(); await waitComplete(oldId);
  let state = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data);
  assert.equal(state.task.items.length, 4);
  assert.equal(state.task.items.filter(item => item.status === 'applied').length, 3);
  assert.equal(state.task.items.filter(item => item.status === 'unmatched').length, 1);
  assert.notEqual(state.tabs.find(tab => tab.url.endsWith('/page/chrome')).groupId, -1);
  assert.equal(state.tabs.find(tab => tab.url.includes('/page/cooking')).groupId, -1);
  assert.equal(state.tabs.find(tab => tab.id === protectedTabs.pinnedId).groupId, -1);
  assert.equal(state.tabs.find(tab => tab.id === protectedTabs.groupedId).groupId, protectedTabs.groupId);
  assert.equal(await ui.getByRole('region', { name: '候选分组分数' }).count(), state.task.items.length);
  assert.equal(await ui.getByText('100%', { exact: true }).count(), 3);
  const firstCandidates = ui.getByRole('region', { name: '候选分组分数' }).first();
  assert.equal(await firstCandidates.locator('li').count(), 3);
  assert((await firstCandidates.innerText()).includes('候选B'));
  assert(!(await firstCandidates.innerText()).includes('候选D'));
  assert.equal(await ui.locator('.metrics > div').count(), 3);
  assert.equal(await ui.getByText('待判断', { exact: true }).count(), 0);
  const candidateLayout = await firstCandidates.locator('li').evaluateAll(items => items.map(item => ({
    y: item.getBoundingClientRect().y,
    color: globalThis.getComputedStyle(item.querySelector('.candidate-color')).backgroundColor,
  })));
  assert(candidateLayout.every(item => item.y === candidateLayout[0].y));
  assert.deepEqual(candidateLayout.map(item => item.color), ['rgb(0, 0, 255)', 'rgb(0, 128, 0)', 'rgb(255, 165, 0)']);
  await ui.setViewportSize({ width: 320, height: 1050 });
  assert(await firstCandidates.evaluate(section => section.scrollWidth <= section.clientWidth));
  await ui.setViewportSize({ width: 460, height: 1050 });
  const lightCalls = requests.filter(item => item.url === '/v1/systemone');
  assert.equal(lightCalls.length, 4); assert(lightCalls.every(item => item.body.state.content === undefined));
  assert(lightCalls.every(item => item.body.state.extraction === 'metadata'));
  assert(state.task.items.every(item => item.preview === (item.tab.url.includes('cooking') ? 'Pasta recipe' : 'Browser extension development guide')));
  assert.deepEqual(await ui.locator('.page-preview').allTextContents(), state.task.items.map(item => item.preview));
  assert.equal(await ui.locator('.result-details[open]').count(), 0);
  assert.equal(await ui.locator('.results > li').first().locator('.row + p.page-preview').count(), 1);
  await ui.screenshot({ path: resolve(output, 'results-light.png'), fullPage: true });
  await ui.getByRole('button', { name: '撤销这次分组', exact: true }).click();
  await ui.getByText(/已撤销 3 个标签/).waitFor();
  state = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).data);
  assert.equal(state.tabs.find(tab => tab.url.endsWith('/page/chrome')).groupId, -1);
  const secondWindow = await ui.evaluate(async base => {
    const window = await chrome.windows.create({ url: [`${base}/page/chrome-second-window`, `${base}/page/chrome-second-window-2`, `${base}/page/chrome-second-window-3`], focused: false });
    return window.id;
  }, base);
  await pollState(state => state.tabs.some(tab => tab.url.endsWith('/page/chrome-second-window') && tab.title === 'Chrome extension guide'));
  await ui.getByLabel('整理范围', { exact: false }).selectOption('all');
  await pollState(state => state.settings.scope === 'all');
  await ui.getByLabel('读取网页正文', { exact: false }).check();
  // Wait for saved checkbox state, then run with a fresh input fingerprint.
  await pollState(state => state.settings.readContent);
  oldId = await taskId();
  await ui.getByRole('button', { name: '更新分组', exact: true }).click(); await waitComplete(oldId);
  const bodyCalls = requests.filter(item => item.url === '/v1/systemone').slice(lightCalls.length);
  assert.equal(bodyCalls.length, 7);
  assert(bodyCalls.every(item => item.body.state.extraction === 'readability' && item.body.state.content.includes('LOCAL_BODY_MARKER')));
  assert(bodyCalls.every(item => item.body.state.content.length <= 6000));
  state = await readState();
  assert(state.task.items.every(item => item.preview.includes('LOCAL_BODY_MARKER') && Array.from(item.preview).length <= 160));
  assert.deepEqual(await ui.locator('.page-preview').allTextContents(), state.task.items.map(item => item.preview));
  const first = state.tabs.find(tab => tab.url.endsWith('/page/chrome'));
  const second = state.tabs.find(tab => tab.url.endsWith('/page/chrome-second-window'));
  assert.equal(second.windowId, secondWindow);
  assert.notEqual(first.windowId, second.windowId);
  assert.notEqual(first.groupId, -1); assert.notEqual(second.groupId, -1);
  assert.notEqual(first.groupId, second.groupId);
  assert.equal(state.tabs.find(tab => tab.id === protectedTabs.groupedId).groupId, protectedTabs.groupId);
  await ui.screenshot({ path: resolve(output, 'results-content.png'), fullPage: true });
  await ui.getByRole('button', { name: '分类', exact: true }).click();
  await ui.screenshot({ path: resolve(output, 'groups.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
  // Native manual changes: keep a rename, clean a deletion, and adopt a
  // replacement with the same name without moving its existing tabs.
  await ui.evaluate(async ({ first, second }) => {
    await chrome.tabGroups.update(first.groupId, { title: '我的开发工作台' });
    const members = await chrome.tabs.query({ groupId: second.groupId });
    await chrome.tabs.ungroup(members.map(tab => tab.id));
  }, { first, second });
  await pollState(state => !state.bindings.some(binding => binding.groupId === second.groupId));
  const replacement = await ui.evaluate(async second => {
    const id = await chrome.tabs.group({ tabIds: [second.id], createProperties: { windowId: second.windowId } });
    await chrome.tabGroups.update(id, { title: '插件开发', color: 'green' });
    return id;
  }, second);
  await pollState(state => state.bindings.some(binding => binding.groupId === replacement));
  const beforeRestart = await readState();
  const sessionBefore = await ui.evaluate(async () => (await chrome.storage.session.get('sessionId')).sessionId);
  // Close the entire isolated browser, then launch the same profile with Chrome
  // session restore. Real model services are still never contacted.
  await context.close(); ui = undefined;
  context = await chromium.launchPersistentContext(profile, { ...launchOptions, args: [...launchOptions.args, '--restore-last-session'] });
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  state = await pollState(state => state?.nativeGroups?.length === beforeRestart.nativeGroups.length && state.bindings.length === 2);
  assert.deepEqual(state.task.items.map(item => item.candidates), beforeRestart.task.items.map(item => item.candidates));
  assert.deepEqual(state.task.items.map(item => item.preview), beforeRestart.task.items.map(item => item.preview));
  assert.equal(state.settings.generator.thinkingEffort, 'high', 'thinking setting must persist across browser restart');
  const sessionAfter = await ui.evaluate(async () => (await chrome.storage.session.get('sessionId')).sessionId);
  assert.notEqual(sessionBefore, sessionAfter, 'test must cross a real browser-session boundary');
  const renamed = state.nativeGroups.find(group => group.title === '我的开发工作台');
  assert(renamed); assert(state.bindings.some(binding => binding.groupId === renamed.id));
  const restoredOther = state.nativeGroups.find(group => group.title === 'User managed');
  assert(restoredOther); assert(!state.bindings.some(binding => binding.groupId === restoredOther.id));
  const newTab = await ui.evaluate(async ({ base, windowId }) => (await chrome.tabs.create({ windowId, url: `${base}/page/chrome-after-restart`, active: false })).id, { base, windowId: renamed.windowId });
  await pollState(state => state.tabs.some(tab => tab.id === newTab && tab.title === 'Chrome extension guide'));
  oldId = await taskId();
  const started = await ui.evaluate(async windowId => chrome.runtime.sendMessage({ type: 'start', kind: 'update', windowId }), renamed.windowId);
  assert(started.ok, started.error); await waitComplete(oldId);
  state = await readState();
  assert.equal(state.tabs.find(tab => tab.id === newTab).groupId, renamed.id);
  assert.equal(state.nativeGroups.length, beforeRestart.nativeGroups.length, 'restart must not create duplicate groups');
  await ui.getByRole('button', { name: '设置', exact: true }).click();
  for (const [model, protocol, effort, expected] of [
    ['gpt-5.2', 'openai', 'off', { reasoning_effort: 'none' }],
    ['claude-sonnet-4-6', 'anthropic', 'low', { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }],
    ['deepseek-v4-pro', 'openai', 'high', { thinking: { type: 'enabled' }, reasoning_effort: 'high' }],
    ['glm-4.7', 'openai', 'off', { thinking: { type: 'disabled' } }],
    ['kimi-k2.6', 'openai', 'off', { thinking: { type: 'disabled' } }],
  ]) {
    await ui.getByLabel('接口协议', { exact: true }).selectOption(protocol);
    await ui.getByLabel('模型名称', { exact: true }).nth(0).fill(model);
    await ui.getByLabel('思考强度', { exact: true }).selectOption(effort);
    const previousRequests = requests.length;
    await ui.getByRole('button', { name: '保存并测试连接', exact: true }).nth(0).click();
    await pollState(state => state.settings.generator.model === model && requests.length > previousRequests);
    await ui.getByText('连接及响应格式验证成功（仅发送虚构样例）', { exact: true }).waitFor();
    const body = requests.at(-1).body;
    assert.equal(body.model, model);
    for (const key of ['reasoning_effort', 'thinking', 'output_config']) assert.deepEqual(body[key], expected[key]);
  }
  await ui.screenshot({ path: resolve(output, 'settings-thinking.png'), fullPage: true });
  for (const [backend, protocol, model, path] of [
    ['openai-decisions', 'openai', 'gpt-6-luna', '/v1/decisions'],
    ['llm', 'openai', 'gpt-6-luna', '/v1/chat/completions'],
    ['llm', 'anthropic', 'claude-sonnet-4-6', '/v1/messages'],
  ]) {
    await ui.getByLabel('分类后端', { exact: true }).selectOption(backend);
    await ui.getByLabel('Base URL', { exact: true }).nth(1).fill(backend === 'llm' ? `${base}/v1` : `${base}${path}`);
    await ui.getByLabel('模型名称', { exact: true }).nth(1).fill(model);
    if (backend === 'llm') {
      await ui.getByLabel('分类接口协议', { exact: true }).selectOption(protocol);
      assert.equal(await ui.getByLabel('分类思考强度', { exact: true }).inputValue(), 'off');
    } else assert.equal(await ui.getByLabel('分类思考强度', { exact: true }).count(), 0);
    const previousRequests = requests.length;
    await ui.getByRole('button', { name: '保存并测试连接', exact: true }).nth(1).click();
    await pollState(state => state.settings.classifier.backend === backend && requests.length > previousRequests);
    await ui.getByText('连接及响应格式验证成功（仅发送虚构样例）', { exact: true }).waitFor();
    assert.equal(requests.at(-1).url, path);
    const body = requests.at(-1).body;
    if (backend === 'openai-decisions') { assert.equal(body.questions[0].type, 'choice'); assert.equal(body.reasoning_effort, undefined); }
    else if (protocol === 'openai') assert.equal(body.reasoning_effort, 'none');
    else assert.deepEqual(body.thinking, { type: 'disabled' });
    const added = await ui.evaluate(async ({ base, windowId, suffix }) => (await chrome.tabs.create({ windowId, url: `${base}/page/chrome-${suffix}`, active: false })).id, { base, windowId: renamed.windowId, suffix: `${backend}-${protocol}` });
    await pollState(state => state.tabs.some(tab => tab.id === added && tab.title === 'Chrome extension guide'));
    oldId = await taskId();
    const result = await ui.evaluate(async windowId => chrome.runtime.sendMessage({ type: 'start', kind: 'update', windowId }), renamed.windowId);
    assert(result.ok, result.error); await waitComplete(oldId);
    state = await readState();
    assert.equal(state.tabs.find(tab => tab.id === added).groupId, renamed.id);
    assert.equal(state.nativeGroups.length, beforeRestart.nativeGroups.length);
    const item = state.task.items.find(item => item.tab.id === added);
    assert.equal(item.status, 'applied');
    assert(item.message.includes(backend === 'llm' ? '模型自评分' : '匹配概率'));
    assert.equal(item.scoreSource, backend === 'llm' ? 'llm_estimate' : 'decision_probability');
    assert.equal(item.candidates[0].name, '插件开发');
    assert(state.task.items.some(item => item.status === 'unmatched'));
  }
  await ui.screenshot({ path: resolve(output, 'settings-classifiers.png'), fullPage: true });
  assert.equal((await readState()).settings.classifier.backend, 'llm');
  console.log(JSON.stringify({ result: 'PASS', browser: context.browser()?.version(), modelRequests: requests.filter(item => item.url.startsWith('/v1/')).length, checks: ['React settings', 'mock generation', 'adopt draft', 'metadata injection', 'Jev classification', 'real Chrome groups', 'pinned/grouped exclusions', 'undo', 'Readability injection', 'content limit', 'per-window groups', 'manual rename/delete/replacement', 'full browser restart and session restore', 'restored alias binding', 'no duplicate after restart', 'thinking default off and persistence', 'five provider thinking controls via UI with mock endpoints', 'Decisions and LLM classifier selection and grouping', 'OpenAI and Anthropic classification with thinking off', 'LLM estimate labels and native group reuse', 'one and two matches stay ungrouped; three create together', 'small scans avoid generation requests', 'name-only categories and explicit AI descriptions', 'full decision URLs without appended paths', 'top three group scores including cached and unmatched results', 'candidate persistence across browser restart'], screenshots: output }, null, 2));
} catch (error) {
  const diagnosticWorker = context?.serviceWorkers()[0];
  if (diagnosticWorker) console.log('Background API diagnostics:', await diagnosticWorker.evaluate(async () => {
    const checks = { windows: () => chrome.windows.getAll({ windowTypes: ['normal'] }), groups: () => chrome.tabGroups.query({}), tabs: () => chrome.tabs.query({ windowType: 'normal' }), sidePanel: () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }) };
    const result = {};
    for (const [name, run] of Object.entries(checks)) {
      try { const value = await run(); result[name] = { ok: true, count: Array.isArray(value) ? value.length : undefined }; }
      catch (error) { result[name] = { error: String(error) }; }
    }
    return result;
  }).catch(() => 'unavailable'));
  if (ui) {
    console.log('UI failure text:', await ui.locator('body').innerText().catch(() => 'unavailable'));
    await ui.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
}
