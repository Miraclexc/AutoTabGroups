# 架构

## 运行环境

1. React 侧边栏和设置页向后台发送经过 schema 校验的命令。
2. Service Worker 是配置、任务、模型调用和分组操作的单一写入者。
3. 按需注入的 isolated-world content script 只提取页面，不读取凭据或调用模型。

`entrypoints` 只负责启动；`workflows` 编排；`ai` 处理协议；`grouping` 执行决策和浏览器变更；`storage` 保存状态。

## 数据流

生成：未分组标签 → 页面提取 → 输入预算 → 生成模型 → schema 校验 → 分类草案 → 用户编辑采用。

更新：未分组标签 → 页面提取 → 判定缓存或所选分类后端（Jev / OpenAI Decisions / 普通大模型） → 决策阈值 → 按窗口和类别汇总 → 写入前日志 → 再核对标签及数量 → Chrome 批量分组 → 结果和撤销记录。

新建原生组要求同窗口至少 3 个仍可操作的明确匹配标签，一次 tabs.group 调用加入全部成员。现有组允许追加单个标签。只有一两个匹配项时记录为跳过，后续更新重新统计；不自动合并不同类别或窗口凑数量。任务先持久化分类结果（read + categoryId），再归组，同会话恢复不重复调用分类模型。批量写入前/后的日志保留逐标签撤销信息。

生成模型可以返回空 groups；成功读取不足 3 页时直接返回空方案，不调用生成模型。提示词要求少而必要的分类，真正创建原生组仍经过上述数量门槛。

手动分类允许空描述；AI 批量生成的分类仍要求描述。describe-category 命令仅向生成模型发送一个分类名，返回描述草稿供用户修改和保存，不自动读取页面或保存分类。

所有未匹配、低置信、读取/请求失败记录均保留在任务列表，不从统计分母删除。

## 身份与状态

- 分类 ID 是本地稳定 UUID，与可编辑名称无关。
- 原生分组绑定以类别 ID + 窗口 ID 为键，存于 storage.session。
- `grouping/bindings.ts` 在启动、原生组事件、读取 UI 状态及实际应用前重新查询所有普通非无痕窗口中的组。浏览器会话 ID 不跨会话复用。
- `storage.local` 的 `groupHints.v1` 只存分类 ID 与观察到的组名，不存原生组/窗口 ID 或网页内容。重启后根据名称重新建立 session 绑定；延迟恢复的窗口也能匹配。旧版本无 hints 时自动按分类名迁移。
- 同会话有效绑定优先，保留手动重命名及移动；否则用分类名/历史名称的唯一分类匹配。同窗口多候选组按当前 ID 排序选一，不合并。分类歧义时保留未绑定状态并阻止重复创建，等待显式接管。
- 事件同步、接管、分类编辑与实际归组共享串行队列；模型请求不持有队列。归组在写入前日志之后再次校验目标，避免在模型等待或异步存储期间新增/删除组造成重复创建。Chrome 操作与用户手动操作无法形成原子事务，最后一次核对之后的极短竞争窗口仍可能需要重试或手动调整。
- 原生组删除只清理绑定，不删除分类/重建组；只有主动更新中的明确匹配才创建缺失组。未知用户组不自动生成分类，UI 实时展示供手动接管；同步过程不调用模型。
- 任务记录存于 storage.local，并带浏览器会话 ID。Service Worker 重启可恢复当前会话任务，浏览器重启则标记中断。
- 每次应用前检查标签 ID、窗口、URL、标题、pendingUrl、固定状态和分组归属。
- 默认只更新未分组标签，因此撤销恢复为未分组，并尽可能恢复原标签位置。
- 取消会 abort 模型 fetch；已经完成的浏览器动作仍保留日志并可撤销。

## 缓存

更新任务条目另存 preview：优先取已读取正文，没有正文时取网页描述，合并空白并截取最多 160 个 Unicode 字符（含省略号）。不调用模型总结，也不为预览额外读取正文。该摘录随本次任务保存在本地，刷新和重启后可见；完整正文仍不落盘。旧任务允许缺少 preview，显示暂无摘录；处理原因保留在可展开的详情中。

缓存键为页面输入、全部分类定义、分类后端、协议、模型地址和名称、思考配置、阈值、策略版本的 SHA-256。缓存只包含判定，不包含正文，1 小时失效、最多 300 条、浏览器会话结束清除。使用滚动模型别名时，缓存可能保留别名之前的结果直到过期，可手动清除。

## 接口边界

生成与分类分别实现 GroupGenerator 和 TabClassifier。classifier.ts 按配置选择后端，Jev 与 Decisions 分别适配原生 choice 协议；普通大模型与生成器共用 chat.ts 的 OpenAI / Anthropic 请求及思考适配。choices.ts 统一候选构造、分数校验和稳定分类 ID 映射，不把模型字符串当 Chrome groupId。

Classification.scoreSource 区分 decision_probability 与 llm_estimate，缓存保留此字段，结果区分概率与模型自评分。普通大模型的自评分不是经过校准的概率。拒绝及非法响应报错，保留失败记录，不切换到其他后端。详见 [分类后端](classifier-backends.md)。

网页文本始终作为不可信数据。选择项仅含实际分类和 none；无合适分类、信息不足统一归入 none。响应检查合法选项、完整概率键、概率和与最高项一致性。

## 实现约束

- 页面提取只处理顶层已加载 DOM。Readability 更适合文章文本，复杂应用、画布、PDF、视频和跨域 iframe 可能无法提取正文。正文模式在 DOM 副本中排除表单及可编辑区域；轻量模式仅读取元数据。
- 输入预算使用 UTF-8 字节估算，并非特定模型的 tokenizer。生成方案时可以裁剪正文，但不能静默丢弃页面；元数据本身超预算时报告错误。
- 模型请求每次超时 20 秒，429 / 5xx 最多重试一次；取消会中止正在进行的请求。错误提示不展示服务端原始响应体。
- AI 生成分类要求名称优先 2～6 个汉字、最多 8 个字符，详细含义放在描述和边界中；这是生成提示要求，手动名称按 schema 校验。
- 导入分类时补全缺失 ID，同名项沿用现有 ID，整体替换定义；采用 AI 方案按名称合并并保留已有 ID。
- 名称匹配忽略首尾空格、大小写并统一 Unicode；同窗口多个同名组优先保留有效绑定，否则按当前 ID 选择最小者，不自动合并或删除组。每个分类最多保留 50 个历史组名，删除分类时一并清除。
- 组名只是启发式标识：同名但含义无关的组也可能被关联，未观察到的改名、空组名及歧义可能需要手动接管。插件不负责重新打开关闭的网页或尚未打开的已保存组。
- Chrome 分组操作和任务日志不是事务。后台恰在两者之间中断时，不能保证精确一次执行；恢复会重查标签避免覆盖用户分组，未记录的极短窗口内操作可能需要手动调整。
- 只保留最近一次任务及其撤销记录，新建任务会覆盖上一条记录。撤销跳过已关闭、已导航或被手动重新分组的标签。

## 参考

- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://wxt.dev/guide/essentials/entrypoints.html
- https://github.com/mozilla/readability
- https://developers.openai.com/api/reference/resources/chat
- https://platform.claude.com/docs/en/api/overview
- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/primitives/choice

启动时若 Chrome 尚无当前窗口，tabGroups.query 可返回 No current window（见 [Chromium 实现](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/tab_groups/tab_groups_api.cc)）。初始化只对这一特定错误暂缓关联同步，保留名称提示，由后续分组事件或 UI 请求重试；其他错误继续报告。

任务条目持久化 candidates（最多三个 categoryId/name/color/score）及 scoreSource。候选从任务分类快照中按原始分数降序选择，只包含真实分组，不包括拒绝归类选项；历史名称保持不变，显示颜色优先使用当前分类颜色，再回退到保存颜色或灰色。旧条目允许缺失候选字段，UI 提示重新更新以获得分数。当前缓存策略版本为 4，避免复用旧地址拼接语义、旧提示词及旧拒绝选项的结果。UI 将 uncertain 和 unmatched 统一显示并统计为“未匹配”，内部保留判定原因。
