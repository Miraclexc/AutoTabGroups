# 开发与贡献

普通用户请从 [Releases](../../../releases) 下载插件安装包，并按 [README](../README.md#安装) 安装。本文面向修改源码、调试和参与贡献的开发者。

## 环境与构建

- Node.js 22.12+，推荐 Node.js 24。
- npm 10+。
- Chrome 140+。

项目使用 npm、React、TypeScript、WXT 和 Manifest V3。页面提取使用 Readability；无需独立后端，扩展后台直接请求用户配置的模型服务。

在仓库根目录执行：

```bash
npm ci
npm run dev
```

项目保留 `package-lock.json`；复现依赖使用 `npm ci`，调整依赖时同步更新锁文件。

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
| `npm run test:browser` | 使用独立浏览器配置运行端到端验收 |

生产构建完成后，在 `chrome://extensions` 中加载 `.output/chrome-mv3`。发布时将 `npm run zip` 生成的插件 ZIP 上传为 GitHub Release 附件；GitHub 自动生成的 Source code 压缩包不能直接作为扩展加载。

## 代码结构

| 目录 | 职责 |
| --- | --- |
| `src/entrypoints` | 后台、提取脚本、侧边栏及设置页入口 |
| `src/ui` | React 界面与样式 |
| `src/browser` | 标签扫描、页面注入与状态核对 |
| `src/extraction` | 元数据、Readability 正文提取和结果摘录 |
| `src/ai` | 请求预算、传输、模型协议、提示词和思考参数 |
| `src/grouping` | 判定策略、Chrome 分组操作和关联恢复 |
| `src/workflows` | 生成、分类、归组、恢复及撤销流程 |
| `src/storage` | 本地配置、任务及会话缓存 |
| `src/shared` | 类型、校验规则和后台消息契约 |
| `tests` | 使用 mock 的单元与流程测试 |
| `scripts` | 本地模型 mock 和浏览器冒烟脚本 |

## 本地 mock 调试

所有自动化模型测试使用 mock，不调用真实模型。浏览器冒烟测试操作真实 Chrome API，但模型请求仅发送到脚本启动的本地服务，不读取用户浏览器配置。

手动调试可运行：

```bash
npm run mock:server
```

然后在扩展中填写以下地址，模型名称任意，密钥留空：

| 配置 | 地址 |
| --- | --- |
| 分类生成 / 普通大模型（OpenAI 或 Anthropic 兼容） | `http://127.0.0.1:4317/v1` |
| Jev | `http://127.0.0.1:4317/v1/systemone` |
| OpenAI Decisions | `http://127.0.0.1:4317/v1/decisions` |

mock 使用固定规则：生成“插件开发”分类；页面含 Chrome、extension 或“插件”关键词时选择第一个类别，否则选择 `none`。它不代表真实模型的语义效果，不连接外部模型服务，也不记录页面内容。

浏览器依赖、启动方法和覆盖范围见[测试与验收](manual-testing.md)。应用设置页的“保存并测试连接”会请求当前配置的地址；只有配置为 mock 地址时才是本地测试。

## 贡献前检查

提交变更前运行 `npm run check`。涉及页面提取、Chrome 分组、恢复流程或界面交互时，按[验收文档](manual-testing.md)运行相关浏览器检查。不要用真实密钥或私人网页内容作为测试数据。

修改协议、持久化字段或分组行为时同步更新相关文档，并考虑旧设置与任务记录的兼容。模型调用必须由后台执行，页面文本应始终作为不可信数据处理。

详细设计见[架构说明](architecture.md)、[分类后端](classifier-backends.md)和[思考设置](model-thinking.md)。
