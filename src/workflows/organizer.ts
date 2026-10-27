import { msg, joinMessages, renderMessage, type UserMessage } from '../i18n';
import { AppError } from '../shared/errors';
import { createClassifier } from '../ai/providers/classifier';
import { proposeGroups } from '../ai/providers/generator';
import { validateChoice } from '../ai/providers/choices';
import { readPage } from '../browser/injection';
import { eligible, snapshot, unchanged } from '../browser/tabs';
import { decide, topCandidates } from '../grouping/decision-policy';
import { currentShape, normalWindow, prepareTargets, sameShape } from '../grouping/native';
import { createNative, joinExisting, journalWriter, recoverPending } from '../grouping/operations';
import { fingerprint, readKeys, sessionId } from '../storage/repository';
import { diagnostic, getDecision, putDecision, readJournal, readOrganizerTask, workspace, writeOrganizerTask } from '../storage/workspace';
import { errorMessage, errorForDisplay, isConfigurationError } from '../shared/errors';
import type { Category, PageInput, Settings } from '../shared/schemas';
import { type Journal, type OrganizeAction, type OrganizeItem, type OrganizeTask } from '../shared/organizer';
import { pagePreview } from '../extraction/preview';
import { readUiPreferences } from '../shared/ui-preferences';

export function effectiveSettings(settings: Settings): Settings {
  return settings.classifierUseChat ? { ...settings, classifier: { ...settings.generator, backend: 'llm' } } : settings;
}
export function creationPermission(action: OrganizeAction, nativeCount: number) {
  return action === 'organize-window-with-new' ? 'explicit' as const
    : action === 'organize-window' && nativeCount === 0 ? 'empty-window' as const : undefined;
}
export async function classificationKey(page: PageInput, categories: Category[], settings: Settings) {
  return fingerprint({
    page, provider: effectiveSettings(settings).classifier,
    categories: [...categories].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({ id: c.id, name: c.name, description: c.description, include: c.include, exclude: c.exclude })),
    version: 'native-groups-3',
  });
}
const fatal = (error: unknown) => isConfigurationError(errorForDisplay(error));
export class Organizer {
  private locked = false;
  private controller?: AbortController;
  constructor(private readonly onStateChange: () => void | Promise<void> = () => {}) {}
  get busy() { return this.locked; }
  private setLocked(value: boolean) {
    if (this.locked === value) return;
    this.locked = value;
    // Chrome feedback APIs can finish after the final storage event. Publish both
    // lock transitions so an open UI never has to guess when work is executable.
    // A closed UI or failed notification must not change the operation's outcome.
    try { void Promise.resolve(this.onStateChange()).catch(() => {}); } catch { /* no listener */ }
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) throw new AppError('messages.a_task_is_already_running_wait_for_it_to');
    this.setLocked(true);
    try { return await fn(); } finally { this.setLocked(false); }
  }
  async start(action: OrganizeAction, windowId: number, tabId?: number, source: OrganizeTask['source'] = 'sidebar', retry?: { ids: number[]; bypass: boolean; allowNew: boolean; creationReason?: OrganizeTask['creationReason'] }) {
    if (this.locked) throw new AppError('messages.a_task_is_already_running_wait_for_it_to');
    this.setLocked(true);
    let task: OrganizeTask | undefined;
    try {
      if ((await readOrganizerTask())?.status === 'running') throw new AppError('messages.a_task_is_waiting_to_resume');
      await normalWindow(windowId);
      const all = await chrome.tabs.query({ windowId });
      let candidates = action === 'organize-current' ? all.filter(t => t.id === tabId) : all;
      if (retry) candidates = candidates.filter(t => retry.ids.includes(t.id!));
      if (action === 'organize-current' && candidates[0]?.groupId !== undefined && candidates[0].groupId !== -1) throw new AppError('messages.this_tab_is_already_grouped_its_group_is_unchanged');
      const tabs = candidates.filter(t => eligible(t, [])).map(snapshot);
      if (!tabs.length) throw new AppError('messages.there_are_no_eligible_ungrouped_tabs_pinned_incognito_and');
      const groups = await currentShape(windowId);
      if (action === 'organize-current' && !groups.length) throw new AppError('messages.this_window_has_no_groups_a_single_tab_can');
      const settings = (await workspace()).settings;
      if (!settings.generator.model.trim()) throw new AppError('messages.configure_the_standard_chat_service_for_group_descriptions_and');
      if (!effectiveSettings(settings).classifier.model.trim()) throw new AppError('messages.configure_the_classification_model_first');
      if (settings.readContent && settings.reader.provider !== 'local' && !(await readKeys())[settings.reader.provider]) throw new AppError('messages.configure_the_selected_page_reader_s_api_key_first');
      const reason = retry ? (retry.allowNew ? retry.creationReason : undefined) : creationPermission(action, groups.length);
      task = {
        version: 3, id: crypto.randomUUID(), sessionId: await sessionId(), windowId, action, source, createdAt: Date.now(),
        status: 'running', stage: 'prepare', settings: { ...settings, scope: 'current' }, outputLocale: (await readUiPreferences()).locale,
        allowNew: !!reason, creationReason: reason, initialGroups: groups, targets: [],
        items: tabs.map(tab => ({ tab, status: 'pending' })), journal: [], bypassCache: retry?.bypass,
      };
      await writeOrganizerTask(task);
      await chrome.alarms.create('organizer-resume', { periodInMinutes: 0.5 });
      await diagnostic({ action, source, windowId, at: Date.now(), executed: true, message: msg('messages.task_started') });
    } catch (error) { this.setLocked(false); throw error; }
    void this.run(task!).catch(error => console.error('任务记录或反馈保存失败', errorMessage(error)));
  }
  async retry(taskId: string, ids: number[], bypass: boolean) {
    const previous = await readOrganizerTask();
    if (!previous || previous.id !== taskId || previous.sessionId !== await sessionId()) throw new AppError('messages.the_task_has_changed_or_belongs_to_an_earlier');
    const allowed = previous.items.filter(i => ids.includes(i.tab.id) && ['failed', 'uncertain', 'unmatched', 'skipped'].includes(i.status));
    if (allowed.length !== new Set(ids).size) throw new AppError('messages.only_ungrouped_items_from_this_task_can_be_retried');
    for (const item of allowed) {
      if (!unchanged(await chrome.tabs.get(item.tab.id), item.tab)) throw new AppError('messages.the_tab_has_changed_start_a_new_task');
    }
    await this.start(previous.action, previous.windowId, previous.action === 'organize-current' ? ids[0] : undefined, 'retry',
      { ids, bypass, allowNew: previous.allowNew, creationReason: previous.creationReason });
  }
  async cancel() { this.controller?.abort(); }
  async recover() {
    if (this.locked) return;
    this.setLocked(true);
    try {
      await recoverPending();
      const task = await readOrganizerTask();
      if (!task || task.status !== 'running') { this.setLocked(false); return; }
      if (task.sessionId !== await sessionId()) {
        task.status = 'interrupted'; task.message = msg('messages.the_browser_restarted_start_a_new_task_old_tasks');
        await writeOrganizerTask(task); await chrome.alarms.clear('organizer-resume'); this.setLocked(false); return;
      }
      void this.run(task).catch(error => console.error('任务恢复记录失败', errorMessage(error)));
    } catch (error) { this.setLocked(false); throw error; }
  }
  private async run(task: OrganizeTask) {
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const pages = new Map<number, PageInput>();
    const settings = effectiveSettings(task.settings);
    const journal: Journal = { id: task.id, sessionId: task.sessionId, windowId: task.windowId, createdAt: task.createdAt, records: task.journal };
    const write = journalWriter(journal, async records => { task.journal = records; await writeOrganizerTask(task); });
    const checkpoint = async () => { signal.throwIfAborted(); await writeOrganizerTask(task); };
    const pageFor = async (item: OrganizeItem) => {
      if (!unchanged(await chrome.tabs.get(item.tab.id), item.tab)) throw new AppError('messages.the_tab_was_closed_or_changed_your_changes_were');
      if (!pages.has(item.tab.id)) {
        const page = await readPage(item.tab, task.settings, signal);
        signal.throwIfAborted();
        pages.set(item.tab.id, page);
        item.extraction = page.extraction; item.truncated = page.truncated; item.preview = pagePreview(page);
      }
      return pages.get(item.tab.id)!;
    };
    try {
      await chrome.action.setBadgeText({ text: '…' });
      const committed = await readJournal();
      if (committed?.id === task.id && committed.sessionId === task.sessionId) {
        const merged = new Map(task.journal.map(record => [record.tab.id, record]));
        committed.records.filter(record => record.applied).forEach(record => merged.set(record.tab.id, record));
        task.journal = [...merged.values()];
        journal.records = task.journal;
      }
      const keys = await readKeys();
      const classifier = createClassifier(settings, task.settings.classifierUseChat ? keys.generator : keys.classifier);
      const classify = async (item: OrganizeItem, candidates: Category[], pass: 'existing' | 'final') => {
        signal.throwIfAborted();
        try {
          const page = await pageFor(item);
          if (!candidates.length) { item.status = 'unmatched'; item.pass = pass; item.message = msg('messages.this_window_has_no_existing_groups'); return; }
          const key = await classificationKey(page, candidates, task.settings);
          let answer = task.bypassCache ? null : await getDecision(key);
          if (answer) {
            try {
              validateChoice(answer, Object.fromEntries([...candidates.map(c => [c.id, c.description]), ['none', '无合适组']]), {}, answer.model,
                answer.scoreSource || (settings.classifier.backend === 'llm' ? 'llm_estimate' : 'decision_probability'));
            } catch { answer = null; }
          }
          item.cached = !!answer;
          if (!answer) {
            answer = await classifier.classify(page, candidates, signal);
            signal.throwIfAborted(); await putDecision(key, answer);
          }
          signal.throwIfAborted();
          item.candidates = topCandidates(answer, candidates); item.scoreSource = answer.scoreSource;
          const decision = decide(answer, candidates, settings);
          item.categoryId = decision.categoryId; item.status = decision.categoryId ? 'read' : decision.status;
          item.message = joinMessages(decision.message, page.warning); item.pass = pass;
        } catch (error) {
          if (signal.aborted || fatal(error)) throw error;
          const still = await chrome.tabs.get(item.tab.id).catch(() => null);
          item.status = still && unchanged(still, item.tab) ? 'failed' : 'skipped';
          item.message = errorForDisplay(error); item.pass = pass;
        }
      };
      const apply = async (final: boolean) => {
        for (const category of [...task.targets, ...(final ? task.proposals || [] : [])]) {
          const items = task.items.filter(i => i.status === 'read' && i.categoryId === category.id);
          if (!items.length) continue;
          signal.throwIfAborted();
          try {
            let ids: number[];
            let warning: UserMessage | undefined;
            if ('nativeId' in category) ids = await joinExisting(items.map(i => i.tab), category.nativeId, write, signal);
            else {
              const result = await createNative(items.map(i => i.tab), category, 3, write, signal, async () => {
                if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new AppError('messages.the_window_s_groups_have_changed_start_a_new');
              });
              ids = result.ids; warning = result.warning;
              if (result.groupId !== undefined) {
                task.initialGroups = await currentShape(task.windowId);
                // Persist association immediately so worker recovery never creates a replacement.
                task.targets.push({ ...category, nativeId: result.groupId, windowId: task.windowId, profileId: category.id });
                await checkpoint();
              }
            }
            for (const item of items) {
              item.status = ids.includes(item.tab.id) ? 'applied' : 'skipped';
              item.message = warning || (ids.includes(item.tab.id) ? msg('task.joined', { name: category.name }) : msg('messages.the_tab_was_closed_or_changed_your_changes_were'));
            }
          } catch (error) {
            if (signal.aborted) throw error;
            for (const item of items) {
              const recorded = journal.records.find(r => r.tab.id === item.tab.id && r.applied);
              item.status = recorded ? 'applied' : 'failed'; item.message = errorForDisplay(error);
            }
          }
          await checkpoint();
        }
      };
      // Successful journal entries are authoritative across worker restarts.
      for (const item of task.items) if (task.journal.some(r => r.tab.id === item.tab.id && r.applied)) item.status = 'applied';
      if (task.stage === 'prepare') {
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new AppError('messages.the_window_s_groups_have_changed_start_a_new_2');
        task.targets = await prepareTargets(task.windowId, task.settings, keys.generator, signal, task.outputLocale);
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new AppError('messages.groups_changed_during_preparation_start_a_new_task');
        task.stage = 'existing'; await checkpoint();
      }
      if (task.stage === 'existing') {
        for (const item of task.items.filter(i => i.status === 'pending')) { await classify(item, task.targets, 'existing'); await checkpoint(); }
        task.stage = 'apply-existing'; await checkpoint();
      }
      if (task.stage === 'apply-existing') {
        await apply(false);
        task.stage = task.allowNew ? 'plan' : 'done'; await checkpoint();
      }
      if (task.stage === 'plan') {
        const remaining = task.items.filter(i => ['unmatched', 'uncertain'].includes(i.status));
        const inputs = [];
        for (const item of remaining) {
          try { inputs.push({ tabId: item.tab.id, page: await pageFor(item) }); }
          catch (error) { if (signal.aborted) throw error; item.status = 'skipped'; item.message = errorForDisplay(error); }
        }
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new AppError('messages.groups_changed_new_group_creation_stopped_start_a_new');
        task.proposals = inputs.length >= 3 ? await proposeGroups(inputs, task.targets, task.settings, keys.generator, signal, task.outputLocale) : [];
        task.stage = task.proposals.length ? 'final' : 'done';
        if (!task.proposals.length) for (const item of remaining.filter(i => i.status !== 'skipped')) item.message = inputs.length < 3
          ? msg('task.tooFew', { count: inputs.length })
          : msg('messages.no_new_group_met_the_requirements_left_ungrouped');
        await checkpoint();
      }
      if (task.stage === 'final') {
        const candidates = [...task.targets, ...(task.proposals || [])];
        for (const item of task.items.filter(i => ['unmatched', 'uncertain'].includes(i.status) && i.pass !== 'final')) {
          await classify(item, candidates, 'final'); await checkpoint();
        }
        task.stage = 'apply-final'; await checkpoint();
      }
      if (task.stage === 'apply-final') { await apply(true); task.stage = 'done'; }
      task.status = task.items.some(i => i.status === 'failed') ? 'partial' : 'completed';
      task.message = msg('task.finished', { count: task.items.filter(i => i.status === 'applied').length });
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : task.items.some(i => i.status === 'applied') ? 'partial' : 'failed';
      task.message = errorForDisplay(error);
      for (const item of task.items.filter(i => i.status === 'pending' || i.status === 'read')) {
        item.status = signal.aborted ? 'skipped' : 'failed'; item.message = task.message;
      }
    } finally {
      try {
        await writeOrganizerTask(task);
        await diagnostic({ action: task.action, source: task.source, windowId: task.windowId, at: Date.now(), executed: true, message: task.message || msg(`task.${task.status}`) });
        await chrome.alarms.clear('organizer-resume');
        const count = task.items.filter(i => i.status === 'applied').length;
        await chrome.action.setBadgeText({ text: ['failed', 'partial'].includes(task.status) ? '!' : String(count) });
        const { locale } = await readUiPreferences();
        await chrome.action.setTitle({ title: renderMessage(msg('action.windowResult', { action: msg(`actions.${task.action}`), windowId: task.windowId, message: task.message || '' }), locale) });
      } finally { this.controller = undefined; this.setLocked(false); }
    }
  }
}
