import type { OrganizeAction } from './organizer';

export const englishActions: Record<OrganizeAction, string> = {
  'organize-current': 'Organize current tab',
  'organize-window': 'Update groups',
  'organize-window-with-new': 'Update & allow new groups',
};
const messages: Record<string, string> = {
  '请填写所选服务平台的 API Key': 'Enter the selected service platform’s API key.',
  '请选择远程正文读取服务': 'Choose a remote page reader.',
  '请先配置所选正文读取服务的密钥': 'Configure the selected page reader’s API key first.',
  '正文读取仅支持 HTTP(S) 网页': 'Page readers support HTTP(S) pages only.',
  '已改用浏览器本地正文': 'Used local page content instead',
  '本地无可用正文，仅使用标题与描述': 'No local page content available; used title and description',
  '本地读取无需 API 连接': 'The local reader does not need an API connection.',
  '正文读取接口验证成功；未读取当前标签，未保存配置。': 'Reader connection verified. No current tabs were read and settings were not saved.',
  '准备分组信息': 'Preparing group information', '读取网页并匹配已有组': 'Reading pages and matching existing groups',
  '应用已有组': 'Applying existing groups', '分析新组': 'Analyzing new groups',
  '确认剩余网页归属': 'Confirming remaining pages', '应用新组方案': 'Applying new groups', '处理结束': 'Finished',
  '无法确定当前窗口，请重试': 'Could not identify the current window. Please retry.',
  '重新载入配置？': 'Reload saved settings?',
  '未保存的模型与读取设置将被放弃。': 'Unsaved model and reading settings will be discarded.',
  '放弃并重载': 'Discard & reload', '清除服务密钥？': 'Clear this service key?',
  '点击保存配置后生效。清除前仍可重载已保存配置。': 'The key is removed only after saving. You can reload saved settings before then.',
  '标记清除': 'Mark for removal', '清除最近任务详情？': 'Clear recent task details?',
  '最近结果将不再显示。分组和撤销记录会保留。': 'The last result will no longer be shown. Groups and undo records are preserved.',
  '清除详情': 'Clear details', '放弃未保存的编辑？': 'Discard unsaved changes?',
  '关闭后，本次输入的名称、颜色、说明和成员选择将不会保存。': 'Your name, color, description and member selections will not be saved.',
  '放弃编辑': 'Discard changes', '确认覆盖当前分组？': 'Replace current group details?',
  '保留你的输入，并在下次保存时覆盖当前分组的名称、颜色和说明。': 'Keep your edits and replace the current group’s name, color and description when you save.',
  '允许下次保存': 'Allow next save',
  '配置已保存，但界面刷新失败，输入已保留。请重试刷新。': 'Settings were saved, but the view could not refresh. Your input is preserved. Retry the refresh.',
  '刷新成功。刷新前的新修改仍保留，请核对已保存配置后继续。': 'Refresh complete. Your newer edits are preserved; review the saved settings before continuing.',
  '配置已保存': 'Settings saved.', '配置文件已生成': 'Configuration file created.',
  '分类缓存已清除': 'Classification cache cleared.',
  '最近任务详情已清除；撤销记录保留': 'Recent task details cleared. Undo is still available.',
  '导入完成': 'Import completed.', '分组已保存': 'Group saved.',
  '说明草稿已生成，保存后生效': 'Description draft generated. Save to apply it.',
  '后台没有响应，请重试': 'The background service did not respond. Please retry.',
  '操作已取消': 'Operation cancelled.', '请求超时，请稍后重试': 'The request timed out. Please retry.', '操作失败': 'The operation failed.',
  '已收到命令': 'Command received.', '任务已开始': 'Task started.',
  '已有任务正在执行，请等待完成或取消': 'A task is already running. Wait for it to finish or cancel it.',
  '已有任务等待恢复': 'A task is waiting to resume.',
  '当前页面已在分组中，保持原组': 'This tab is already grouped. Its group is unchanged.',
  '没有可处理的未分组网页；固定、无痕及内部页面不参与': 'There are no eligible ungrouped tabs. Pinned, incognito and internal pages are excluded.',
  '当前窗口没有分组，请使用“更新分组”初始化': 'This window has no groups. Use Update groups to get started.',
  '当前窗口没有分组；单页整理只加入已有组。可手动建组，或使用“更新分组”初始化（自动建组至少需要 3 页）。': 'This window has no groups. A single tab can only join an existing group. Create a group manually or use Update groups to initialize groups (at least 3 pages per automatic group).',
  '请先配置标准 Chat 服务，用于分组说明与新组分析': 'Configure the standard Chat service for group descriptions and new groups first.',
  '请先配置归组判断模型': 'Configure the classification model first.',
  '任务已变化或属于旧会话，请重新整理': 'The task has changed or belongs to an earlier session. Start a new task.',
  '只能重试尚未归组的本次条目': 'Only ungrouped items from this task can be retried.',
  '标签已变化，请重新整理': 'The tab has changed. Start a new task.',
  '标签已关闭或修改，保持用户操作': 'The tab was closed or changed. Your changes were kept.',
  '当前窗口没有已有组': 'This window has no existing groups.',
  '窗口分组结构已变化，请重新整理': 'The window’s groups have changed. Start a new task.',
  '窗口分组已变化，请重新整理': 'The window’s groups have changed. Start a new task.',
  '准备期间窗口分组已变化，请重新整理': 'Groups changed during preparation. Start a new task.',
  '窗口分组已变化，停止新建，请重新整理': 'Groups changed. New group creation stopped. Start a new task.',
  '没有满足条件的新组，保持未分组': 'No new group met the requirements. Left ungrouped.',
  '自动归组只能操作同窗口未分组标签': 'Automatic grouping only handles ungrouped tabs in the same window.',
  '目标分组已移动到其他窗口': 'The target group has moved to another window.',
  '目标分组已变化，请重新整理': 'The target group has changed. Start a new task.',
  '请选择同窗口未分组标签': 'Choose ungrouped tabs in this window.',
  '标签已变化，请重新选择': 'The tab has changed. Select it again.',
  '只能改分到当前窗口': 'Choose a group in the current window.',
  '目标分组已变化': 'The target group has changed.',
  '没有可撤销的成员变更': 'There are no grouping changes to undo.',
  '上次浏览器会话的操作不能撤销': 'Changes from a previous browser session cannot be undone.',
  '只能整理普通非无痕窗口': 'Only normal, non-incognito windows can be organized.',
  '分组已关闭': 'The group has been closed.',
  '生成说明期间分组已变化，请重试': 'The group changed while generating its description. Please retry.',
  '生成说明期间组内网页已变化，请重试': 'Group members changed while generating the description. Please retry.',
  '分组说明已在其他位置修改，请重试': 'The description was edited elsewhere. Please retry.',
  '标签已关闭或导航到其他页面': 'The tab was closed or navigated to another page.',
  '请填写标准 Chat 模型名称': 'Enter the standard Chat model name.',
  '连接及响应格式验证成功；仅发送虚构样例，未保存配置。': 'Connection and response format verified. Only fictional content was sent; settings were not saved.',
  '请先配置标准 Chat 服务': 'Configure the standard Chat service first.',
  '分组已在其他位置修改，请重新载入；当前输入已保留': 'The group was edited elsewhere. Reload to continue; your input was kept.',
  '名称和颜色已保存，但说明保存失败；请保留当前输入并重试': 'Name and color were saved, but the description was not. Keep your input and retry.',
  '只能选择当前窗口标签': 'Only tabs in the current window can be selected.',
  '配置已在其他页面更新，请重新载入后再保存；当前输入已保留': 'Settings were changed elsewhere. Reload before saving; your input was kept.',
  '任务记录损坏，请在配置页清除最近任务详情': 'The task record is invalid. Clear recent task details in settings.',
  '说明 ID 重复': 'The file contains duplicate description IDs.',
  '配置与说明没有变化。': 'Settings and descriptions are unchanged.',
  '将应用以下差异；不导入密钥、不移动标签。': 'The following changes will be applied. Keys are not imported and tabs are not moved.',
  '配置已变化，请重新预览导入': 'Settings changed. Preview the import again.',
  '无合适组': 'No suitable group', '没有匹配分类': 'No matching group',
  '没有合适分类或页面信息不足，保持未分组': 'No suitable group or insufficient page information. Left ungrouped.',
  '分类不够明确，保持未分组': 'The match was not clear enough. Left ungrouped.',
  '未知分类': 'Unknown group reference.',
  '此模型不支持所选思考强度，请在设置中重新选择': 'This model does not support the selected reasoning effort. Choose another setting.',
  '此模型无法关闭思考，请选择可用思考强度或更换模型；未发送请求': 'Reasoning cannot be disabled for this model. Choose a supported effort or another model. No request was sent.',
  '浏览器已重启，本任务已中断；请重新整理': 'The browser restarted and this task was interrupted. Start a new task.',
  '浏览器会话已结束，旧任务不会继续执行': 'The browser session ended. This task will not resume.',
  '浏览器已重启，请重新扫描。旧任务不会操作新会话。': 'The browser restarted. Start a new task; old tasks will not act in this session.',
  '页面或分组已变化，请重新扫描': 'The page or group has changed. Start a new task.',
  '页面休眠、冻结或加载中，仅使用标题与 URL': 'The page is sleeping, frozen or loading. Only its title and URL were used.',
  '无网站权限或无法提取，仅使用标题与 URL': 'The page could not be read. Only its title and URL were used.',
  '网页地址已变化': 'The page URL has changed.',
  '读取期间网页已变化，请重新扫描': 'The page changed while being read. Start a new task.',
  'Readability 未取得正文，使用标题与描述': 'No article text was found. Title and description were used.',
  '正文提取失败，使用标题与描述': 'Article extraction failed. Title and description were used.',
  '模型返回了不属于候选列表的分类，或缺少候选分数': 'The model returned an unknown group or omitted candidate scores.',
  '模型分数分布不合法': 'The model returned an invalid score distribution.',
  '分组方案不是有效 JSON，请重试': 'The group proposal is not valid JSON. Please retry.',
  '模型返回了重复的分类名称': 'The model returned duplicate group names.',
  '新组名称重复或使用了兜底分类': 'The proposal contains a duplicate or catch-all group name.',
  '新组方案包含无效或重复的标签引用': 'The proposal contains invalid or duplicate tab references.',
  '请先填写生成模型名称': 'Enter the Chat model name first.',
  '已手动改分': 'Page moved.', '说明草稿已生成，保存后生效。': 'Description draft generated. Save to apply it.',
};
const reverseMessages = new Map(Object.entries(messages).map(([zh, en]) => [en.replace(/[.。]$/, ''), zh]));
reverseMessages.set('Import complete', '导入完成');
reverseMessages.set('Backup file generated', '配置文件已生成');
reverseMessages.set('Task details cleared; undo record preserved', '最近任务详情已清除；撤销记录保留');

/** Translate product-owned messages only; webpage text, group names and model output stay intact. */
export function localizeMessage(message: string, locale: string): string {
  if (!message) return message;
  if (message === '分组已在其他位置修改，请重新载入；当前输入已保留') return locale === 'en'
    ? 'The group changed elsewhere. Your edits are kept; confirm replacement to save them, or cancel to leave the browser’s changes intact.'
    : '分组已在其他位置修改。当前输入已保留；可确认覆盖后保存，或取消编辑以保留浏览器中的修改。';
  if (/^模型接口返回 HTTP 401[，,.]/.test(message)) return locale === 'en'
    ? 'Authentication failed (HTTP 401). Check the API Key and the service’s authentication requirements.'
    : '鉴权失败（HTTP 401）。请检查 API Key 与服务要求的鉴权方式。';
  if (locale !== 'en') return reverseMessages.get(message.replace(/[.。]$/, '')) || message;
  if (messages[message]) return messages[message];
  const insufficient = message.match(/^当前仅有 (\d+) 页可用于新建分组；自动建组至少需要 3 页，可手动建组。$/);
  if (insufficient) return `Only ${insufficient[1]} pages are eligible for a new group. Automatic groups need at least 3 pages; you can create one manually.`;
  if (message.includes('；')) return message.split('；').map(part => localizeMessage(part, locale)).join('; ');
  const reader = message.match(/^(Tavily|DeepSeek Fetch) (.+)$/);
  if (reader) { const detail = reader[2].replace(/^正文读取失败（HTTP (\d+)）$/, 'reader failed (HTTP $1)').replace('正文读取失败：无法连接或响应格式不正确', 'reader failed: connection or response format error').replace('正文读取超时', 'reader timed out').replace('未返回可用正文', 'returned no usable content'); return `${reader[1]} ${detail}`; }
  const missingReader = message.match(/^请配置 (Tavily|DeepSeek Fetch) 读取密钥$/);
  if (missingReader) return `Configure the ${missingReader[1]} reader API key.`;
  let match = message.match(/^已加入「([\s\S]*)」$/);
  if (match) return `Added to “${match[1]}”`;
  match = message.match(/^处理结束：(\d+) 个已归组，其余保持现状。$/);
  if (match) return `Finished: ${match[1]} tabs grouped; all others unchanged.`;
  match = message.match(/^已撤销 (\d+) 个标签；已关闭或被用户修改的标签保持现状。$/);
  if (match) return `Undid changes to ${match[1]} tabs. Closed or edited tabs were left unchanged.`;
  match = message.match(/^(新增|更新)说明「([\s\S]*?)」：([\s\S]*)$/);
  if (match) return `${match[1] === '新增' ? 'Add' : 'Update'} description “${match[2]}”: ${match[3] === '（未填写）' ? '(empty)' : match[3]}`;
  match = message.match(/^数据格式不正确：([\s\S]*)$/);
  if (match) return `Invalid data format: ${match[1]}`;
  match = message.match(/^(模型自评分|匹配概率) (\d+)%$/);
  if (match) return `${match[1] === '模型自评分' ? 'Model self-rating' : 'Match probability'} ${match[2]}%`;
  match = message.match(/^有效成员少于 (\d+) 个，保持未分组$/);
  if (match) return `Fewer than ${match[1]} eligible members remain. Left ungrouped.`;
  match = message.match(/^模型接口返回 HTTP (\d+)，请检查配置或稍后重试$/);
  if (match) return `The model service returned HTTP ${match[1]}. Check settings or retry later.`;
  const labels: Record<string, string> = { '标准 Chat 服务': 'Standard Chat service', '归组判断服务': 'Classification service', '复用标准 Chat': 'Reuse standard Chat', '正文读取': 'Read page content', '正文读取服务': 'Page reader', '最低分数': 'Minimum score', '候选分差': 'Score margin', '正文长度': 'Content length', '输入预算': 'Input budget', '新组数量上限': 'New group limit' };
  for (const [zh, en] of Object.entries(labels)) if (message.startsWith(`${zh}：`)) return `${en}: ${message.slice(zh.length + 1)}`;
  if (message.includes('；')) return message.split('；').map(part => localizeMessage(part, locale)).join('; ');
  return message;
}
