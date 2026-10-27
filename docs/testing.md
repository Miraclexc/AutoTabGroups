# 测试指南

[文档首页](README.md) · [开发指南](development.md)

测试分为逻辑与协议测试、使用真实 Chrome API 的浏览器集成检查，以及实际用户环境检查。自动化模型请求使用 mock，不使用真实供应商密钥或私人网页。

## 常规检查

在仓库根目录安装依赖后执行：

```sh
npm run check
```

该命令依次执行 TypeScript 检查、ESLint、Vitest 和生产构建。开发中可单独运行 `npm test`，或用 `npx vitest run tests/organizer.test.ts` 指定相关测试文件。

| 测试范围 | 代表文件 | 主要检查 |
| --- | --- | --- |
| 任务与恢复 | `tests/organizer.test.ts` | 动作权限、窗口隔离、取消、重试、检查点、重启与撤销 |
| 模型接口 | `tests/classifiers.test.ts`、`tests/providers.test.ts` | 请求结构、候选分布、协议错误、拒答和重试 |
| 规划与描述 | `tests/planning.test.ts`、`tests/description.test.ts` | 三页门槛、有效成员、重复名称、说明生成 |
| 思考与平台 | `tests/thinking.test.ts`、`tests/chat-platforms.test.ts` | 默认行为、型号适配、密钥与平台选择、发送字段 |
| 网页读取 | `tests/injection.test.ts`、`tests/readers.test.ts`、`tests/extraction.test.ts` | 基本模式、正文提取、远程读取、导航与取消 |
| 语言 | `tests/i18n.test.ts`、`tests/prompt-language.test.ts` | 词条一致性、复数、结构化错误、英文指令与输出语言 |
| 界面数据 | `tests/task-progress.test.tsx`、`tests/candidate-scores.test.tsx` | 阶段计数、候选排序与显示、记录持久化 |

mock 断言应检查可观察行为与发出的请求，不能只重复实现。模型质量不能由固定 mock 分数证明，浏览器运行成功也不能证明任意兼容服务均支持当前协议。

## 浏览器集成检查

先运行 `npm run build`，再指定支持加载扩展的 Chromium 可执行文件。脚本使用隔离配置与本地服务，不能指向用户日常浏览器配置目录。以下命令在仓库根目录执行：

```powershell
node scripts/ui-acceptance.mjs . 'C:\path\to\chrome.exe' ui-check
node scripts/usability-regression.mjs . 'C:\path\to\chrome.exe' usability-check
node scripts/progress-smoke.mjs 'C:\path\to\chrome.exe'
```

| 脚本 | 适用修改 | 输出位置 |
| --- | --- | --- |
| `ui-acceptance.mjs` | 完整 UI、配置草稿、弹窗、主题语言、窄屏和键盘 | `output/playwright/ui/<名称>/` |
| `usability-regression.mjs` | 配置页打开与复用、图标、首次建组、取消与重新启动 | `output/playwright/ui/<名称>/` |
| `progress-smoke.mjs` | 进度条、阶段计数、取消、原生语言包和任务消息 | `output/playwright/progress/` |

`ui-acceptance.mjs` 在输出名称后添加 `regression` 可运行异步刷新和确认框相关检查，添加 `motion` 可单独检查动效。具体参数和断言以脚本入口为准；报告与截图位于被 Git 忽略的输出目录。

正文读取和服务平台还有各自的专项脚本，可在 [scripts](../scripts) 中查看入口参数。选择与变更相关的检查，不把脚本列表或某次通过数量视为永久保证。

## 关键行为清单

### 原生分组与权限

- 三个入口操作同一触发窗口，不扫描其他窗口。
- 普通更新在已有组时不新建；单页整理不新建；AI 新组需要最终至少三个有效成员。
- 手动一页建组使用独立路径，不降低 AI 门槛。
- 同名原生组不合并，手动重命名、删组和移组后同步真实状态。
- 等待模型期间关闭、导航、固定或手动移组，不得覆盖用户更新后的状态。

### 取消、恢复与撤销

- 同一时间只运行一个整理任务，结束后释放锁并刷新界面。
- 取消停止后续请求和应用，已完成部分保留可用结果。
- 无变更任务、说明更新和连接测试不覆盖上一条有效撤销。
- 同会话恢复不重复应用已完成操作；跨浏览器会话不重放旧标签 ID。
- 无法确认结果的写入意图不直接重放，撤销尊重用户后续操作。

### 模型、读取与缓存

- 决策 URL 不追加路径；Chat 按协议拼接路径，独立服务不混用密钥。
- “关闭思考”不会因错误重试而隐式变成服务默认行为。
- 基本模式不扫描正文，不请求远程读取服务；远程读取只提交清理后的 URL。
- 分类缓存不按固定时长过期；候选、页面、模型和语义规则变化影响缓存，阈值变化重新判断原分数。
- 未知候选、缺失分数、非法分布、截断和拒答不能进入原生应用操作。

### 界面与配置

- 测试连接使用草稿且不保存；字段修改使旧测试结果失效。
- 保存冲突保留输入；已经保存但刷新失败时仅重读，不重复提交。
- 中英文同步到已打开页面和确认框，用户标题与组名保持原文。
- 检查 320px 侧栏、长英文、明暗主题、200% 缩放、Tab 焦点与 Escape。
- 导出不含密钥，导入先预览，不移动标签；清除任务详情不清除撤销记录。

## 自动化之外的边界

独立 Chromium 中的测试不能证明用户操作系统一定投递快捷键，也不能覆盖全部工具栏和右键菜单外壳表现。真实服务的账号权限、计费、延迟、参数兼容性与语义质量，需要在获得授权后按实际环境单独确认。

具体运行结果与截图留在本地测试输出目录，必要的过程要点汇入[开发过程简记](agent/README.md)。本页只维护测试方法与行为约束，不累积验收日志。
