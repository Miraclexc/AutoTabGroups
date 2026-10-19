import { defineBackground } from 'wxt/utils/define-background';
import { commandSchema, isTrustedUi } from '../../shared/messages';
import { errorMessage } from '../../shared/errors';
import { createGenerator } from '../../ai/providers/generator';
import { generateDescription } from '../../ai/providers/description';
import { createClassifier } from '../../ai/providers/classifier';
import { TaskRunner } from '../../workflows/task-runner';
import { getState, readConfig, readIgnored, readKeys, readTask, sessionId, writeConfig, writeIgnored, writeKeys } from '../../storage/repository';
import { adoptGroup, saveCategories, synchronizeBindings, synchronizeBindingsOnStartup, watchGroupChanges } from '../../grouping/bindings';

export default defineBackground(() => {
  const runner = new TaskRunner();
  let mutating = false;
  const initialize = async () => {
    if (typeof chrome.storage.local.setAccessLevel !== 'function') throw new Error('当前浏览器缺少本地存储访问控制，请使用 Chrome 140 或更新版本');
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await sessionId();
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await synchronizeBindingsOnStartup();
    await runner.recover();
  };
  const ready = initialize();
  watchGroupChanges(ready, error => console.error('分组关联同步失败', errorMessage(error)));
  // Keep event listeners registered synchronously for MV3 wakeups.
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'resume-task') void ready.then(() => runner.recover());
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Only extension UI pages can issue commands. A page/content script cannot request keys or model calls.
    if (!isTrustedUi(sender, chrome.runtime.id, chrome.runtime.getURL(''))) return;
    const handle = async () => {
      await ready;
      const command = commandSchema.parse(message);
      if (command.type === 'state') { await synchronizeBindings(); return getState(); }
      if (command.type === 'cancel') return runner.cancel();
      if (mutating) throw new Error('正在保存或启动任务，请稍后重试');
      mutating = true;
      try {
        if (runner.busy || (await readTask())?.status === 'running') throw new Error('任务运行中，请先等待完成或取消');
        switch (command.type) {
          case 'start': return await runner.start(command.kind, command.windowId);
          case 'undo': return await runner.undo();
          case 'save-settings': {
            const config = await readConfig();
            await writeConfig({ ...config, settings: command.settings });
            const keys = await readKeys();
            if (command.generatorKey !== undefined) keys.generator = command.generatorKey.trim();
            if (command.classifierKey !== undefined) keys.classifier = command.classifierKey.trim();
            await writeKeys(keys);
            return;
          }
          case 'save-categories': {
            await saveCategories(command.categories);
            return;
          }
          case 'describe-category': {
            const { settings } = await readConfig();
            const keys = await readKeys();
            return await generateDescription(command.name, settings, keys.generator);
          }
          case 'ignore': {
            const tab = await chrome.tabs.get(command.tabId);
            const list = (await readIgnored()).filter(item => item.id !== command.tabId);
            if (command.ignored) list.push({ id: command.tabId, url: tab.url || '' });
            await writeIgnored(list); return;
          }
          case 'clear-cache': await chrome.storage.session.remove('decisions'); return;
          case 'adopt': {
            await adoptGroup(command.categoryId, command.groupId); return;
          }
          case 'test-provider': {
            const { settings } = await readConfig();
            const keys = await readKeys();
            const page = { title: 'Chrome extension API guide', url: 'https://example.com/extensions', description: 'A fictional page about building browser extensions.', extraction: 'metadata' as const, truncated: false };
            if (command.provider === 'generator') await createGenerator(settings, keys.generator).generate([page]);
            else await createClassifier(settings, keys.classifier).classify(page, [{ id: 'sample', name: '插件开发', description: '浏览器插件开发文档', include: [], exclude: [], color: 'blue' }]);
            return '连接及响应格式验证成功（仅发送虚构样例）';
          }
        }
      } finally { mutating = false; }
    };
    void handle().then(data => reply({ ok: true, data })).catch(error => reply({ ok: false, error: errorMessage(error) }));
    return true;
  });
});
