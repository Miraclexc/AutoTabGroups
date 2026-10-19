import { createGenerator } from '../ai/providers/generator';
import { createClassifier } from '../ai/providers/classifier';
import { readPage } from '../browser/injection';
import { collectTabs } from '../browser/tabs';
import { undoRecord } from '../grouping/apply';
import { applyCategoryBatch } from '../grouping/bindings';
import { decide, topCandidates } from '../grouping/decision-policy';
import { errorMessage } from '../shared/errors';
import type { PageInput, TaskRecord } from '../shared/schemas';
import { MIN_NEW_GROUP_TABS } from '../shared/group-policy';
import { pagePreview } from '../extraction/preview';
import { cacheDecision, cachedDecision, fingerprint, readConfig, readIgnored, readKeys, readTask, sessionId, writeTask } from '../storage/repository';

export class TaskRunner {
  private controller?: AbortController;
  private executing = false;
  private starting = false;
  get busy() { return this.executing || this.starting; }

  async start(kind: 'generate' | 'update', windowId: number) {
    if (this.busy) throw new Error('已有任务正在运行');
    this.starting = true;
    try {
      if ((await readTask())?.status === 'running') throw new Error('已有任务等待恢复');
      const { settings, categories } = await readConfig();
      if (kind === 'update' && !categories.length) throw new Error('请先添加分类或生成分类方案');
      if (!(kind === 'generate' ? settings.generator.model : settings.classifier.model)) throw new Error('请先在设置中填写模型名称');
      const tabs = await collectTabs(settings, windowId, await readIgnored());
      if (!tabs.length) throw new Error('没有可处理的未分组网页标签');
      const task: TaskRecord = {
        id: crypto.randomUUID(), sessionId: await sessionId(), kind, status: 'running', createdAt: Date.now(),
        items: tabs.map(tab => ({ tab, status: 'pending' })), settings, categories, undo: [],
      };
      await writeTask(task);
      await chrome.alarms.create('resume-task', { periodInMinutes: 0.5 });
    } finally { this.starting = false; }
    void this.run();
  }

  async recover() {
    const task = await readTask();
    if (task?.status !== 'running') return;
    if (task.sessionId !== await sessionId()) {
      task.status = 'interrupted';
      task.message = '浏览器已重启。请重新扫描标签，旧任务不会自动操作新会话。';
      await writeTask(task);
      await chrome.alarms.clear('resume-task');
      return;
    }
    void this.run();
  }

  async cancel() {
    this.controller?.abort();
    if (!this.executing) {
      const task = await readTask();
      if (task?.status === 'running') { task.status = 'cancelled'; await writeTask(task); }
    }
  }

  async run() {
    if (this.busy) return;
    this.executing = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    let task: TaskRecord | null = null;
    try {
      task = await readTask();
      if (!task || task.status !== 'running') return;
      const keys = await readKeys();
      if (task.kind === 'generate') {
        const pages: PageInput[] = [];
        for (const item of task.items) {
          signal.throwIfAborted();
          try {
            const page = await readPage(item.tab, task.settings);
            pages.push(page);
            item.status = 'read'; item.extraction = page.extraction; item.truncated = page.truncated;
            item.message = page.warning || '已读取，等待生成方案';
          } catch (error) { item.status = 'failed'; item.message = errorMessage(error); }
          await writeTask(task);
        }
        if (!pages.length) throw new Error('没有成功读取的页面');
        task.message = '正在生成分类方案'; await writeTask(task);
        task.draft = pages.length < MIN_NEW_GROUP_TABS ? [] : await createGenerator(task.settings, keys.generator).generate(pages, signal);
        signal.throwIfAborted();
        task.message = task.draft.length ? `已生成 ${task.draft.length} 个分类，请编辑并采用方案。未改变标签分组。` : '当前没有必要新增分类，零散标签保持未分组。';
      } else {
        const classifier = createClassifier(task.settings, keys.classifier);
        for (const item of task.items) {
          signal.throwIfAborted();
          // If a worker stopped after a successful mutation, do not repeat the action.
          const prior = task.undo.find(record => record.tab.id === item.tab.id && record.applied);
          if (prior) { item.status = 'applied'; item.message = '恢复已记录的操作'; await writeTask(task); continue; }
          if (item.status !== 'pending') continue;
          try {
            const page = await readPage(item.tab, task.settings);
            item.extraction = page.extraction; item.truncated = page.truncated;
            item.preview = pagePreview(page);
            const key = await fingerprint({ page, categories: task.categories, provider: task.settings.classifier, policy: [task.settings.minProbability, task.settings.minMargin], version: 4 });
            let answer = await cachedDecision(key);
            item.cached = !!answer;
            if (!answer) {
              answer = await classifier.classify(page, task.categories, signal);
              await cacheDecision(key, answer);
            }
            signal.throwIfAborted();
            item.candidates = topCandidates(answer, task.categories);
            item.scoreSource = answer.scoreSource ?? (task.settings.classifier.backend === 'llm' ? 'llm_estimate' : 'decision_probability');
            const decision = decide(answer, task.categories, task.settings);
            item.message = [decision.message, page.warning].filter(Boolean).join('；');
            if (decision.categoryId) {
              item.categoryId = decision.categoryId;
            }
            // Persist the selected category so worker recovery can resume grouping.
            item.status = decision.categoryId ? 'read' : decision.status;
          } catch (error) {
            if (signal.aborted) throw error;
            item.status = 'failed'; item.message = errorMessage(error);
          }
          await writeTask(task);
        }
        const batches = new Map<string, typeof task.items>();
        for (const item of task.items) {
          if (item.status !== 'read' || !item.categoryId) continue;
          const key = `${item.tab.windowId}:${item.categoryId}`;
          batches.set(key, [...(batches.get(key) || []), item]);
        }
        for (const items of batches.values()) {
          signal.throwIfAborted();
          try {
            const category = task.categories.find(category => category.id === items[0].categoryId)!;
            const activeTask = task;
            const results = await applyCategoryBatch(items.map(item => item.tab), category, async records => {
              const ids = new Set(records.map(record => record.tab.id));
              activeTask.undo = [...activeTask.undo.filter(record => !ids.has(record.tab.id)), ...records];
              await writeTask(activeTask);
            }, signal);
            for (const item of items) {
              const result = results.get(item.tab.id)!;
              item.status = result.status;
              if (result.message) item.message = [item.message, result.message].filter(Boolean).join('；');
            }
          } catch (error) {
            if (signal.aborted) throw error;
            for (const item of items) { item.status = 'failed'; item.message = errorMessage(error); }
          }
          await writeTask(task);
        }
        task.message = '更新完成。零散、未匹配和不确定的标签保持未分组；新建分组至少需要同窗口 3 个明确匹配的标签。';
      }
      signal.throwIfAborted();
      task.status = 'completed';
    } catch (error) {
      if (task) { task.status = signal.aborted ? 'cancelled' : 'failed'; task.message = errorMessage(error); }
    } finally {
      try {
        if (task) await writeTask(task);
        if (!task || task.status !== 'running') await chrome.alarms.clear('resume-task');
      } finally { this.executing = false; this.controller = undefined; }
    }
  }

  async undo() {
    if (this.busy) throw new Error('请先等待任务结束');
    this.executing = true;
    try {
      const task = await readTask();
      if (!task || task.status === 'running') throw new Error('没有可撤销的已结束任务');
      if (task.sessionId !== await sessionId()) throw new Error('旧浏览器会话中的操作不能撤销');
      let restored = 0;
      for (const record of [...task.undo].reverse()) {
        if (await undoRecord(record)) restored++;
        await writeTask(task);
      }
      task.message = `已撤销 ${restored} 个标签的分组；已关闭或被修改的标签保持现状。`;
      await writeTask(task);
    } finally { this.executing = false; }
  }
}
