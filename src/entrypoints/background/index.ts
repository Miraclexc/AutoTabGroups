import { defineBackground } from 'wxt/utils/define-background';
import { isTrustedUi } from '../../shared/messages';
import { actionLabels, actionNames, ORGANIZER_STATE_CHANGED, type OrganizeAction } from '../../shared/organizer';
import { errorMessage } from '../../shared/errors';
import { sessionId } from '../../storage/repository';
import { diagnostic, workspace } from '../../storage/workspace';
import { Organizer } from '../../workflows/organizer';
import { createController } from '../../workflows/controller';
import { syncNativeGroups } from '../../grouping/native';
import { readUiPreferences, UI_PREFERENCES_KEY } from '../../shared/ui-preferences';
import { englishActions, localizeMessage } from '../../shared/localization';

export default defineBackground(() => {
  const runner = new Organizer(async () => {
    // A notification is only an invalidation signal; each UI reads authoritative state.
    await chrome.runtime.sendMessage({ type: ORGANIZER_STATE_CHANGED });
  });
  const handle = createController(runner);
  const initialize = async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await sessionId(); await workspace();
    await chrome.alarms.clear('resume-task');
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await runner.recover();
  };
  const ready = initialize();
  void ready.catch(error => console.error('初始化失败', errorMessage(error)));
  const menus = async () => {
    const { locale } = await readUiPreferences();
    await chrome.contextMenus.removeAll();
    for (const id of actionNames) chrome.contextMenus.create({ id, title: locale === 'en' ? englishActions[id] : actionLabels[id], contexts: ['page', 'action'] });
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    const next = changes[UI_PREFERENCES_KEY]?.newValue as { locale?: string } | undefined;
    const previous = changes[UI_PREFERENCES_KEY]?.oldValue as { locale?: string } | undefined;
    if (area === 'local' && next?.locale !== previous?.locale)
      void menus().catch(error => console.error(errorMessage(error)));
  });
  chrome.runtime.onInstalled.addListener(() => { void menus().catch(error => console.error(errorMessage(error))); });
  chrome.runtime.onStartup.addListener(() => { void menus().catch(error => console.error(errorMessage(error))); });
  const trigger = async (name: string, source: 'shortcut' | 'menu', supplied?: chrome.tabs.Tab) => {
    if (!actionNames.includes(name as OrganizeAction)) return;
    const action = name as OrganizeAction;
    let tab = supplied;
    const context = supplied ? Promise.resolve(supplied) : chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => tabs[0]);
    try {
      tab = await context;
      await ready;
      await diagnostic({ action, source, at: Date.now(), windowId: tab?.windowId, executed: false, message: '已收到命令' });
      if (!tab) throw new Error('无法确定触发窗口');
      await runner.start(action, tab.windowId, tab.id, source);
    } catch (error) {
      const message = errorMessage(error);
      await diagnostic({ action, source, at: Date.now(), windowId: tab?.windowId, executed: false, message });
      if (!runner.busy) await chrome.action.setBadgeText({ text: '!' });
      const { locale } = await readUiPreferences();
      await chrome.action.setTitle({ title: locale === 'en' ? `${englishActions[action]}: ${localizeMessage(message, locale)}` : `${actionLabels[action]}：${message}` });
    }
  };
  chrome.commands.onCommand.addListener((command, tab) => { void trigger(command, 'shortcut', tab); });
  chrome.contextMenus.onClicked.addListener((info, tab) => { void trigger(String(info.menuItemId), 'menu', tab); });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'organizer-resume') void ready.then(() => runner.recover()).catch(error => console.error(errorMessage(error)));
  });
  const groupChanged = (group: { windowId: number }) => {
    void ready.then(() => syncNativeGroups(group.windowId)).catch(error => {
      // Closing a window also emits removals. There is no work to do in that window.
      if (!/No window|No current window|普通非无痕/.test(errorMessage(error))) console.error('分组信息同步失败', errorMessage(error));
    });
  };
  chrome.tabGroups.onCreated.addListener(groupChanged);
  chrome.tabGroups.onUpdated.addListener(groupChanged);
  chrome.tabGroups.onRemoved.addListener(groupChanged);
  chrome.tabGroups.onMoved.addListener(groupChanged);
  // Native events never invoke AI; UI pages subscribe to them for display only.
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!isTrustedUi(sender, chrome.runtime.id, chrome.runtime.getURL(''))) return;
    void ready.then(() => handle(message)).then(data => reply({ ok: true, data })).catch(error => reply({ ok: false, error: errorMessage(error) }));
    return true;
  });
});
