# 模型思考强度

设置入口：**设置 → 分类生成模型**，或 **设置 → 标签分类模型 → 普通大模型**，分别配置思考参数适配 / 思考强度。

新配置和旧配置升级均默认关闭。两处设置各自用于生成方案、增量分类及对应连接测试，互不影响；Jev 和 OpenAI Decisions 使用原生 choice 接口，不接收这些参数。设置保存到本机 `config.v1`，任务快照也保留所选强度。

## 适配规则

| 模型 / 适配方式 | 控制方式 | 关闭时 |
| --- | --- | --- |
| GPT / OpenAI Chat Completions | `reasoning_effort`；按已知型号提供相应档位 | 显式发送 `none`；GPT-4o/4.1 等非推理型号不发送参数 |
| Claude 3.7 / 4 / 4.5（Messages） | `thinking.type=enabled`，低/中/高预算分别为 1024/4096/8192 token；输出上限为思考预算 + 4096 | `thinking.type=disabled` |
| Claude 4.6 及后续自适应型号（Messages） | `thinking.type=adaptive` + `output_config.effort` 低/中/高，输出上限 16384 | 支持关闭的型号发送 `disabled`；Sonnet 5.5 单独使用 `between_tools`，本插件没有工具调用 |
| DeepSeek Flash / V4 | `thinking` + `reasoning_effort` 低/高/最高 | `thinking.type=disabled` |
| DeepSeek 旧版 / 自定义别名 | 只提供思考开关；不发送未确认支持的强度档位 | 发送 `disabled`；已知强制推理型号阻止请求 |
| GLM 4.7 / 5 / 5.1 等 | 只提供思考开关 | `thinking.type=disabled` |
| GLM 5.2 / 5.3 | 5.2 提供高/最高；5.3 提供低/高/最高 | 5.2 发送 `disabled`；5.3 不能关闭 |
| Kimi K2.5 / K2.6 | 只提供思考开关 | `thinking.type=disabled` |
| Kimi K3 | `reasoning_effort` 低/高/最高，不发送 K2 的 `thinking` 字段 | 不能关闭 |
| Kimi K2.7 Code | 只提供开启，发送 `thinking: {type: enabled, keep: all}` | 不能关闭 |

部分模型不能关闭思考，例如 GPT-5 原版、o3、GPT-6 Astra、Claude Opus 5.5、GLM-5.3、Kimi K3。插件会保留默认的“关闭”选择并在发送前报错，要求用户明确选择可用档位或更换模型，**不会把关闭自动改为低档，也不会替换模型名称**。

## 自定义接口与别名

- 默认根据模型 ID 判断，支持 `厂商/模型名` 前缀。模型 ID 和 Base URL 按用户填写发送，不做替换。
- GPT、DeepSeek、GLM、Kimi 使用 OpenAI Chat Completions 协议；Claude 使用 Anthropic Messages 协议。支持自定义兼容 URL。
- 如果网关隐藏了实际模型名称，可手动指定适配方式。Claude 别名可明确选择“自适应”或“思考预算”。GLM/Kimi 的具体型号能力依赖可识别的模型名称；无法识别版本时保守提供开关。
- 将 Claude 等模型转译为 OpenAI `reasoning_effort` 的网关，可显式选择 GPT / OpenAI 参数适配，但前提是网关确实实现该转换。原生厂商之间的字段不能任意混用。
- 未识别的 Chat Completions 型号默认使用 OpenAI 参数，关闭时发送 `none`。普通非推理接口若不接受该字段，可以显式选择“普通非推理模型”；这个选项仅适用于模型本身没有思考模式，不能用于关闭强制推理模型。
- 服务拒绝参数时直接显示错误，不通过移除参数重试而落回服务商的默认思考行为。兼容网关可能忽略参数，需要自行确认其支持；mock 测试只验证客户端请求契约。
- 不发送 `temperature` 等与部分推理模型冲突的参数。只解析最终 `content` / Claude `text` 块，思考文本不作为分类方案，不保存进任务。
- 本次沿用已有请求超时和重试策略：每次请求 20 秒，仅 429/5xx 最多重试一次。较慢的思考任务可能超时；未验证真实模型延迟或服务商接入。

## 验证

`tests/thinking.test.ts` 通过 mock fetch 覆盖默认值及旧配置/任务迁移、逐型号开关与强度字段、Claude 预算和输出额度、模型别名、强制思考冲突、非法协议组合、400 不自动降级，以及 Jev 不混入生成模型参数。

浏览器冒烟脚本以独立 Chrome 和本地 mock 服务验证下拉框默认关闭、强度跨重启保存，并从 UI 调用五类模型的连接测试，核对真实发出的 HTTP JSON。不会请求实际模型服务。

## 官方接口依据

核对日期：2026-10-19。型号支持会变化，未列出的新型号及代理别名以实际服务文档为准。

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 与 [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude 思考类型与型号限制](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) 与 [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [GLM Deep Thinking](https://docs.z.ai/guides/capabilities/thinking)
- [Kimi 型号参数](https://platform.kimi.ai/docs/api/models-overview) 与 [Reasoning Effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort)
