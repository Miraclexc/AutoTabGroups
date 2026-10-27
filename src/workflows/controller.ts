import { AppError } from '../shared/errors';
import { msg } from '../i18n';
import { organizerCommandSchema, type OrganizerState } from '../shared/organizer';
import { eligible, snapshot } from '../browser/tabs';
import { groupDescription, normalWindow, syncNativeGroups } from '../grouping/native';
import { createNative, journalWriter, moveManually, undoLatest } from '../grouping/operations';
import { readKeys, sessionId } from '../storage/repository';
import { CACHE, clearOrganizerTask, diagnostic, exportConfig, importConfig, mutateWorkspace, newJournal, previewImport, readJournal, readOrganizerTask, saveConfiguration, workspace } from '../storage/workspace';
import { createClassifier } from '../ai/providers/classifier';
import { describeNativeGroup } from '../ai/providers/description';
import { effectiveSettings, Organizer } from './organizer';
import { remoteContent } from '../extraction/remote';
import { readUiPreferences, saveUiPreferences } from '../shared/ui-preferences';

export function createController(runner: Organizer) {
  return async (message: unknown): Promise<unknown> => {
    const command = organizerCommandSchema.parse(message);
    if (command.type === 'save-ui-preferences') return saveUiPreferences(command.patch);
    if (command.type === 'workspace-state') {
      const groups = await syncNativeGroups(command.windowId);
      const [config, tabs, keys, task, journal, diag, session] = await Promise.all([
        workspace(), chrome.tabs.query({ windowId: command.windowId }), readKeys(), readOrganizerTask(), readJournal(), diagnostic(), sessionId(),
      ]);
      const state: OrganizerState = {
        settings: config.settings, revision: config.revision, groups,
        tabs: tabs.filter(t => t.id !== undefined).map(t => ({ ...snapshot(t), pinned: t.pinned, active: t.active, eligible: eligible(t, []) })),
        task, journal, diagnostic: diag, sessionId: session, hasGeneratorKey: !!keys.generator, hasClassifierKey: !!keys.classifier, hasReaderKeys: { tavily: !!keys.tavily, deepseek: !!keys.deepseek }, busy: runner.busy,
      };
      return state;
    }
    if (command.type === 'cancel') return runner.cancel();
    if (command.type === 'acknowledge-result') {
      if (!runner.busy) await chrome.action.setBadgeText({ text: '' });
      return;
    }
    if (command.type === 'organize') return runner.start(command.action, command.windowId, command.tabId);
    if (command.type === 'retry-items') return runner.retry(command.taskId, command.tabIds, command.bypassCache);
    if (command.type === 'locate-tab') {
      const tab = await chrome.tabs.get(command.tab.id).catch(() => null);
      if (!tab || tab.url !== command.tab.url || tab.incognito) throw new AppError('messages.the_tab_was_closed_or_navigated_to_another_page');
      await chrome.tabs.update(tab.id!, { active: true }); await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
    if (command.type === 'export-config') return exportConfig();
    if (command.type === 'preview-import') return previewImport(command.data);
    return runner.exclusive(async () => {
      switch (command.type) {
        case 'save-config': return saveConfiguration(command.settings, command.revision, command.generatorKey, command.classifierKey, command.readerKeys);
        case 'test-reader': {
          const provider = command.settings.reader.provider;
          if (provider === 'local') return msg('messages.the_local_reader_does_not_need_an_api_connection');
          const keys = await readKeys();
          await remoteContent('https://example.com/', command.settings, command.readerKeys?.[provider] ?? keys[provider]);
          return msg('messages.reader_connection_verified_no_current_tabs_were_read_and');
        }
        case 'test-config': {
          const keys = await readKeys();
          const generatorKey = command.generatorKey === undefined ? keys.generator : command.generatorKey.trim();
          const classifierKey = command.classifierKey === undefined ? keys.classifier : command.classifierKey.trim();
          const settings = effectiveSettings(command.settings);
          const page = { title: 'Extension documentation', url: 'https://example.com/docs', description: 'Fictional browser extension guide.', extraction: 'metadata' as const, truncated: false };
          if (command.provider === 'generator') {
            if (!settings.generator.model.trim()) throw new AppError('messages.enter_the_standard_chat_model_name');
            const { locale } = await readUiPreferences();
            await describeNativeGroup(locale === 'en' ? 'Extensions' : '插件开发', [page], settings, generatorKey, undefined, locale);
          } else await createClassifier(settings, command.settings.classifierUseChat ? generatorKey : classifierKey)
            .classify(page, [{ id: 'sample', name: '插件开发', color: 'blue', description: '浏览器插件开发', include: [], exclude: [] }]);
          return msg('messages.connection_and_response_format_verified_only_fictional_content_was');
        }
        case 'describe-group': {
          const group = (await syncNativeGroups(command.windowId)).find(g => g.nativeId === command.groupId);
          if (!group) throw new AppError('messages.the_group_has_been_closed');
          const settings = (await workspace()).settings;
          if (!settings.generator.model) throw new AppError('messages.configure_the_standard_chat_service_first');
          return groupDescription(group, settings, (await readKeys()).generator, undefined, (await readUiPreferences()).locale);
        }
        case 'edit-group': {
          await normalWindow(command.windowId);
          const group = (await syncNativeGroups(command.windowId)).find(g => g.nativeId === command.groupId && g.profileId === command.profileId);
          if (!group || group.name !== command.expected.name || group.color !== command.expected.color || group.description !== command.expected.description)
            throw new AppError('messages.the_group_was_edited_elsewhere_reload_to_continue_your');
          await chrome.tabGroups.update(group.nativeId, { title: command.value.name, color: command.value.color });
          try {
            await mutateWorkspace(current => ({ ...current, profiles: current.profiles.map(p => p.id === group.profileId
              ? { ...p, ...command.value, source: 'user', titles: [...new Set([p.name, ...p.titles])].slice(0, 50) } : p) }));
          } catch { throw new AppError('messages.name_and_color_were_saved_but_the_description_was'); }
          return;
        }
        case 'create-manual': {
          if (command.tabs.some(t => t.windowId !== command.windowId)) throw new AppError('messages.only_tabs_in_the_current_window_can_be_selected');
          return createNative(command.tabs, command.value, 1, journalWriter(await newJournal(command.windowId)));
        }
        case 'move-manual': return moveManually(command.tab, command.groupId, journalWriter(await newJournal(command.tab.windowId)));
        case 'undo': return undoLatest();
        case 'clear-cache': return chrome.storage.session.remove([CACHE, 'decisions']);
        case 'clear-task': return clearOrganizerTask();
        case 'import-config': return importConfig(command.data, command.revision);
      }
    });
  };
}
