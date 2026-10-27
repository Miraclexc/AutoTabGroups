# 开发指南

[文档首页](README.md) · [架构说明](architecture.md) · [测试指南](testing.md)

本文面向修改源码、接入服务、调试和参与贡献的开发者。只需要使用插件时，请按[安装说明](../README.md#安装)从商店或 Releases 安装。

## 环境与构建

- Node.js 22.12+，推荐 Node.js 24。
- npm 10+。
- Chrome 140+。

项目使用 npm、React、TypeScript、WXT 和 Manifest V3。页面提取使用 Readability；无需独立后端，扩展后台直接请求用户配置的模型服务。

首次获取项目并安装依赖：

```bash
git clone https://github.com/Miraclexc/AutoTabGroups.git
cd AutoTabGroups
npm ci
```

开发构建：

```bash
npm run dev
```

按 WXT 的输出加载开发扩展。生产构建使用 `npm run build`，在 `chrome://extensions` 中开启开发者模式，加载 `.output/chrome-mv3`。调试时使用单独的浏览器配置，避免开发任务影响自己的标签、密钥与已安装的商店版本。

项目保留 `package-lock.json`；复现依赖使用 `npm ci`，调整依赖时同步更新锁文件。Node 版本声明见 [.nvmrc](../.nvmrc) 和 [package.json](../package.json)。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | WXT 开发构建 |
| `npm run build` | 生产构建，输出到 `.output/chrome-mv3` |
| `npm run zip` | 生产构建并生成插件 ZIP，输出到 `.output` |
| `npm run typecheck` | 生成 WXT 类型并运行 TypeScript 检查 |
| `npm run lint` | ESLint 检查 |
| `npm test` | 离线 mock 测试 |
| `npm run test:watch` | 持续运行单元测试 |
| `npm run check` | 类型检查、lint、测试和生产构建 |
| `npm run mock:server` | 启动本地固定规则模型服务 |
| `npm run i18n:build` | 从应用词条生成 Chrome 原生语言包 |

`dev`、`build` 和 `zip` 会先生成语言包。浏览器集成检查的前置条件、命令和适用范围见[测试指南](testing.md)，具体某轮的结果不作为本指南的一部分。

生产构建完成后，在 `chrome://extensions` 中加载 `.output/chrome-mv3`。发布时将 `npm run zip` 生成的插件 ZIP 上传为 GitHub Release 附件；GitHub 自动生成的 Source code 压缩包不能直接作为扩展加载。

## 代码结构

| 目录 | 职责 |
| --- | --- |
| `src/entrypoints` | 后台、提取脚本、侧边栏及设置页入口 |
| `src/ui` | React 界面与样式 |
| `src/i18n` | 中英文词条、类型化翻译接口与结构化消息 |
| `public/_locales` | 从词条生成的 Chrome 原生语言包 |
| `src/browser` | 标签扫描、页面注入与状态核对 |
| `src/extraction` | 元数据、Readability 正文提取和结果摘录 |
| `src/ai` | 请求预算、传输、模型协议、提示词和思考参数 |
| `src/grouping` | 判定策略、Chrome 分组操作和关联恢复 |
| `src/workflows` | 生成、分类、归组、恢复及撤销流程 |
| `src/storage` | 本地配置、任务及会话缓存 |
| `src/shared` | 类型、校验规则和后台消息契约 |
| `tests` | 使用 mock 的单元与流程测试 |
| `scripts` | 本地模型 mock 和浏览器冒烟脚本 |
| `docs` | 当前用户指南、项目架构与开发参考 |
| `docs/agent` | 简短的开发过程摘要 |

优先从 `src/shared/organizer.ts` 理解命令与任务类型，再阅读 `workflows/controller.ts` 和 `workflows/organizer.ts`。侧栏和配置页共用后台状态，不能分别执行两套归组逻辑。

## 调试入口

- **界面**：侧栏与独立配置页的开发者工具用于检查 React 渲染、表单状态和消息调用。
- **后台**：在 `chrome://extensions` 的扩展详情中打开 Service Worker 检查器，查看后台命令和恢复错误。不要把密钥或完整页面内容加入日志。
- **内容提取**：使用本地 HTML 测试页检查标题、描述、正文和导航身份；提取脚本不应读取扩展密钥。
- **本地存储**：参考[存储表](architecture.md#存储和关联)区分长期配置、任务和会话数据，避免将清空所有存储作为普通调试步骤。

修改图标源 [logo.svg](../public/icon/logo.svg) 后，运行 `node scripts/generate-icons.mjs "C:\path\to\chrome.exe"` 生成四种 PNG，再构建。产物中的 `manifest.json` 来自 WXT 配置与入口元数据，应修改源配置，不直接编辑 `.output` 中的文件。

## 本地 mock 调试

所有自动化模型测试使用 mock，不调用真实模型。浏览器冒烟测试操作真实 Chrome API，但模型请求仅发送到脚本启动的本地服务，不读取用户浏览器配置。

手动调试可运行：

```bash
npm run mock:server
```

然后在扩展中填写以下地址，模型名称任意，密钥留空：

| 配置 | 地址 |
| --- | --- |
| 标准 Chat / 独立 Chat（OpenAI 或 Anthropic 兼容） | `http://127.0.0.1:4317/v1` |
| Jev | `http://127.0.0.1:4317/v1/systemone` |
| OpenAI Decisions | `http://127.0.0.1:4317/v1/decisions` |

mock 使用固定规则：为至少三个相关剩余标签提出“插件开发”组；页面含 Chrome、extension 或“插件”关键词时选择第一个类别，否则选择 `none`。它不代表真实模型的语义效果，不连接外部模型服务，也不记录页面内容。

浏览器依赖、启动方法和覆盖范围见[测试指南](testing.md)。应用设置页的“测试连接（不保存）”会请求当前配置的地址；只有配置为 mock 地址时才是本地测试。

## 接入与修改约定

| 修改范围 | 应同时检查的内容 |
| --- | --- |
| 分类接口 | 请求路径、鉴权、候选映射、完整分布校验、拒答与非法响应、缓存身份 |
| 模型思考参数 | 关闭语义、型号可用档位、协议冲突、实际构造的请求 JSON |
| 网页读取 | 基本模式不扫描正文、长度上限、取消、页面导航、远程失败兜底 |
| 原生组操作 | 当前窗口限制、最终成员数量、用户操作保护、同名组与重启关联 |
| UI / 配置 | 草稿保留、并发保存、跨页面状态同步、键盘、窄屏与中英文 |
| 存储 | 会话边界、修订号、失败写入、撤销独立性、导入导出范围 |

模型服务实现位于 `src/ai/providers`，通过统一契约交给任务编排。不要在组件中直接请求模型或执行批量归组。配置字段需要同时更新类型校验、默认值、界面、备份处理和文档。

新增文案使用集中词条和结构化消息，见[多语言开发](i18n.md)。系统提示统一英文，生成的组名与描述遵循输出语言设置；页面内容、组名和说明始终作为数据，不能成为执行指令。

## 打包与分发

`npm run zip` 在 `.output` 生成插件安装包；版本来源于 `package.json`。准备分发时同步锁文件中的项目版本，核对生成 manifest 的版本、语言包、权限和入口文件。GitHub Release 应上传插件 ZIP，自动生成的 Source code 压缩包不能作为已构建扩展加载。

Chrome 商店使用构建后的扩展 ZIP；描述、权限用途和第三方数据处理说明应与[数据与权限](privacy.md)一致。构建本身不上传或发布扩展。

## 贡献前检查

提交变更前运行 `npm run check`。涉及页面提取、Chrome 分组、恢复流程或界面交互时，按[测试指南](testing.md)选择相关浏览器检查。不要用真实密钥或私人网页内容作为测试数据。

修改协议、持久化字段或分组行为时同步更新相关文档，并保留已有设置。旧格式任务记录不兼容，不添加任务迁移或中文文案匹配逻辑；当前版本任务仍须支持恢复。界面文案与消息码的维护方法见[多语言开发](i18n.md)。模型调用必须由后台执行，页面文本应始终作为不可信数据处理。

详细设计见[架构说明](architecture.md)、[分类后端](classifier-backends.md)和[思考设置](model-thinking.md)。

文档修改应维护当前行为说明：架构、接口、测试方法和贡献指南留在 `docs`；`docs/agent` 只保留简短的开发过程要点。临时计划和探索材料完成后清理，不累积逐轮验收日志、截图或发布草案，也不复制正式技术文档。
