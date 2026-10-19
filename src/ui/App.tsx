import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '../shared/messages';
import { categoriesSchema, colors, settingsSchema, type AppState, type Category, type CategoryDraft, type Settings } from '../shared/schemas';
import { errorMessage } from '../shared/errors';
import { adapterLabels, effortLabels, thinkingCapabilities } from '../ai/thinking';
import { thinkingAdapters } from '../shared/schemas';
import { CandidateScores } from './CandidateScores';
import { ResultMetrics, statusLabels } from './ResultMetrics';

type View = 'groups' | 'results' | 'settings';
const taskLabels = { running: '正在整理', completed: '已完成', cancelled: '已取消', interrupted: '已中断', failed: '失败' };

export function App({ initialView = 'groups' }: { initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const [state, setState] = useState<AppState>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [windowId, setWindowId] = useState<number>();
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const next = await send<AppState>({ type: 'state' });
    if (sequence === refreshSequence.current) setState(next);
  }, []);
  useEffect(() => {
    void refresh().catch(error => setError(errorMessage(error)));
    void chrome.windows.getCurrent().then(window => setWindowId(window.id));
    const changed = () => { void refresh().catch(error => setError(errorMessage(error))); };
    chrome.storage.onChanged.addListener(changed);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.tabs.onRemoved.addListener(changed);
    chrome.tabs.onCreated.addListener(changed);
    const groupEvents = [chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved];
    groupEvents.forEach(event => event.addListener(changed));
    return () => { chrome.storage.onChanged.removeListener(changed); chrome.tabs.onUpdated.removeListener(changed); chrome.tabs.onRemoved.removeListener(changed); chrome.tabs.onCreated.removeListener(changed); groupEvents.forEach(event => event.removeListener(changed)); };
  }, [refresh]);

  const action = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await refresh(); if (success) setNotice(success); return true; }
    catch (error) { setError(errorMessage(error)); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  };
  if (!state) return <main><h1>AutoTabGroups</h1><p role="status">{error || '正在连接扩展后台…'}</p><button onClick={() => void refresh().catch(error => setError(errorMessage(error)))}>重试</button></main>;
  const running = state.task?.status === 'running';
  const disabled = busy || running;
  const scopedTabs = state.tabs.filter(tab => state.settings.scope === 'all' || tab.windowId === windowId);
  const ungrouped = scopedTabs.filter(tab => tab.groupId === -1 && /^https?:/.test(tab.url));
  const updateSettings = (patch: Partial<Settings>) => {
    const settings = { ...state.settings, ...patch };
    ++refreshSequence.current;
    setState({ ...state, settings });
    return action(() => send({ type: 'save-settings', settings }));
  };
  const start = (kind: 'generate' | 'update') => action(async () => {
    if (windowId === undefined) throw new Error('无法确定当前窗口');
    await send({ type: 'start', kind, windowId });
    setView('results');
  });

  return <main>
    <header><div className="brand"><span className="brand-icon">▦</span><div><h1>AutoTabGroups</h1><p>让标签回到它们的主题</p></div></div><span className="badge">本地管理</span></header>
    <nav aria-label="主导航">{(['groups', 'results', 'settings'] as View[]).map(item => <button key={item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>{({ groups: '分类', results: '整理结果', settings: '设置' })[item]}</button>)}</nav>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert" role="status">{notice}</div>}
    {view !== 'settings' && <section className="toolbar">
      <div className="row"><label>整理范围<select disabled={disabled} value={state.settings.scope} onChange={event => void updateSettings({ scope: event.target.value as Settings['scope'] })}><option value="current">当前窗口</option><option value="all">所有普通窗口</option></select></label><span className="muted">{ungrouped.length} 个未分组网页</span></div>
      <label className="toggle"><input type="checkbox" checked={state.settings.readContent} disabled={disabled} onChange={event => void updateSettings({ readContent: event.target.checked })} /><span>读取网页正文<small>{state.settings.readContent ? 'Readability 提取后发送文本，不生成摘要' : '只发送标题、清理后的 URL 和网页描述'}</small></span></label>
      <p className="privacy">点击后将页面信息发送到设置中的模型服务。固定、无痕、已分组和忽略的标签不参与。</p>
      <div className="buttons"><button className="primary" disabled={disabled || !state.categories.length} onClick={() => void start('update')}>更新分组</button><button disabled={disabled} onClick={() => void start('generate')}>AI 生成分类</button>{running && <button onClick={() => void action(() => send({ type: 'cancel' }))}>取消任务</button>}</div>
    </section>}

    {view === 'groups' && <>
      <div className="section-title"><h2>我的分类 <span>{state.categories.length}</span></h2></div>
      <p className="muted">分类描述决定新标签的归属。修改定义后，已有标签保持原状。</p>
      <p className="muted">新建分组至少需要同窗口 3 个明确匹配的标签；一两个零散标签保留未分组，已有组可接收单个标签。</p>
      <p className="muted">重启后会自动关联同名或曾接管的分组。手动新建的其他分组可在下方指定分类；删除原生组不会删除分类定义。</p>
      <CategoryEditor categories={state.categories} disabled={disabled} onSave={categories => action(() => send({ type: 'save-categories', categories }), '分类已保存')} />
      <details className="card"><summary>导入 / 导出分类</summary><ImportExport categories={state.categories} disabled={disabled} save={categories => action(() => send({ type: 'save-categories', categories }), '分类已导入')} /></details>
      {state.nativeGroups.length > 0 && <details className="card"><summary>接管现有 Chrome 分组</summary><p className="muted">选择对应分类后，新增标签可加入该组。不会移动现有标签。</p>{state.nativeGroups.map(group => <label key={group.id}>{group.title} · 窗口 {group.windowId}<select disabled={disabled} value={state.bindings.find(binding => binding.groupId === group.id)?.categoryId || ''} onChange={event => { if (event.target.value) void action(() => send({ type: 'adopt', groupId: group.id, categoryId: event.target.value })); }}><option value="">未接管</option>{state.categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>)}</details>}
      <details className="card"><summary>保持未分组 · {state.ignored.length}</summary><p className="muted">忽略仅对当前标签及当前 URL 生效，浏览器重启后重置。</p>{ungrouped.map(tab => <label className="checkline" key={tab.id}><input type="checkbox" disabled={disabled} checked={state.ignored.some(item => item.id === tab.id && item.url === tab.url)} onChange={event => void action(() => send({ type: 'ignore', tabId: tab.id, ignored: event.target.checked }))} /><span title={tab.url}>{tab.title || tab.url}</span></label>)}</details>
    </>}
    {view === 'results' && <>
      {!state.task ? <div className="empty"><h2>开始一次整理</h2><p>先添加分类，或让 AI 根据打开的网页提出方案。</p></div> : <section>
        <div className="section-title"><h2>{state.task.kind === 'generate' ? '生成分类方案' : '更新分组'}</h2><span className="badge">{taskLabels[state.task.status]}</span></div>
        <progress value={state.task.items.filter(item => item.status !== 'pending').length} max={state.task.items.length} />
        <p>{state.task.message || '正在读取和判断网页…'}</p>
        <ResultMetrics task={state.task} />
        {state.task.draft && <DraftPanel draft={state.task.draft} categories={state.categories} disabled={disabled} save={categories => action(() => send({ type: 'save-categories', categories }), '方案已合并到分类列表，可以点击更新分组')} />}
        <div className="buttons"><button disabled={disabled || !state.task.undo.some(record => record.applied && !record.undone)} onClick={() => void action(() => send({ type: 'undo' }))}>撤销这次分组</button><button disabled={busy} onClick={() => void action(refresh)}>刷新状态</button></div>
        <ul className="results">{state.task.items.map(item => <li key={item.tab.id}>
          <div className="row"><strong>{item.tab.title || '无标题网页'}</strong><span className={`status ${item.status}`}>{statusLabels[item.status]}</span></div>
          {state.task!.kind === 'update'
            ? <p className="page-preview" title={item.preview || undefined}>{item.preview || (item.status === 'pending' ? '等待读取网页内容…' : '暂无网页内容摘录')}</p>
            : <p>{item.message || '等待处理'}</p>}
          <small>{item.extraction === 'readability' ? '已读取正文' : item.extraction === 'fallback' ? '已降级读取' : '标题与描述'}{item.truncated ? ' · 内容已裁剪' : ''}{item.cached ? ' · 使用缓存' : ''}</small>
          {state.task!.kind === 'update' && <><CandidateScores item={item} categories={state.categories} />{item.message && <details className="result-details"><summary>处理详情</summary><p>{item.message}</p></details>}</>}
        </li>)}</ul>
      </section>}
    </>}
    {view === 'settings' && <SettingsPanel state={state} disabled={disabled} action={action} />}
    <footer>AutoTabGroups · 0.1.0</footer>
  </main>;
}

function CategoryEditor({ categories, disabled, onSave }: { categories: Category[]; disabled: boolean; onSave: (categories: Category[]) => Promise<boolean> }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [validation, setValidation] = useState('');
  const [describing, setDescribing] = useState(false);
  const describe = async () => {
    if (!editing?.name.trim()) return;
    const original = editing;
    setDescribing(true); setValidation('');
    try {
      const description = await send<string>({ type: 'describe-category', name: original.name });
      setEditing(current => current?.id === original.id && current.name === original.name && current.description === original.description ? { ...current, description } : current);
    } catch (error) { setValidation(errorMessage(error)); }
    finally { setDescribing(false); }
  };
  const begin = (category?: Category) => { setValidation(''); setEditing(category || { id: crypto.randomUUID(), name: '', description: '', color: 'blue', include: [], exclude: [] }); };
  return <>
    {categories.length === 0 && <div className="empty"><h3>给工作留几个清晰的分类</h3><p>例如「浏览器插件开发」「论文阅读」「旅行计划」。描述越明确，后续归组越稳定。</p></div>}
    {categories.map(category => <article className="category card" key={category.id}><div className="row"><h3><i style={{ background: category.color }} />{category.name}</h3><div className="buttons"><button disabled={disabled} onClick={() => begin(category)}>编辑</button><button disabled={disabled} aria-label={`删除分类 ${category.name}`} onClick={() => void onSave(categories.filter(item => item.id !== category.id))}>删除</button></div></div><p>{category.description}</p>{category.include.length > 0 && <small>包含：{category.include.join(' · ')}</small>}{category.exclude.length > 0 && <small>排除：{category.exclude.join(' · ')}</small>}</article>)}
    {!editing && <button className="add" disabled={disabled} onClick={() => begin()}>＋ 添加分类</button>}
    {editing && <form className="card" onSubmit={event => {
      event.preventDefault();
      const next = [...categories.filter(category => category.id !== editing.id), editing];
      const result = categoriesSchema.safeParse(next);
      if (!result.success) { setValidation(errorMessage(result.error)); return; }
      void onSave(result.data).then(saved => { if (saved) setEditing(null); });
    }}>
      <label>名称<input required maxLength={60} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
      <label>分组描述（可选）<textarea maxLength={1200} value={editing.description} placeholder="可留空，按名称判断；也可手动填写或让 AI 生成" onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
      <button type="button" disabled={disabled || describing || !editing.name.trim()} onClick={() => void describe()}>{describing ? '正在生成描述…' : 'AI 生成描述'}</button>
      <p className="muted">仅发送分类名，使用“分类生成模型”。生成后可编辑，点击保存分类才生效。</p>
      <label>颜色<select value={editing.color} onChange={event => setEditing({ ...editing, color: event.target.value as Category['color'] })}>{colors.map(color => <option key={color}>{color}</option>)}</select></label>
      <details><summary>分类边界（可选）</summary><label>包含条件，每行一条<textarea value={editing.include.join('\n')} onChange={event => setEditing({ ...editing, include: event.target.value.split('\n') })} /></label><label>排除条件，每行一条<textarea value={editing.exclude.join('\n')} onChange={event => setEditing({ ...editing, exclude: event.target.value.split('\n') })} /></label></details>
      {validation && <p role="alert">{validation}</p>}<div className="buttons"><button className="primary" disabled={disabled || describing}>保存分类</button><button type="button" onClick={() => setEditing(null)}>取消</button></div>
    </form>}
  </>;
}

function ImportExport({ categories, disabled, save }: { categories: Category[]; disabled: boolean; save: (categories: Category[]) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <><p className="muted">导入会替换分类定义；已有浏览器标签不会移动。导出不包含密钥。</p><textarea aria-label="分类 JSON" value={text} onChange={event => setText(event.target.value)} placeholder='[{"name":"开发","description":"编程与软件开发"}]' />{error && <p role="alert">{error}</p>}<div className="buttons"><button disabled={disabled} onClick={() => {
    try {
      const parsed = JSON.parse(text);
      const list: unknown[] = Array.isArray(parsed) ? parsed : parsed.groups;
      if (!Array.isArray(list)) throw new Error('请输入分类数组或包含 groups 数组的对象');
      const next = categoriesSchema.parse(list.map(item => {
        if (!item || typeof item !== 'object') throw new Error('分类必须为对象');
        const value = item as Record<string, unknown>;
        return { ...value, id: value.id || categories.find(category => category.name === value.name)?.id || crypto.randomUUID() };
      }));
      setError(''); void save(next);
    } catch (error) { setError(errorMessage(error)); }
  }}>导入列表</button><button onClick={() => setText(JSON.stringify(categories, null, 2))}>导出到文本框</button></div></>;
}

function DraftPanel({ draft, categories, disabled, save }: { draft: CategoryDraft[]; categories: Category[]; disabled: boolean; save: (categories: Category[]) => Promise<boolean> }) {
  const [text, setText] = useState(JSON.stringify(draft, null, 2));
  const [error, setError] = useState('');
  const draftJson = JSON.stringify(draft, null, 2);
  useEffect(() => { setText(draftJson); }, [draftJson]);
  if (!draft.length) return <p className="muted">暂不新增分类。可以继续打开相关网页，或手动创建分类。</p>;
  return <details className="card" open><summary>查看与编辑生成方案</summary><textarea className="json" aria-label="生成的分类方案" value={text} onChange={event => setText(event.target.value)} /><p className="muted">采用时新增分类；同名分类更新描述并保留 ID。</p>{error && <p role="alert">{error}</p>}<button className="primary" disabled={disabled} onClick={() => {
    try {
      const items: CategoryDraft[] = JSON.parse(text);
      const incoming = categoriesSchema.parse(items.map(item => ({ ...item, id: categories.find(category => category.name.toLowerCase() === item.name.toLowerCase())?.id || crypto.randomUUID() })));
      const next = categoriesSchema.parse([...categories.filter(category => !incoming.some(item => item.id === category.id)), ...incoming]);
      setError(''); void save(next);
    } catch (error) { setError(errorMessage(error)); }
  }}>采用分类方案</button></details>;
}

function SettingsPanel({ state, disabled, action }: { state: AppState; disabled: boolean; action: (fn: () => Promise<unknown>, success?: string) => Promise<boolean> }) {
  const [settings, setSettings] = useState(state.settings);
  const [generatorKey, setGeneratorKey] = useState<string>();
  const [classifierKey, setClassifierKey] = useState<string>();
  const [testResult, setTestResult] = useState('');
  const [validation, setValidation] = useState('');
  const patch = (value: Partial<Settings>) => setSettings({ ...settings, ...value });
  const save = async () => {
    const parsed = settingsSchema.parse(settings);
    await send({ type: 'save-settings', settings: parsed, generatorKey, classifierKey });
    setGeneratorKey(undefined); setClassifierKey(undefined);
  };
  const test = (provider: 'generator' | 'classifier') => action(async () => {
    await save(); setTestResult('');
    setTestResult(await send<string>({ type: 'test-provider', provider }));
  });
  return <form onSubmit={event => { event.preventDefault(); setValidation(''); void action(save, '设置已保存'); }}>
    <fieldset disabled={disabled}><legend>分类生成模型</legend>
      <label>接口协议<select aria-label="接口协议" value={settings.generator.protocol} onChange={event => patch({ generator: { ...settings.generator, protocol: event.target.value as 'openai' | 'anthropic' } })}><option value="openai">OpenAI 兼容（Chat Completions）</option><option value="anthropic">Anthropic 兼容（Messages）</option></select></label>
      <label>Base URL<input type="url" required value={settings.generator.baseUrl} onChange={event => patch({ generator: { ...settings.generator, baseUrl: event.target.value } })} /></label>
      <small>包含版本路径，例如 https://服务地址/v1；自动追加 chat/completions 或 messages。</small>
      <label>模型名称<input value={settings.generator.model} placeholder="填写服务支持的模型 ID" onChange={event => patch({ generator: { ...settings.generator, model: event.target.value } })} /></label>
      <ThinkingControls config={settings.generator} onChange={generator => patch({ generator })} />
      <label>API Key<input type="password" autoComplete="off" value={generatorKey ?? ''} placeholder={state.hasGeneratorKey ? '已保存，留空保持不变' : '未设置；本地无鉴权服务可留空'} onChange={event => setGeneratorKey(event.target.value || undefined)} /></label>
      <div className="buttons"><button type="button" onClick={() => void test('generator')}>保存并测试连接</button><button type="button" onClick={() => setGeneratorKey('')}>清除密钥（保存生效）</button></div>
    </fieldset>
    <fieldset disabled={disabled}><legend>标签分类模型</legend>
      <label>分类后端<select aria-label="分类后端" value={settings.classifier.backend} onChange={event => patch({ classifier: { ...settings.classifier, backend: event.target.value as Settings['classifier']['backend'] } })}><option value="jev">决策模型 · Jev</option><option value="openai-decisions">决策模型 · OpenAI Decisions</option><option value="llm">普通大模型</option></select></label>
      <small>切换后请检查地址、模型名称和密钥；不会自动改写这些配置。旧的决策模型地址若只填到 /v1，请手动改为完整接口 URL。</small>
      {settings.classifier.backend === 'llm' && <label>分类接口协议<select aria-label="分类接口协议" value={settings.classifier.protocol} onChange={event => patch({ classifier: { ...settings.classifier, protocol: event.target.value as 'openai' | 'anthropic' } })}><option value="openai">OpenAI 兼容（Chat Completions）</option><option value="anthropic">Anthropic 兼容（Messages）</option></select></label>}
      <label>Base URL<input type="url" required value={settings.classifier.baseUrl} onChange={event => patch({ classifier: { ...settings.classifier, baseUrl: event.target.value } })} /></label><small>{settings.classifier.backend === 'jev' ? 'Jev：填写完整接口 URL，例如 https://api.typesafe.ai/v1/systemone；按原样请求，不追加后缀。' : settings.classifier.backend === 'openai-decisions' ? 'OpenAI Decisions：填写完整接口 URL，例如 https://api.openai.com/v1/decisions；不追加后缀。模型例如 gpt-6-luna。' : '包含版本路径，自动追加 chat/completions 或 messages。'}</small>
      <label>模型名称<input value={settings.classifier.model} onChange={event => patch({ classifier: { ...settings.classifier, model: event.target.value } })} /></label>
      {settings.classifier.backend === 'llm' && <ThinkingControls config={settings.classifier} prefix="分类" onChange={config => patch({ classifier: { ...settings.classifier, ...config } })} />}
      {settings.classifier.backend !== 'llm' && <small>决策接口使用 choice 模式，不发送普通大模型的思考参数。</small>}
      <label>API Key<input type="password" autoComplete="off" value={classifierKey ?? ''} placeholder={state.hasClassifierKey ? '已保存，留空保持不变' : '未设置'} onChange={event => setClassifierKey(event.target.value || undefined)} /></label>
      <div className="buttons"><button type="button" onClick={() => void test('classifier')}>保存并测试连接</button><button type="button" onClick={() => setClassifierKey('')}>清除密钥（保存生效）</button></div>
    </fieldset>
    <p className="privacy">连接测试只发送虚构样例，会产生模型请求。密钥仅保存在本机扩展存储中，不同步、不导出；本地存储并非加密保险库。</p>
    {testResult && <p className="alert" role="status">{testResult}</p>}
    <fieldset disabled={disabled}><legend>分类与输入预算</legend>
      <label>分组依据<select value={settings.groupBy} onChange={event => patch({ groupBy: event.target.value as Settings['groupBy'] })}><option value="task">项目 / 任务</option><option value="topic">主题</option></select></label>
      <NumberField label="最多生成分类数" value={settings.maxGroups} min={2} max={30} onChange={maxGroups => patch({ maxGroups })} />
      <NumberField label="每页正文字符上限" value={settings.maxContentChars} min={500} max={20000} onChange={maxContentChars => patch({ maxContentChars })} />
      <NumberField label="输入预算（UTF-8 字节，非精确 token 数）" value={settings.requestBudget} min={4000} max={100000} onChange={requestBudget => patch({ requestBudget })} />
      <NumberField label="自动归组最低分数" value={settings.minProbability} min={0} max={1} step={0.05} onChange={minProbability => patch({ minProbability })} />
      <NumberField label="第一与第二候选最小分差" value={settings.minMargin} min={0} max={1} step={0.05} onChange={minMargin => patch({ minMargin })} />
      <small>决策模型使用接口概率；普通大模型使用自评分，并非经过校准的概率。阈值需要结合页面调整，两者都不代表已验证的正确率。</small>
    </fieldset>
    {validation && <p role="alert">{validation}</p>}
    <div className="buttons"><button className="primary" disabled={disabled}>保存设置</button><button type="button" disabled={disabled} onClick={() => void action(() => send({ type: 'clear-cache' }), '分类缓存已清除')}>清除缓存</button></div>
  </form>;
}
function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" required min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

function ThinkingControls({ config, onChange, prefix = '' }: { config: Settings['generator']; onChange: (config: Settings['generator']) => void; prefix?: string }) {
  const thinking = thinkingCapabilities(config);
  return <>
      <label>思考参数适配<select aria-label={`${prefix}思考参数适配`} value={config.thinkingAdapter} onChange={event => onChange({ ...config, thinkingAdapter: event.target.value as Settings['generator']['thinkingAdapter'], thinkingEffort: 'off' })}>{thinkingAdapters.map(adapter => <option key={adapter} value={adapter}>{adapterLabels[adapter]}</option>)}</select></label>
      <label>思考强度<select aria-label={`${prefix}思考强度`} value={config.thinkingEffort} onChange={event => onChange({ ...config, thinkingEffort: event.target.value as Settings['generator']['thinkingEffort'] })}>
        {!thinking.levels.includes(config.thinkingEffort) && <option value={config.thinkingEffort} disabled>{effortLabels[config.thinkingEffort]}（此型号不支持，请重新选择）</option>}
        {thinking.levels.map(effort => <option key={effort} value={effort}>{effortLabels[effort]}</option>)}
      </select></label>
      <small>{thinking.note} 自定义模型别名可手动选择适配方式；不会自动更换模型或开启思考。</small>
  </>;
}
