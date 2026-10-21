// Real extension UI acceptance in a disposable Chromium profile, against local fixtures only.
// Run after npm run build:
// node scripts/ui-acceptance.mjs . <chromium.exe> [round1]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { mockModelReply } from './mock-models.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.argv[2] || process.cwd()] }));
const round = process.argv[4] || 'round1';
const motionOnly = process.argv[5] === 'motion';
const regressionOnly = process.argv[5] === 'regression';
assert.match(round, /^[a-zA-Z0-9_-]+$/, 'Use a simple evidence directory name');
const output = resolve('output/playwright/ui', round);
await mkdir(output, { recursive: true });
const requests = [];
let networkMode = 'normal';
const heldResponses = new Set();
const releaseRequests = () => { for (const release of heldResponses) release(); heldResponses.clear(); };
let heldRequest;
const groups = [{ name: 'Browser research', description: 'Chrome extension development and browser research.', include: [], exclude: [], color: 'blue' }];
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/page/')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const relevant = request.url.includes('chrome');
    const title = request.url.includes('long') ? 'Chrome extension accessibility, interaction patterns and browser implementation reference '.repeat(5) : relevant ? 'Chrome extension guide' : 'Cooking reference';
    response.end(`<html><head><title>${title}</title><meta name="description" content="${relevant ? 'Chrome extension documentation' : 'Pasta cooking notes'}"></head><body><main><h1>${title}</h1><p>Local UI acceptance fixture. No external page content is used.</p></main></body></html>`);
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method === 'OPTIONS') { response.end('{}'); return; }
  if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/messages', '/v1/systemone', '/v1/decisions'].includes(request.url)) {
    response.writeHead(404); response.end('{}'); return;
  }
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw || '{}'); requests.push({ path: request.url, body });
  if (networkMode === 'hold') {
    await new Promise(resolve => {
      const release = () => { heldResponses.delete(release); resolve(); };
      heldResponses.add(release);
      response.once('close', release);
      heldRequest?.();
    });
  }
  if (networkMode === 'slow') await delay(450);
  if (networkMode === 'fail') { response.writeHead(401); response.end(JSON.stringify({ error: { message: 'Local fixture rejected request' } })); return; }
  const reply = mockModelReply(request.url, body, groups);
  if (reply) response.end(JSON.stringify(reply)); else { response.writeHead(404); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { round, startedAt: new Date().toISOString(), environment: 'Disposable Chromium extension with local fixture model only', checks: [], screenshots: [], pageErrors: [], visualDiagnostics: [] };
let context, options, sidebar, rpc, windowId, extensionId;
const poll = async (read, predicate, message, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) { value = await read(); if (predicate(value)) return value; await delay(40); }
  throw new Error(`${message}: ${JSON.stringify(value)}`);
};
const state = () => rpc({ type: 'workspace-state', windowId });
const taskAfter = previousId => poll(state, value => value.task && value.task.id !== previousId, 'New task did not start');
const finished = taskId => {
  assert(taskId, 'Wait for the specific task that this operation started');
  return poll(state, value => value.task?.id === taskId && value.task.status !== 'running' && !value.busy, 'Task did not finish', 30000);
};
const check = async (name, run) => {
  if (regressionOnly && ![
    'Initial window lookup failure can retry and recover in both surfaces',
    'A committed save with persistent view failure preserves input and retries reads only',
    'A delayed successful refresh follows a newer failed refresh after saving',
    'Open confirmation text updates consistently when another page changes language',
  ].includes(name)) return;
  try { await run(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    report.checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
    for (const [label, page] of [['options', options], ['sidebar', sidebar]]) {
      if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, `failure-${report.checks.length}-${label}.png`), fullPage: true }).catch(() => {});
    }
    networkMode = 'normal'; releaseRequests(); heldRequest = undefined;
    if (rpc && options && sidebar) await preference('light', 'zh-CN').catch(() => {});
  }
};
const capture = async (page, name, viewportOnly = false) => {
  await page.evaluate(async () => { await globalThis.document.fonts.ready; });
  const fullPage = !viewportOnly && !(await page.locator('dialog[open]').count()) && !['final-settings', 'settings-keyboard-focus', 'sidebar-layout-200-equivalent'].includes(name);
  // Full-page capture hides scrollbars. Preserve their existing space so the
  // layout does not expand into the cropped scrollbar area during capture.
  const hasScrollbar = await page.evaluate(() => globalThis.innerWidth > globalThis.document.documentElement.clientWidth);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage, animations: 'disabled', style: fullPage && hasScrollbar ? ':root { scrollbar-gutter: stable !important; }' : undefined });
  const size = page.viewportSize();
  report.screenshots.push({ name, ...size, capture: fullPage ? 'full page' : 'viewport', theme: await page.locator('html').getAttribute('data-theme'), locale: await page.locator('html').getAttribute('lang') });
  const diagnostics = await page.evaluate(() => {
    const doc = globalThis.document;
    const overflow = doc.documentElement.scrollWidth > globalThis.innerWidth + 1;
    const controls = [...doc.querySelectorAll('button,input,select,textarea,a[href]')].filter(element => element.getClientRects().length);
    const unnamed = controls.filter(element => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent?.trim() && !element.labels?.length && element.type !== 'hidden').map(element => element.outerHTML.slice(0, 200));
    const smallText = [...doc.querySelectorAll('p,label,button,summary,input,select,textarea')].filter(element => element.getClientRects().length && Number.parseFloat(globalThis.getComputedStyle(element).fontSize) < 12).map(element => ({ text: element.textContent?.trim().slice(0, 70), fontSize: globalThis.getComputedStyle(element).fontSize }));
    const untranslatedControls = doc.documentElement.lang === 'en' ? [...doc.querySelectorAll('button,summary,legend,h1,h2,h3,.alert')].filter(element => element.getClientRects().length && !element.closest('.native-group,.group-members,.member-picker-list') && /[\u4e00-\u9fff]/.test(element.textContent || '')).map(element => element.textContent?.trim().slice(0, 160)) : [];
    return { overflow, documentWidth: doc.documentElement.scrollWidth, viewportWidth: globalThis.innerWidth, unnamed, smallText, untranslatedControls };
  });
  report.visualDiagnostics.push({ name, ...diagnostics });
  assert.equal(diagnostics.overflow, false, `${name}: horizontal page overflow`);
  assert.deepEqual(diagnostics.unnamed, [], `${name}: unnamed visible form controls`);
  assert.deepEqual(diagnostics.untranslatedControls, [], `${name}: untranslated interface controls`);
};
const preference = async (theme, locale) => {
  await rpc({ type: 'save-ui-preferences', patch: { theme, locale } });
  for (const page of [options, sidebar]) {
    await poll(() => page.locator('html').getAttribute('lang'), value => value === locale, 'Locale did not synchronize');
    if (theme !== 'system') await poll(() => page.locator('html').getAttribute('data-theme'), value => value === theme, 'Theme did not synchronize');
  }
};
// Keep logical module coverage while exercising the three primary tabs.
const section = async (index, locale = 'zh-CN') => {
  const tab = index === 0 ? ['服务', 'Services'] : index === 3 ? ['高级', 'Advanced'] : ['常规', 'General'];
  await options.getByRole('tab', { name: tab[locale === 'en' ? 1 : 0], exact: true }).click();
  await options.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  if (index === 4) {
    const activity = options.locator('#activity');
    if (!await activity.evaluate(el => el.open)) await activity.locator(':scope > summary').click();
  }
};
const closeDialog = async page => {
  if (await page.getByRole('dialog').count()) {
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
};
const dialogKeyboard = async (page, opener) => {
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert(await dialog.evaluate(element => element.contains(globalThis.document.activeElement)), 'Opening a dialog must put keyboard focus inside it');
  await page.keyboard.press('Shift+Tab');
  assert(await dialog.evaluate(element => element.contains(globalThis.document.activeElement)), 'Reverse tab must remain inside modal');
  await page.keyboard.press('Tab');
  assert(await dialog.evaluate(element => element.contains(globalThis.document.activeElement)), 'Tab must remain inside modal');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert(await opener.evaluate(element => element === globalThis.document.activeElement), 'Closing a dialog must return focus to its opener');
};
// Faults are injected only into one disposable extension document. The background and its
// storage stay real, so successful writes can be verified independently through `options`.
const faultPage = async (path, initialFault) => {
  const page = await context.newPage();
  page.setDefaultTimeout(7000); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.setViewportSize({ width: path === 'options.html' ? 1280 : 400, height: 900 });
  await page.addInitScript(initialFault => {
    if (!globalThis.chrome?.runtime?.sendMessage || !globalThis.chrome?.windows?.getCurrent) return;
    const fault = { windowFailures: 0, blockWindow: false, windowCalls: 0, saveRequests: 0, savedResponses: 0, blockedReads: 0, blockStateOnSave: false, blockWorkspace: false, deferReadAfterSave: false, deferNextRead: false, deferredReadReady: false, deferredReplyOk: false, suppressStorageEvents: false, ...initialFault };
    globalThis.__uiAcceptanceFault = fault;
    // Keep the save's incidental storage event from racing ahead of the explicit save refresh.
    // The marker below still traverses the real storage event and App listener.
    const addStorageListener = chrome.storage.onChanged.addListener.bind(chrome.storage.onChanged);
    const removeStorageListener = chrome.storage.onChanged.removeListener.bind(chrome.storage.onChanged);
    const storageListeners = new WeakMap();
    chrome.storage.onChanged.addListener = listener => {
      const wrapped = (...args) => {
        if (fault.suppressStorageEvents && !Object.prototype.hasOwnProperty.call(args[0], 'ui.acceptance.refresh-event')) return;
        listener(...args);
      };
      storageListeners.set(listener, wrapped); addStorageListener(wrapped);
    };
    chrome.storage.onChanged.removeListener = listener => removeStorageListener(storageListeners.get(listener) || listener);
    const getCurrent = chrome.windows.getCurrent.bind(chrome.windows);
    chrome.windows.getCurrent = (...args) => {
      fault.windowCalls++;
      if (fault.windowFailures > 0 || fault.blockWindow) { fault.windowFailures = Math.max(0, fault.windowFailures - 1); return Promise.reject(new Error('UI acceptance: initial window unavailable')); }
      return getCurrent(...args);
    };
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => {
      const command = args[0];
      if (command?.type === 'workspace-state' && fault.deferNextRead) {
        fault.deferNextRead = false;
        const result = await send(...args);
        fault.deferredReplyOk = !!result?.ok;
        fault.blockWorkspace = true;
        fault.deferredReadReady = true;
        return new Promise(resolve => { globalThis.__uiAcceptanceReleaseRead = () => resolve(result); });
      }
      if (command?.type === 'workspace-state' && fault.blockWorkspace) {
        fault.blockedReads++; return { ok: false, error: 'UI acceptance: view refresh unavailable' };
      }
      if (command?.type === 'save-config') {
        fault.saveRequests++;
        if (fault.blockStateOnSave) fault.blockWorkspace = true;
        const result = await send(...args);
        if (result?.ok) {
          fault.savedResponses++;
          if (fault.deferReadAfterSave) fault.deferNextRead = true;
        }
        return result;
      }
      return send(...args);
    };
  }, initialFault);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
};

try {
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(resolve('.browser-test', `ui-${round}-${Date.now()}`), {
    executablePath: process.argv[3] || undefined, headless: false,
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--no-first-run'],
    viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    ...(motionOnly ? { reducedMotion: 'no-preference', recordVideo: { dir: resolve(output, 'video-source'), size: { width: 1280, height: 900 } } } : {}),
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  options = await context.newPage(); sidebar = await context.newPage();
  for (const page of [options, sidebar]) { page.setDefaultTimeout(7000); page.on('pageerror', error => report.pageErrors.push(error.message)); }
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidebar.setViewportSize({ width: 400, height: 900 });
  rpc = async command => {
    const result = await options.evaluate(command => chrome.runtime.sendMessage(command), command);
    if (!result?.ok) throw new Error(result?.error || 'No background response');
    return result.data;
  };
  windowId = await options.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await state();
  await preference('light', 'zh-CN');
  await section(0);
  if (motionOnly) {
    await check('Normal-motion configuration, organizing feedback and modal transitions', async () => {
      const frame = async (page, name) => {
        await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'allow' });
        report.screenshots.push({ name, ...page.viewportSize(), theme: await page.locator('html').getAttribute('data-theme'), locale: await page.locator('html').getAttribute('lang') });
        await delay(650);
      };
      await options.getByLabel('Base URL', { exact: true }).fill(`${base}/v1`);
      await options.getByLabel('模型名称', { exact: true }).fill('mock-chat');
      await options.getByRole('button', { name: '保存配置', exact: true }).click();
      await options.getByText('已保存', { exact: true }).waitFor();
      await frame(options, 'motion-config-initial');
      for (let index = 1; index < 5; index++) {
        await section(index); await frame(options, `motion-config-section-${index + 1}`);
      }
      await section(2); await options.getByLabel('界面主题', { exact: true }).selectOption('dark');
      await poll(() => options.locator('html').getAttribute('data-theme'), value => value === 'dark', 'Dark appearance did not save');
      await frame(options, 'motion-config-dark');
      await options.getByLabel('界面语言', { exact: true }).selectOption('en');
      await poll(() => options.locator('html').getAttribute('lang'), value => value === 'en', 'English did not save');
      await frame(options, 'motion-config-english');
      await options.getByRole('tab', { name: 'Advanced', exact: true }).click();
      await frame(options, 'motion-config-advanced');
      await preference('light', 'zh-CN');
      for (const name of ['chrome-motion-one', 'chrome-motion-two', 'chrome-motion-three', 'cooking-motion']) await options.evaluate(async url => { await chrome.tabs.create({ url, active: false }); }, `${base}/page/${name}`);
      await poll(state, value => value.tabs.filter(tab => tab.eligible).length === 4, 'Motion fixtures did not load');
      await sidebar.bringToFront();
      const motionTab = (await state()).tabs.find(tab => tab.url.endsWith('/page/chrome-motion-one'));
      await options.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, motionTab.id);
      await poll(() => sidebar.locator('.current-title').textContent(), value => value.includes(motionTab.title), 'Motion fixture title did not refresh');
      networkMode = 'slow';
      const previousTaskId = (await state()).task?.id;
      await sidebar.getByRole('button', { name: '更新分组', exact: true }).click();
      const started = await taskAfter(previousTaskId);
      await sidebar.getByRole('button', { name: '取消任务', exact: true }).waitFor();
      await frame(sidebar, 'motion-sidebar-working');
      await finished(started.task.id); networkMode = 'normal';
      await section(4);
      await poll(() => options.locator('.task-state strong').textContent(), value => value === '已完成', 'Completed task did not reach the visible UI');
      await frame(sidebar, 'motion-sidebar-complete');
      assert.equal(await sidebar.locator('.recent-section,.task-details').count(), 0, 'Results must no longer occupy the sidebar');
      await options.locator('.task-details > summary').click(); await frame(options, 'motion-activity-details');
      await options.locator('.task-details > summary').click();
      await sidebar.getByRole('button', { name: '手动建组', exact: true }).click(); await frame(sidebar, 'motion-modal-entry');
      await sidebar.getByLabel('名称', { exact: true }).fill('Cooking notes');
      await sidebar.keyboard.press('Escape'); await frame(sidebar, 'motion-modal-discard-confirm');
      await sidebar.getByRole('button', { name: '放弃编辑', exact: true }).click(); await frame(sidebar, 'motion-modal-closed');
      await options.bringToFront(); await section(0); await frame(options, 'motion-config-final');
    });
  } else {
  await check('Unconfigured and empty-window states', async () => {
    await capture(sidebar, 'sidebar-unconfigured-empty');
    assert.equal(await sidebar.getByRole('button', { name: '更新分组', exact: true }).isDisabled(), true);
    assert.equal(requests.length, 0);
    await capture(options, 'options-unconfigured');
  });

  await check('Three primary tabs support keyboard navigation and distinct setting roles', async () => {
    await options.getByRole('tab', { name: '常规', exact: true }).click();
    assert.equal(await options.getByRole('tab').count(), 3);
    await options.getByRole('tab', { name: '常规', exact: true }).focus();
    for (const [key, name] of [['ArrowRight','服务'],['End','高级'],['Home','常规']]) {
      await options.keyboard.press(key);
      assert.equal(await options.getByRole('tab', { name, exact:true }).getAttribute('aria-selected'), 'true');
      assert.equal(await options.getByRole('tab', { name, exact:true }).evaluate(el=>el===globalThis.document.activeElement), true);
    }
    assert.equal(await options.getByLabel('界面主题', {exact:true}).count(), 1);
    assert.equal(await options.locator('#activity').evaluate(el=>el.open), false);
    await capture(options, 'settings-general-initial');
    assert.equal(await sidebar.locator('.sidebar-footer').count(), 0, 'Data explanation belongs in settings, not the sidebar');
    await options.getByRole('tab', { name: '高级', exact: true }).click();
    assert.equal(await options.locator('.config-data-disclosure').evaluate(el => el.open), false);
    await options.locator('.config-data-disclosure > summary').click();
    assert.match(await options.locator('.config-data-disclosure').innerText(), /模型服务/);
    await options.locator('.config-data-disclosure > summary').click();
    await section(0);
  });
  await check('Shared disclosures open with Enter, close with Space and retain visible focus', async () => {
    await section(2);
    for (const selector of ['.config-help details:first-of-type', '#activity']) {
      const disclosure = options.locator(selector), summary = disclosure.locator(':scope > summary');
      await summary.focus(); await options.keyboard.press('Enter');
      assert.equal(await disclosure.evaluate(el => el.open), true);
      assert.equal(await summary.evaluate(el => el === globalThis.document.activeElement), true);
      await capture(options, selector === '#activity' ? 'disclosure-activity-open' : 'disclosure-help-open', true);
      await options.keyboard.press('Space');
      assert.equal(await disclosure.evaluate(el => el.open), false);
    }
    await section(3);
    for (const disclosure of await options.locator('#data > details').all()) {
      const summary = disclosure.locator(':scope > summary');
      await summary.focus(); await options.keyboard.press('Enter'); assert.equal(await disclosure.evaluate(el => el.open), true);
      await options.keyboard.press('Space'); assert.equal(await disclosure.evaluate(el => el.open), false);
    }
    await section(0);
  });
  await check('Draft test does not save; edits invalidate success; draft survives navigation', async () => {
    await options.getByLabel('Base URL', { exact: true }).fill(`${base}/v1`);
    await options.getByLabel('模型名称', { exact: true }).fill('mock-chat');
    await options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).click();
    await options.getByText('连接成功 · 当前草稿', { exact: true }).waitFor();
    assert.equal((await state()).settings.generator.model, '');
    await capture(options, 'options-model-tested-unsaved');
    await options.getByLabel('模型名称', { exact: true }).fill('mock-chat-edited');
    assert.equal(await options.getByText('连接成功 · 当前草稿', { exact: true }).count(), 0);
    await section(1); await section(0);
    assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-chat-edited');
    await options.getByLabel('模型名称', { exact: true }).fill('mock-chat');
    await options.getByRole('button', { name: '保存配置', exact: true }).click();
    await poll(state, value => value.settings.generator.model === 'mock-chat', 'Settings did not save');
    await options.getByText('已保存', { exact: true }).waitFor();
  });
  // These are real tabs in the disposable profile, not mocked extension state.
  for (const name of ['chrome-one', 'chrome-two', 'chrome-long', 'cooking']) {
    await options.evaluate(async url => { await chrome.tabs.create({ url, active: false }); }, `${base}/page/${name}`);
  }
  await poll(state, value => value.tabs.filter(tab => tab.eligible).length === 4, 'Fixture tabs did not become eligible');
  await check('Real initialization and grouped results; no organizing workbench in settings', async () => {
    const previousTaskId = (await state()).task?.id;
    await sidebar.getByRole('button', { name: '更新分组', exact: true }).click();
    const started = await taskAfter(previousTaskId);
    const result = await finished(started.task.id);
    assert.equal(result.task.status, 'completed', result.task.message);
    assert.equal(result.groups.length, 1);
    assert.equal(result.task.items.filter(item => item.status === 'applied').length, 3);
    await poll(() => sidebar.locator('.native-group').count(), value => value === 1, 'Sidebar did not refresh groups');
    assert.equal(await options.getByRole('button', { name: '更新分组', exact: true }).count(), 0);
    await capture(sidebar, 'sidebar-result');
    await section(4);
    assert.equal(await sidebar.locator('.recent-section,.task-details').count(), 0, 'Results must no longer occupy the sidebar');
    await options.locator('.task-details > summary').click();
    await options.locator('.result-details > summary').first().click();
    await capture(options, 'settings-activity-expanded-long-title');
  });
  await check('All settings modules across three tabs: light/dark, Chinese/English, 320/1280 widths', async () => {
    for (const locale of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
      await preference(theme, locale);
      for (const width of [1280, 320]) {
        await options.setViewportSize({ width, height: 900 });
        for (let index = 0; index < 5; index++) {
          await section(index, locale);
          await capture(options, `settings-${index + 1}-${locale}-${theme}-${width}`);
          if (index === 3) {
            await options.locator('#data').scrollIntoViewIfNeeded();
            await capture(options, `data-${locale}-${theme}-${width}`, true);
            await options.locator('.config-data-disclosure > summary').click();
            await capture(options, `data-expanded-${locale}-${theme}-${width}`, true);
            await options.locator('.config-data-disclosure > summary').click();
          }
        }
      }
      for (const width of [320, 400]) {
        await sidebar.setViewportSize({ width, height: 900 });
        await capture(sidebar, `sidebar-${locale}-${theme}-${width}`);
      }
    }
  });
  await preference('light', 'zh-CN');
  await options.setViewportSize({ width: 1280, height: 900 });
  await sidebar.setViewportSize({ width: 320, height: 900 });
  await check('Current-page grouped, ungrouped, pinned and unsupported states', async () => {
    const snapshot = await state();
    const grouped = snapshot.tabs.find(tab => tab.url.endsWith('/page/chrome-one'));
    const ungrouped = snapshot.tabs.find(tab => tab.url.endsWith('/page/cooking'));
    try {
      for (const [name, tab, pinned, expectedStatus] of [['grouped', grouped, false, '已分组'], ['ungrouped', ungrouped, false, '未分组'], ['pinned', ungrouped, true, '已固定']]) {
        await options.evaluate(async ({ id, pinned }) => { await chrome.tabs.update(id, { active: true, pinned }); }, { id: tab.id, pinned });
        await poll(state, value => {
          const current = value.tabs.find(item => item.id === tab.id);
          return current?.active && current.pinned === pinned && current.eligible === (name === 'ungrouped') && current.groupId === (name === 'grouped' ? tab.groupId : -1);
        }, `Current-page ${name} browser state did not settle`);
        await poll(() => sidebar.locator('.current-title').textContent(), value => value.includes(tab.title), 'Current-page title did not refresh');
        // Pinning keeps the title unchanged. Wait for the rendered state, not just that title,
        // so the event debounce cannot make an old ungrouped view pass the readiness check.
        await poll(() => sidebar.locator('.current-page .page-state').textContent(), value => value.trim() === expectedStatus, `Current-page ${name} status did not refresh`);
        await poll(() => sidebar.getByRole('button', { name: '整理当前页', exact: true }).isDisabled(), value => value === (name !== 'ungrouped'), `Current-page ${name} action availability did not refresh`);
        await capture(sidebar, `sidebar-current-${name}`);
      }
    } finally { await options.evaluate(async id => { await chrome.tabs.update(id, { pinned: false }); }, ungrouped.id); }
    const sideTabId = await sidebar.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    await options.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, sideTabId);
    await poll(state, value => value.tabs.some(tab => tab.id === sideTabId && tab.active && !tab.eligible && !tab.pinned), 'Unsupported page browser state did not settle');
    await poll(() => sidebar.locator('.current-page .page-state').textContent(), value => value.trim() === '不可整理', 'Unsupported page status did not refresh');
    await poll(() => sidebar.getByRole('button', { name: '整理当前页', exact: true }).isDisabled(), value => value, 'Unsupported page action must be disabled');
    await capture(sidebar, 'sidebar-current-unsupported');
  });
  await check('Theme/language controls synchronize both pages, persist on reload, follow OS', async () => {
    await section(2);
    await options.getByLabel('界面主题', { exact: true }).selectOption('dark');
    await poll(() => sidebar.locator('html').getAttribute('data-theme'), value => value === 'dark', 'Sidebar theme not synchronized');
    await options.getByLabel('界面语言', { exact: true }).selectOption('en');
    await poll(() => sidebar.locator('html').getAttribute('lang'), value => value === 'en', 'Sidebar locale not synchronized');
    await options.reload(); await sidebar.reload();
    await poll(() => options.locator('html').getAttribute('data-theme'), value => value === 'dark', 'Theme not persisted');
    await poll(() => sidebar.locator('html').getAttribute('lang'), value => value === 'en', 'Locale not persisted');
    await options.getByLabel('Interface theme', { exact: true }).selectOption('system');
    await poll(() => options.getByLabel('Interface theme', { exact: true }).inputValue(), value => value === 'system', 'System preference did not save');
    for (const mode of ['light', 'dark']) {
      await options.emulateMedia({ colorScheme: mode }); await sidebar.emulateMedia({ colorScheme: mode });
      for (const page of [options, sidebar]) await poll(() => page.locator('html').getAttribute('data-theme'), value => value === mode, 'System preference not followed');
    }
    await capture(options, 'settings-system-dark-english');
    await options.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
    await options.getByLabel('界面主题', { exact: true }).selectOption('light');
  });
  await preference('light', 'zh-CN');
  await check('Independent backend and advanced controls remain usable', async () => {
    await section(0);
    await options.getByLabel('复用标准 Chat 服务', { exact: false }).uncheck();
    for (const backend of ['jev', 'openai-decisions', 'llm']) {
      await options.getByLabel('分类后端', { exact: true }).selectOption(backend);
      if (backend === 'llm') {
        await options.getByLabel('接口协议', { exact: true }).selectOption('anthropic');
        await options.getByLabel('Base URL', { exact: true }).nth(1).fill(`${base}/v1`);
        await options.getByLabel('模型名称', { exact: true }).nth(1).fill('mock-anthropic');
      } else {
        await options.getByLabel('完整接口 URL', { exact: true }).fill(`${base}/v1/${backend === 'jev' ? 'systemone' : 'decisions'}`);
        await options.getByLabel('分类模型名称', { exact: true }).fill(`mock-${backend}`);
      }
      await options.getByRole('button', { name: '测试归组连接（不保存）', exact: true }).click();
      await options.getByText('连接成功 · 当前草稿', { exact: true }).waitFor();
      await capture(options, `settings-independent-${backend}`);
    }
    await options.getByLabel('复用标准 Chat 服务', { exact: false }).check();
    await options.getByRole('button', { name: '保存配置', exact: true }).click();
    await options.getByText('已保存', { exact: true }).waitFor();
    await section(0);
    await options.getByRole('tab', { name: '高级', exact: true }).click();
    await options.getByLabel('最低归组分数', { exact: true }).fill('0.85');
    await capture(options, 'settings-reading-advanced');
    await options.setViewportSize({ width: 320, height: 900 });
    await preference('dark', 'en'); await capture(options, 'settings-reading-advanced-en-dark-320');
    await preference('light', 'zh-CN'); await options.setViewportSize({ width: 1280, height: 900 });
    await options.getByRole('button', { name: '保存配置', exact: true }).click();
    await options.getByText('已保存', { exact: true }).waitFor();
  });
  await check('Concurrent configuration change preserves draft and exposes conflict', async () => {
    await section(0);
    await options.getByLabel('模型名称', { exact: true }).fill('unsaved-local-model');
    const original = await state();
    await rpc({ type: 'save-config', settings: original.settings, revision: original.revision });
    await options.getByText('配置或分组说明已在其他位置更新。输入已保留，请重载已保存配置后再编辑。', { exact: true }).waitFor();
    assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), 'unsaved-local-model');
    assert.equal(await options.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true);
    await capture(options, 'settings-concurrent-change-preserved');
    await options.getByRole('button', { name: '重载已保存配置', exact: true }).click();
    await capture(options, 'settings-reload-confirmation');
    await options.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), 'unsaved-local-model');
    await options.getByRole('button', { name: '重载已保存配置', exact: true }).click();
    await options.getByRole('button', { name: '放弃并重载', exact: true }).click();
    assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), original.settings.generator.model);
  });
  await check('Manual/edit/move dialogs: narrow widths, both themes/locales, focus and escape', async () => {
    for (const locale of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
      await preference(theme, locale);
      const names = locale === 'en' ? ['New group', 'Edit group', 'Move manually'] : ['手动建组', '编辑分组', '手动改分'];
      const manual = sidebar.getByRole('button', { name: names[0], exact: true });
      await manual.click(); await capture(sidebar, `dialog-new-${locale}-${theme}`); await dialogKeyboard(sidebar, manual);
      const native = sidebar.locator('.native-group').first();
      if (!await native.evaluate(element => element.open)) await native.locator(':scope > summary').click();
      const edit = native.getByRole('button', { name: names[1], exact: true });
      await edit.click(); await capture(sidebar, `dialog-edit-${locale}-${theme}`); await dialogKeyboard(sidebar, edit);
      await section(4, locale);
      const details = options.locator('.task-details');
      if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
      const move = options.getByRole('button', { name: names[2], exact: true }).last();
      await move.click(); await capture(options, `dialog-move-${locale}-${theme}`); await dialogKeyboard(options, move);
    }
  });
  await preference('light', 'zh-CN');
  await closeDialog(sidebar);
  await check('Dirty group edit confirmation preserves input on cancel, discards only explicitly', async () => {
    await sidebar.getByRole('button', { name: '手动建组', exact: true }).click();
    await sidebar.getByLabel('名称', { exact: true }).fill('Unsaved group');
    await sidebar.keyboard.press('Escape');
    const confirm = sidebar.getByRole('dialog', { name: '放弃未保存的编辑？', exact: true });
    await confirm.waitFor(); await capture(sidebar, 'dialog-dirty-discard-confirm');
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await sidebar.getByLabel('名称', { exact: true }).inputValue(), 'Unsaved group');
    await sidebar.keyboard.press('Escape');
    await sidebar.getByRole('button', { name: '放弃编辑', exact: true }).click();
    await sidebar.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.notEqual(await sidebar.evaluate(() => globalThis.document.body.style.overflow), 'hidden', 'Closing nested dialogs must restore body scrolling');
    const canScroll = await sidebar.evaluate(() => {
      globalThis.scrollTo(0, 0);
      return globalThis.document.documentElement.scrollHeight > globalThis.innerHeight;
    });
    if (canScroll) {
      await sidebar.keyboard.press('PageDown');
      await poll(() => sidebar.evaluate(() => globalThis.scrollY), value => value > 0, 'PageDown must scroll after closing nested dialogs');
    }
  });
  await check('Manual single-page group saves through real form and remains undoable', async () => {
    const before = requests.length;
    await sidebar.getByRole('button', { name: '手动建组', exact: true }).click();
    await sidebar.getByLabel('名称', { exact: true }).fill('Cooking notes');
    await sidebar.getByLabel('分组说明', { exact: true }).fill('Recipes and cooking techniques.');
    await sidebar.getByRole('dialog').getByRole('checkbox').first().check();
    await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
    await sidebar.getByRole('dialog').waitFor({ state: 'hidden' });
    const snapshot = await state();
    assert(snapshot.groups.some(group => group.name === 'Cooking notes' && group.members.length === 1));
    assert.equal(requests.length, before, 'Manual grouping must not call a model');
    await capture(sidebar, 'sidebar-manual-single-group');
    await section(4);
    await options.getByRole('button', { name: /撤销最近变更/ }).click();
    await poll(state, value => !value.groups.some(group => group.name === 'Cooking notes'), 'Undo did not remove manual group');
  });
  await check('Group edit conflicts preserve form input and never silently overwrite', async () => {
    const group = (await state()).groups[0];
    const native = sidebar.locator('.native-group').first();
    if (!await native.evaluate(element => element.open)) await native.locator(':scope > summary').click();
    await native.getByRole('button', { name: '编辑分组', exact: true }).click();
    await sidebar.getByLabel('名称', { exact: true }).fill('Unsaved local group title');
    await options.evaluate(async id => { await chrome.tabGroups.update(id, { title: 'Browser research — external edit with a long descriptive title to verify wrapping' }); }, group.nativeId);
    await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
    await sidebar.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await sidebar.getByLabel('名称', { exact: true }).inputValue(), 'Unsaved local group title');
    await capture(sidebar, 'dialog-group-edit-conflict');
    await sidebar.keyboard.press('Escape'); await sidebar.getByRole('button', { name: '放弃编辑', exact: true }).click();
    await capture(sidebar, 'sidebar-long-group-name');
    await options.evaluate(async ({ id, title }) => { await chrome.tabGroups.update(id, { title }); }, { id: group.nativeId, title: group.name });
  });
  await check('Service error leaves settings intact and presents a retryable state', async () => {
    await section(0); networkMode = 'fail';
    await options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).click();
    await options.getByText('测试失败', { exact: true }).waitFor();
    assert.equal(await options.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-chat');
    await capture(options, 'settings-connection-failure');
    await preference('dark', 'en'); await capture(options, 'settings-connection-failure-en-dark');
    networkMode = 'normal'; await preference('light', 'zh-CN');
  });
  await check('Failed task shows actionable retry and can recover through real UI', async () => {
    const targetUrl = `${base}/page/chrome-failure`;
    const targetId = await options.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, targetUrl);
    await poll(() => options.evaluate(id => chrome.tabs.get(id), targetId), tab => tab.url === targetUrl && tab.status === 'complete', 'Failure fixture navigation did not commit');
    await poll(state, value => value.tabs.some(tab => tab.id === targetId && tab.url === targetUrl && tab.eligible), 'Failure fixture did not become eligible');
    networkMode = 'fail';
    try {
      await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: targetId });
      const started = await state();
      const snapshot = await finished(started.task.id); assert(snapshot.task.items.some(item => item.status === 'failed'));
      await section(4);
      await options.locator('.task-config-recovery').getByRole('button', { name: '打开配置', exact: true }).waitFor();
      await capture(options, 'settings-activity-failed');
      await preference('dark', 'en'); await capture(options, 'settings-activity-failed-en-dark');
      networkMode = 'normal';
      const details = options.locator('.task-details');
      if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
      await options.getByRole('button', { name: 'Retry', exact: true }).first().click();
      const retryStarted = await taskAfter(snapshot.task.id);
      const retried = await finished(retryStarted.task.id); assert.equal(retried.task.items[0].status, 'applied');
      await preference('light', 'zh-CN');
    } finally { networkMode = 'normal'; }
  });
  await check('Running and cancelled tasks preserve UI responsiveness and lock execution config', async () => {
    await section(0);
    const targetUrl = `${base}/page/chrome-running`;
    const newTabId = await options.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, targetUrl);
    await poll(() => options.evaluate(id => chrome.tabs.get(id), newTabId), tab => tab.url === targetUrl && tab.status === 'complete', 'Running fixture navigation did not commit');
    await poll(state, value => value.tabs.some(tab => tab.id === newTabId && tab.url === targetUrl && tab.eligible), 'Running fixture did not become eligible');
    networkMode = 'hold';
    try {
      const requestStarted = new Promise(resolve => { heldRequest = resolve; });
      await rpc({ type: 'organize', action: 'organize-current', windowId, tabId: newTabId });
      const started = await state();
      await Promise.race([requestStarted, delay(10000).then(() => { throw new Error('Model request did not start'); })]);
      await sidebar.getByRole('button', { name: '取消任务', exact: true }).waitFor();
      await poll(() => options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).isDisabled(), value => value, 'Settings did not receive the running task state');
      await capture(sidebar, 'sidebar-task-running');
      await options.getByLabel('模型名称', { exact: true }).fill('draft-while-running');
      assert.equal(await options.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true);
      assert.equal(await options.getByRole('button', { name: '测试 Chat 连接（不保存）', exact: true }).isDisabled(), true);
      await capture(options, 'settings-task-running-draft');
      await sidebar.getByRole('button', { name: '取消任务', exact: true }).click();
      networkMode = 'normal'; releaseRequests(); heldRequest = undefined;
      const snapshot = await finished(started.task.id); assert.equal(snapshot.task.status, 'cancelled');
      await poll(() => options.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), value => !value, 'Settings did not unlock after cancellation');
      await poll(() => sidebar.getByRole('button', { name: '更新分组', exact: true }).isDisabled(), value => !value, 'Sidebar did not unlock after cancellation');
      await capture(sidebar, 'sidebar-task-cancelled');
      await options.getByRole('button', { name: '重载已保存配置', exact: true }).click();
      await options.getByRole('button', { name: '放弃并重载', exact: true }).click();
    } finally { networkMode = 'normal'; releaseRequests(); heldRequest = undefined; }
  });
  networkMode = 'normal'; releaseRequests();
  await closeDialog(options);
  await check('Import preview, cancel and apply; export omits keys and native identities', async () => {
    await section(3);
    const backup = await rpc({ type: 'export-config' });
    assert(!JSON.stringify(backup).includes('credentials'));
    assert(backup.profiles.every(profile => profile.nativeId === undefined && profile.windowId === undefined));
    const originalThreshold = backup.settings.minProbability;
    backup.settings.minProbability = 0.9;
    const upload = () => options.locator('input[type=file]').setInputFiles({ name: 'fixture-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await upload();
    await options.getByRole('dialog', { name: '确认导入', exact: true }).waitFor();
    await capture(options, 'dialog-import-preview');
    await options.setViewportSize({ width: 320, height: 900 });
    await preference('dark', 'en'); await capture(options, 'dialog-import-preview-en-dark-320');
    await options.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await state()).settings.minProbability, originalThreshold);
    await preference('light', 'zh-CN'); await options.setViewportSize({ width: 1280, height: 900 });
    await upload(); await options.getByRole('button', { name: '确认应用导入', exact: true }).click();
    await poll(state, value => value.settings.minProbability === 0.9, 'Import not applied');
    assert.equal((await state()).groups.length, 1, 'Import may not create real groups');
    const downloadEvent = options.waitForEvent('download');
    await options.getByRole('button', { name: '导出配置与说明', exact: true }).click();
    const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'autotabgroups-config.json');
  });
  await check('Maintenance confirmation cancel preserves results; clear keeps undo', async () => {
    await section(4); const previous = await state();
    const opener = options.getByRole('button', { name: '清除最近任务详情', exact: true });
    await opener.click(); await capture(options, 'dialog-clear-details'); await dialogKeyboard(options, opener);
    assert.equal((await state()).task?.id, previous.task?.id);
    await opener.click(); await options.getByRole('button', { name: '清除详情', exact: true }).click();
    await poll(state, value => value.task === null, 'Task details were not cleared');
    assert.equal((await state()).journal?.id, previous.journal?.id);
    await section(3);
    await options.getByRole('button', { name: '清除分类缓存', exact: true }).click();
    await options.getByText('分类缓存已清除', { exact: true }).waitFor();
    await capture(options, 'settings-maintenance-complete');
  });
  await check('Initial window lookup failure can retry and recover in both surfaces', async () => {
    await preference('light', 'zh-CN');
    for (const path of ['options.html', 'sidepanel.html']) {
      const page = await faultPage(path, { windowFailures: 1, blockWindow: true });
      try {
        await page.getByText('UI acceptance: initial window unavailable', { exact: true }).waitFor();
        const previousCalls = await page.evaluate(() => globalThis.__uiAcceptanceFault.windowCalls);
        assert(previousCalls >= 1);
        await capture(page, `initial-window-error-${path.replace('.html', '')}`);
        // Release the injected fault at the explicit click, not earlier: incidental tab events
        // must not recover the page and make the Retry assertion pass without testing Retry.
        await page.getByRole('button', { name: '重试', exact: true }).evaluate(button => {
          button.addEventListener('click', () => { globalThis.__uiAcceptanceFault.blockWindow = false; }, { capture: true, once: true });
        });
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.getByRole('heading', { name: path === 'options.html' ? '常规' : '本窗口整理', exact: true }).waitFor();
        assert(await page.evaluate(previous => globalThis.__uiAcceptanceFault.windowCalls > previous, previousCalls), 'Retry must obtain the window again');
        await capture(page, `initial-window-recovered-${path.replace('.html', '')}`);
      } finally { await page.close(); }
    }
  });
  await check('A committed save with persistent view failure preserves input and retries reads only', async () => {
    await preference('light', 'zh-CN');
    const original = await state();
    assert.equal(original.hasGeneratorKey, false, 'This isolated fixture starts without a stored key');
    const page = await faultPage('options.html', { blockStateOnSave: true });
    try {
      await page.getByRole('tab', { name: '服务', exact: true }).click();
      await page.getByLabel('模型名称', { exact: true }).fill('mock-refresh-committed');
      await page.getByLabel('Chat 服务 API Key', { exact: true }).fill('ui-acceptance-fixture-key');
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      const warning = '配置已保存，但界面刷新失败，输入已保留。请重试刷新。';
      await page.getByText(warning, { exact: true }).waitFor();
      await poll(state, value => value.settings.generator.model === 'mock-refresh-committed' && value.hasGeneratorKey, 'The background must really commit the settings and fixture key');
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-refresh-committed');
      assert.equal(await page.getByLabel('Chat 服务 API Key', { exact: true }).inputValue(), 'ui-acceptance-fixture-key');
      assert.equal(await page.getByRole('button', { name: '保存配置', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '重载已保存配置', exact: true }).isDisabled(), true);
      assert.equal(await page.getByText('已保存', { exact: true }).count(), 0, 'Do not show a plain Saved state while refresh is unresolved');
      await capture(page, 'settings-committed-refresh-failed');
      await page.getByRole('button', { name: '重试刷新', exact: true }).click();
      await page.getByText(warning, { exact: true }).waitFor();
      await poll(() => page.getByRole('button', { name: '重试刷新', exact: true }).isEnabled(), value => value, 'The failed refresh retry did not settle');
      assert.equal(await page.getByLabel('Chat 服务 API Key', { exact: true }).inputValue(), 'ui-acceptance-fixture-key');
      const failed = await page.evaluate(() => globalThis.__uiAcceptanceFault);
      assert.equal(failed.saveRequests, 1); assert.equal(failed.savedResponses, 1); assert(failed.blockedReads >= 2);
      await page.evaluate(() => { globalThis.__uiAcceptanceFault.blockWorkspace = false; globalThis.__uiAcceptanceFault.blockStateOnSave = false; });
      await page.getByRole('button', { name: '重试刷新', exact: true }).click();
      await page.getByText('已保存', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-refresh-committed');
      assert.equal(await page.getByLabel('Chat 服务 API Key', { exact: true }).inputValue(), '');
      assert.equal(await page.evaluate(() => globalThis.__uiAcceptanceFault.saveRequests), 1, 'Read recovery must not repeat save-config');
      await capture(page, 'settings-committed-refresh-recovered');
    } finally {
      await page.close();
      const latest = await state();
      await rpc({ type: 'save-config', settings: original.settings, revision: latest.revision, generatorKey: '' });
    }
  });
  await check('A delayed successful refresh follows a newer failed refresh after saving', async () => {
    await preference('light', 'zh-CN');
    const original = await state();
    assert.equal(original.hasGeneratorKey, false, 'The interleaving fixture starts without a key');
    const page = await faultPage('options.html', { deferReadAfterSave: true, suppressStorageEvents: true });
    try {
      await page.getByRole('tab', { name: '服务', exact: true }).click();
      await page.getByLabel('模型名称', { exact: true }).fill('mock-interleaved-committed');
      await page.getByLabel('Chat 服务 API Key', { exact: true }).fill('ui-interleaved-fixture-key');
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await poll(() => page.evaluate(() => globalThis.__uiAcceptanceFault.deferredReadReady), value => value, 'Read A did not receive its real successful response');
      assert.equal(await page.evaluate(() => globalThis.__uiAcceptanceFault.deferredReplyOk), true);
      await poll(state, value => value.settings.generator.model === 'mock-interleaved-committed' && value.hasGeneratorKey, 'Interleaved save did not commit to real storage');
      const beforeB = await page.evaluate(() => globalThis.__uiAcceptanceFault.blockedReads);
      await page.evaluate(() => chrome.storage.local.set({ 'ui.acceptance.refresh-event': Date.now() }));
      await poll(() => page.evaluate(() => globalThis.__uiAcceptanceFault.blockedReads), value => value > beforeB, 'The real storage event did not trigger newer failed read B');
      await page.evaluate(() => globalThis.__uiAcceptanceReleaseRead());
      const warning = '配置已保存，但界面刷新失败，输入已保留。请重试刷新。';
      await page.getByText(warning, { exact: true }).waitFor();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-interleaved-committed');
      assert.equal(await page.getByLabel('Chat 服务 API Key', { exact: true }).inputValue(), 'ui-interleaved-fixture-key');
      assert.equal(await page.getByText('已保存', { exact: true }).count(), 0, 'Stale successful read A must not clear the draft after newer B failed');
      await capture(page, 'settings-interleaved-refresh-failed');
      await page.evaluate(() => { globalThis.__uiAcceptanceFault.blockWorkspace = false; globalThis.__uiAcceptanceFault.deferReadAfterSave = false; });
      await page.getByRole('button', { name: '重试刷新', exact: true }).click();
      await page.getByText('已保存', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'mock-interleaved-committed');
      assert.equal(await page.getByLabel('Chat 服务 API Key', { exact: true }).inputValue(), '');
      assert.equal(await page.evaluate(() => globalThis.__uiAcceptanceFault.saveRequests), 1, 'Recovering from interleaved reads must not repeat the save');
      await capture(page, 'settings-interleaved-refresh-recovered');
    } finally {
      await page.evaluate(() => globalThis.__uiAcceptanceReleaseRead?.()).catch(() => {});
      await page.close();
      const latest = await state();
      await rpc({ type: 'save-config', settings: original.settings, revision: latest.revision, generatorKey: '' });
      await options.evaluate(() => chrome.storage.local.remove('ui.acceptance.refresh-event'));
    }
  });
  await check('Open confirmation text updates consistently when another page changes language', async () => {
    // This notice is initially generated in English and must translate in the reverse direction.
    await preference('light', 'en'); await section(3, 'en');
    const exported = options.waitForEvent('download');
    await options.getByRole('button', { name: 'Export settings & descriptions', exact: true }).click();
    await exported;
    await options.getByText('Backup file generated', { exact: true }).waitFor();
    const changed = await sidebar.evaluate(() => chrome.runtime.sendMessage({ type: 'save-ui-preferences', patch: { locale: 'zh-CN' } }));
    assert.equal(changed.ok, true);
    await options.getByText('配置文件已生成', { exact: true }).waitFor();
    assert.equal(await options.getByText('Backup file generated', { exact: true }).count(), 0);
    await capture(options, 'settings-export-notice-en-to-zh');
    const priorTask = (await state()).task?.id;
    await rpc({ type: 'organize', action: 'organize-window', windowId });
    await finished((await taskAfter(priorTask)).task.id);
    const labels = {
      'zh-CN': { open: '清除最近任务详情', title: '清除最近任务详情？', message: '最近结果将不再显示。分组和撤销记录会保留。', confirm: '清除详情', cancel: '取消', close: '关闭' },
      en: { open: 'Clear task details', title: 'Clear recent task details?', message: 'The last result will no longer be shown. Groups and undo records are preserved.', confirm: 'Clear details', cancel: 'Cancel', close: 'Close' },
    };
    for (const initialLocale of ['zh-CN', 'en']) {
      await preference('light', initialLocale); await section(4, initialLocale);
      await options.getByRole('button', { name: labels[initialLocale].open, exact: true }).click();
      await options.getByRole('dialog', { name: labels[initialLocale].title, exact: true }).waitFor();
      const nextLocale = initialLocale === 'en' ? 'zh-CN' : 'en';
      const response = await sidebar.evaluate(locale => chrome.runtime.sendMessage({ type: 'save-ui-preferences', patch: { locale } }), nextLocale);
      assert.equal(response.ok, true);
      const dialog = options.getByRole('dialog', { name: labels[nextLocale].title, exact: true });
      await dialog.waitFor();
      await dialog.getByText(labels[nextLocale].message, { exact: true }).waitFor();
      for (const key of ['confirm', 'cancel', 'close']) assert.equal(await dialog.getByRole('button', { name: labels[nextLocale][key], exact: true }).isVisible(), true);
      if (nextLocale === 'en') assert(!/[\u4e00-\u9fff]/.test(await dialog.innerText()), 'An English confirmation must not retain Chinese copy');
      await capture(options, `dialog-cross-page-language-${initialLocale}-to-${nextLocale}`);
      await dialog.getByRole('button', { name: labels[nextLocale].cancel, exact: true }).click();
    }
    await preference('light', 'zh-CN');
  });
  await closeDialog(options);
  await check('200 percent layout zoom keeps configuration and sidebar usable', async () => {
    await preference('light', 'zh-CN');
    await options.setViewportSize({ width: 1280, height: 900 });
    await options.evaluate(() => { globalThis.document.documentElement.style.zoom = '2'; });
    try {
      for (let index = 0; index < 5; index++) { await section(index); await capture(options, `settings-${index + 1}-zoom-200`); }
    } finally { await options.evaluate(() => { globalThis.document.documentElement.style.zoom = ''; }); }
    await sidebar.setViewportSize({ width: 400, height: 900 });
    await sidebar.evaluate(() => { globalThis.document.documentElement.style.zoom = '2'; });
    try {
      await capture(sidebar, 'sidebar-zoom-200');
      await sidebar.getByRole('button', { name: '手动建组', exact: true }).click();
      await capture(sidebar, 'dialog-new-zoom-200'); await closeDialog(sidebar);
    } finally { await sidebar.evaluate(() => { globalThis.document.documentElement.style.zoom = ''; }); }
    // CSS zoom does not shrink vh/media queries exactly like browser zoom. Also exercise
    // the equivalent CSS viewport of a 400×900 sidebar displayed at 200% browser zoom.
    await sidebar.setViewportSize({ width: 200, height: 450 });
    await sidebar.evaluate(() => globalThis.scrollTo(0, 0));
    const clientWidth = await sidebar.evaluate(() => globalThis.document.documentElement.clientWidth);
    const controls = [...await sidebar.locator('.sidebar-section-title,.sidebar-action').all(), sidebar.getByRole('button', { name: '手动建组', exact: true })];
    for (const control of controls) {
      const bounds = await control.boundingBox();
      assert(bounds && bounds.x >= -1 && bounds.x + bounds.width <= clientWidth + 1, `Sidebar title/action must fit the ${clientWidth}px client area: ${JSON.stringify({ text: await control.innerText(), bounds })}`);
    }
    await capture(sidebar, 'sidebar-layout-200-equivalent');
    await sidebar.getByRole('button', { name: '手动建组', exact: true }).click();
    try {
      const dialog = sidebar.getByRole('dialog');
      for (const [name, locator] of [
        ['dialog', dialog],
        ['close button', dialog.getByRole('button', { name: '关闭', exact: true })],
        ['cancel button', dialog.getByRole('button', { name: '取消', exact: true })],
      ]) {
        const bounds = await locator.boundingBox();
        assert(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 201 && bounds.y + bounds.height <= 451, `${name} must remain inside the 200×450 equivalent CSS viewport: ${JSON.stringify(bounds)}`);
      }
      const content = dialog.locator('.modal-content');
      const scrolling = await content.evaluate(element => {
        const overflow = element.scrollHeight > element.clientHeight;
        element.scrollTop = element.scrollHeight;
        return { overflow, scrollTop: element.scrollTop, visibleHeight: element.clientHeight };
      });
      assert(scrolling.visibleHeight > 0, 'Modal content must retain visible space');
      if (scrolling.overflow) assert(scrolling.scrollTop > 0, 'Overflowing modal content must remain scrollable');
      await capture(sidebar, 'dialog-layout-200-equivalent');
    } finally { await closeDialog(sidebar); await sidebar.setViewportSize({ width: 400, height: 900 }); }
  });
  await check('Keyboard focused fields remain visible above the sticky save bar', async () => {
    await section(0);
    await options.setViewportSize({ width: 1280, height: 720 });
    await options.getByLabel('Base URL', { exact: true }).focus();
    const obscured = [];
    for (let index = 0; index < 14; index++) {
      await options.keyboard.press('Tab');
      await options.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(resolve)));
      const current = await options.evaluate(() => {
        const element = globalThis.document.activeElement;
        if (!element || element === globalThis.document.body) return null;
        const rect = element.getBoundingClientRect();
        const x = Math.min(globalThis.innerWidth - 1, Math.max(0, rect.x + rect.width / 2));
        const y = Math.min(globalThis.innerHeight - 1, Math.max(0, rect.y + rect.height / 2));
        const top = globalThis.document.elementFromPoint(x, y);
        return { text: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, inViewport: rect.top >= 0 && rect.bottom <= globalThis.innerHeight + 1, hit: !!top && (element.contains(top) || top.contains(element)), blocker: top?.className };
      });
      if (current && (!current.inViewport || !current.hit)) obscured.push(current);
    }
    await capture(options, 'settings-keyboard-focus');
    assert.deepEqual(obscured, [], 'Keyboard focus must not land behind the save bar or outside the viewport');
    await options.setViewportSize({ width: 1280, height: 900 });
  });
  await check('Primary final states, masked composition, double-resolution evidence', async () => {
    await preference('light', 'zh-CN'); await section(0);
    await options.setViewportSize({ width: 1280, height: 900 });
    await sidebar.setViewportSize({ width: 400, height: 900 });
    await rpc({ type: 'organize', action: 'organize-window', windowId }); await finished((await state()).task.id);
    for (const detail of await sidebar.locator('.native-group[open]').all()) await detail.locator(':scope > summary').click();
    const finalTab = (await state()).tabs.find(tab => tab.url.endsWith('/page/chrome-one'));
    if (finalTab) {
      await options.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, finalTab.id);
      await poll(() => sidebar.locator('.current-title').textContent(), value => value.includes(finalTab.title), 'Final fixture title did not refresh');
    }
    await capture(options, 'final-settings'); await capture(sidebar, 'final-sidebar');
    const client = await context.newCDPSession(options);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    await options.screenshot({ path: resolve(output, 'final-settings-2x.png'), fullPage: false, animations: 'disabled' });
    await client.send('Emulation.clearDeviceMetricsOverride'); await client.detach();
    const mask = await options.addStyleTag({ content: 'body :not(svg):not(svg *) { color: transparent !important; text-shadow: none !important; } input,textarea { -webkit-text-fill-color: transparent !important; } svg { color: #718096 !important; }' });
    await options.screenshot({ path: resolve(output, 'final-settings-masked.png'), fullPage: false, animations: 'disabled' });
    await mask.evaluate(element => element.remove());
    await options.screenshot({ path: resolve(output, 'final-settings-fullpage.png'), fullPage: true, animations: 'disabled' });
  });
  }

  assert.deepEqual(report.pageErrors, [], 'Uncaught browser page exceptions');
} catch (error) {
  report.checks.push({ name: 'Harness setup or fatal error', passed: false, error: error.stack || error.message });
  console.error(error);
} finally {
  releaseRequests();
  report.finishedAt = new Date().toISOString();
  report.localModelRequests = requests.length;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>AutoTabGroups UI acceptance · ${escape(round)}</title><style>body{margin:32px;background:#f5f7fb;color:#202a3b;font:14px/1.6 system-ui,sans-serif}h1{font-size:26px}.checks{padding:20px;background:white;border:1px solid #d7dfeb}.pass{color:#247348}.fail{color:#b52b3b}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}figure{margin:0;padding:12px;background:#fff;border:1px solid #d7dfeb;border-radius:7px}img{display:block;width:100%;height:300px;object-fit:contain;object-position:top;background:#eef1f6}figcaption{overflow-wrap:anywhere;margin-top:10px}a{color:#245edb}p{max-width:85ch}</style><h1>UI acceptance · ${escape(round)}</h1><p>${escape(report.environment)}. This gallery records actual extension pages. Double-resolution images are image-detail evidence. The zoom-200 states use CSS zoom; layout-200-equivalent separately checks modal reachability in a 200 × 450 CSS viewport, equivalent to a 400 × 900 sidebar at 200% browser zoom. Operating-system shortcut delivery and real providers are not covered.</p><p><a href="report.json">Machine-readable report</a> · ${report.screenshots.length} state captures · ${requests.length} local model requests</p><ol class="checks">${report.checks.map(item => `<li class="${item.passed ? 'pass' : 'fail'}">${item.passed ? 'PASS' : 'FAIL'} ${escape(item.name)}${item.error ? `<pre>${escape(item.error)}</pre>` : ''}</li>`).join('')}</ol><h2>Captured states</h2><div class="gallery">${report.screenshots.map(item => `<figure><a href="${escape(item.name)}.png"><img loading="lazy" src="${escape(item.name)}.png" alt="${escape(item.name)}"></a><figcaption>${escape(item.name)}<br>${item.width} × ${item.height} · ${escape(item.locale)} · ${escape(item.theme)}</figcaption></figure>`).join('')}</div></html>`);
  const videos = motionOnly && options && sidebar ? [options.video(), sidebar.video()] : [];
  try {
    // Resolve local recording paths while the Playwright channel is still alive. Closing
    // the context flushes the files; copying afterwards needs no closed artifact channel.
    let videoPaths = [];
    try { videoPaths = await Promise.all(videos.map(video => video?.path())); }
    finally { await context?.close(); }
    for (const [index, source] of videoPaths.entries()) {
      if (source) await copyFile(source, resolve(output, index === 0 ? 'motion-settings.webm' : 'motion-sidebar.webm'));
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = report.checks.filter(check => !check.passed);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed; ${report.screenshots.length} screenshots; evidence: ${output}`);
if (failed.length) process.exitCode = 1;
