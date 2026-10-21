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
import { errorMessage } from '../shared/errors';
import type { Category, PageInput, Settings } from '../shared/schemas';
import { actionLabels, type Journal, type OrganizeAction, type OrganizeItem, type OrganizeTask } from '../shared/organizer';
import { pagePreview } from '../extraction/preview';
import { readUiPreferences } from '../shared/ui-preferences';
import { englishActions, localizeMessage } from '../shared/localization';

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
    version: 'native-groups-2',
  });
}
const fatal = (error: unknown) => /HTTP (400|401|403|404)|模型名称|思考.*不支持/.test(errorMessage(error));
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
    if (this.locked) throw new Error('已有任务正在执行，请等待完成或取消');
    this.setLocked(true);
    try { return await fn(); } finally { this.setLocked(false); }
  }
  async start(action: OrganizeAction, windowId: number, tabId?: number, source: OrganizeTask['source'] = 'sidebar', retry?: { ids: number[]; bypass: boolean; allowNew: boolean; creationReason?: OrganizeTask['creationReason'] }) {
    if (this.locked) throw new Error('已有任务正在执行，请等待完成或取消');
    this.setLocked(true);
    let task: OrganizeTask | undefined;
    try {
      if ((await readOrganizerTask())?.status === 'running') throw new Error('已有任务等待恢复');
      await normalWindow(windowId);
      const all = await chrome.tabs.query({ windowId });
      let candidates = action === 'organize-current' ? all.filter(t => t.id === tabId) : all;
      if (retry) candidates = candidates.filter(t => retry.ids.includes(t.id!));
      if (action === 'organize-current' && candidates[0]?.groupId !== undefined && candidates[0].groupId !== -1) throw new Error('当前页面已在分组中，保持原组');
      const tabs = candidates.filter(t => eligible(t, [])).map(snapshot);
      if (!tabs.length) throw new Error('没有可处理的未分组网页；固定、无痕及内部页面不参与');
      const groups = await currentShape(windowId);
      if (action === 'organize-current' && !groups.length) throw new Error('当前窗口没有分组；单页整理只加入已有组。可手动建组，或使用“更新分组”初始化（自动建组至少需要 3 页）。');
      const settings = (await workspace()).settings;
      if (!settings.generator.model.trim()) throw new Error('请先配置标准 Chat 服务，用于分组说明与新组分析');
      if (!effectiveSettings(settings).classifier.model.trim()) throw new Error('请先配置归组判断模型');
      if (settings.readContent && settings.reader.provider !== 'local' && !(await readKeys())[settings.reader.provider]) throw new Error('请先配置所选正文读取服务的密钥');
      const reason = retry ? (retry.allowNew ? retry.creationReason : undefined) : creationPermission(action, groups.length);
      task = {
        version: 2, id: crypto.randomUUID(), sessionId: await sessionId(), windowId, action, source, createdAt: Date.now(),
        status: 'running', stage: 'prepare', settings: { ...settings, scope: 'current' },
        allowNew: !!reason, creationReason: reason, initialGroups: groups, targets: [],
        items: tabs.map(tab => ({ tab, status: 'pending' })), journal: [], bypassCache: retry?.bypass,
      };
      await writeOrganizerTask(task);
      await chrome.alarms.create('organizer-resume', { periodInMinutes: 0.5 });
      await diagnostic({ action, source, windowId, at: Date.now(), executed: true, message: '任务已开始' });
    } catch (error) { this.setLocked(false); throw error; }
    void this.run(task!).catch(error => console.error('任务记录或反馈保存失败', errorMessage(error)));
  }
  async retry(taskId: string, ids: number[], bypass: boolean) {
    const previous = await readOrganizerTask();
    if (!previous || previous.id !== taskId || previous.sessionId !== await sessionId()) throw new Error('任务已变化或属于旧会话，请重新整理');
    const allowed = previous.items.filter(i => ids.includes(i.tab.id) && ['failed', 'uncertain', 'unmatched', 'skipped'].includes(i.status));
    if (allowed.length !== new Set(ids).size) throw new Error('只能重试尚未归组的本次条目');
    for (const item of allowed) {
      if (!unchanged(await chrome.tabs.get(item.tab.id), item.tab)) throw new Error('标签已变化，请重新整理');
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
        task.status = 'interrupted'; task.message = '浏览器已重启，请重新扫描。旧任务不会操作新会话。';
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
      if (!unchanged(await chrome.tabs.get(item.tab.id), item.tab)) throw new Error('标签已关闭或修改，保持用户操作');
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
          if (!candidates.length) { item.status = 'unmatched'; item.pass = pass; item.message = '当前窗口没有已有组'; return; }
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
          item.message = [decision.message, page.warning].filter(Boolean).join('；'); item.pass = pass;
        } catch (error) {
          if (signal.aborted || fatal(error)) throw error;
          const still = await chrome.tabs.get(item.tab.id).catch(() => null);
          item.status = still && unchanged(still, item.tab) ? 'failed' : 'skipped';
          item.message = errorMessage(error); item.pass = pass;
        }
      };
      const apply = async (final: boolean) => {
        for (const category of [...task.targets, ...(final ? task.proposals || [] : [])]) {
          const items = task.items.filter(i => i.status === 'read' && i.categoryId === category.id);
          if (!items.length) continue;
          signal.throwIfAborted();
          try {
            let ids: number[];
            let warning: string | undefined;
            if ('nativeId' in category) ids = await joinExisting(items.map(i => i.tab), category.nativeId, write, signal);
            else {
              const result = await createNative(items.map(i => i.tab), category, 3, write, signal, async () => {
                if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new Error('窗口分组结构已变化，请重新整理');
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
              item.message = ids.includes(item.tab.id) ? warning || `已加入「${category.name}」` : warning || '标签已关闭或修改，保持用户操作';
            }
          } catch (error) {
            if (signal.aborted) throw error;
            for (const item of items) {
              const recorded = journal.records.find(r => r.tab.id === item.tab.id && r.applied);
              item.status = recorded ? 'applied' : 'failed'; item.message = errorMessage(error);
            }
          }
          await checkpoint();
        }
      };
      // Successful journal entries are authoritative across worker restarts.
      for (const item of task.items) if (task.journal.some(r => r.tab.id === item.tab.id && r.applied)) item.status = 'applied';
      if (task.stage === 'prepare') {
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new Error('窗口分组已变化，请重新整理');
        task.targets = await prepareTargets(task.windowId, task.settings, keys.generator, signal);
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new Error('准备期间窗口分组已变化，请重新整理');
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
          catch (error) { if (signal.aborted) throw error; item.status = 'skipped'; item.message = errorMessage(error); }
        }
        if (!sameShape(await currentShape(task.windowId), task.initialGroups)) throw new Error('窗口分组已变化，停止新建，请重新整理');
        task.proposals = inputs.length >= 3 ? await proposeGroups(inputs, task.targets, task.settings, keys.generator, signal) : [];
        task.stage = task.proposals.length ? 'final' : 'done';
        if (!task.proposals.length) for (const item of remaining.filter(i => i.status !== 'skipped')) item.message = inputs.length < 3
          ? `当前仅有 ${inputs.length} 页可用于新建分组；自动建组至少需要 3 页，可手动建组。`
          : '没有满足条件的新组，保持未分组';
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
      task.message = `处理结束：${task.items.filter(i => i.status === 'applied').length} 个已归组，其余保持现状。`;
    } catch (error) {
      task.status = signal.aborted ? 'cancelled' : task.items.some(i => i.status === 'applied') ? 'partial' : 'failed';
      task.message = errorMessage(error);
      for (const item of task.items.filter(i => i.status === 'pending' || i.status === 'read')) {
        item.status = signal.aborted ? 'skipped' : 'failed'; item.message = task.message;
      }
    } finally {
      try {
        await writeOrganizerTask(task);
        await diagnostic({ action: task.action, source: task.source, windowId: task.windowId, at: Date.now(), executed: true, message: task.message || task.status });
        await chrome.alarms.clear('organizer-resume');
        const count = task.items.filter(i => i.status === 'applied').length;
        await chrome.action.setBadgeText({ text: ['failed', 'partial'].includes(task.status) ? '!' : String(count) });
        const { locale } = await readUiPreferences();
        await chrome.action.setTitle({ title: locale === 'en'
          ? `${englishActions[task.action]} · Window ${task.windowId}: ${localizeMessage(task.message || '', locale)}`
          : `${actionLabels[task.action]} · 窗口 ${task.windowId}：${task.message}` });
      } finally { this.controller = undefined; this.setLocked(false); }
    }
  }
}
