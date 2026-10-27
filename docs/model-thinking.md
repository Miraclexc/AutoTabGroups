# 模型思考强度

[文档首页](README.md) · [分类接口](classifier-backends.md) · [使用指南](user-guide.md)

设置入口是**配置页 → 高级 → Chat 思考参数**，可调整标准 Chat 和独立普通 Chat 分类服务的适配方式与强度。思考强度影响模型计算方式、等待时间和费用，不直接改变归组分数门槛，也不保证更高强度一定分类更好。

## 默认值与生效范围

新配置的基础默认值为“自动适配、关闭”，缺少思考字段的旧配置也补齐为关闭。选择服务平台预设会填入该预设的强度：当前 Gemini、Claude、Kimi 和智谱预设使用低档，其余预设使用关闭。保存前可查看界面提示并调整。

复用标准 Chat 时，说明、新组规划和分类共用标准 Chat 思考设置。使用独立普通 Chat 分类时，两个角色各自配置；Jev 和 OpenAI Decisions 不发送这些普通 Chat 思考参数。设置保存在本机，任务启动时固定设置快照，连接测试使用当前草稿。

## 如何选择

优先保留自动适配，按界面提供的可用档位选择。模型别名无法识别或网关改变了参数协议时，再手动指定适配方式。选择不能关闭思考的型号时，需明确选择可用档位或换一个型号；插件不会把“关闭”自动改成低档，也不会自动替换模型名。

某些模型只支持开关，不支持强度档位。这里的“开启”表示使用其思考模式，不等于所有模型都具有相同预算。参数是否被第三方网关实际执行，仍取决于该网关的实现。

## 适配规则

下表描述[当前客户端适配实现](../src/ai/thinking.ts)，用于解释发出的请求。它不代表供应商实时型号目录，也不保证任意同名兼容网关都支持这些字段。

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
| 通义千问 | `enable_thinking` 开关 | 显式发送 `false` |
| Google Gemini 的 OpenAI 兼容方式 | 通过 OpenAI 适配发送 `reasoning_effort`，按已识别型号提供档位 | 仅可关闭的型号允许关闭，其余阻止不兼容请求 |

客户端针对已知强制思考型号执行发送前检查。手动修改模型名称后，原强度可能不再适用，此时会显示错误，要求用户重新选择；不会默默改写已选强度。

## 自定义接口与别名

- 默认根据模型 ID 判断，支持 `厂商/模型名` 前缀。模型 ID 和 Base URL 按用户填写发送，不做替换。
- GPT、DeepSeek、GLM、Kimi 使用 OpenAI Chat Completions 协议；Claude 使用 Anthropic Messages 协议。支持自定义兼容 URL。
- 如果网关隐藏了实际模型名称，可手动指定适配方式。Claude 别名可明确选择“自适应”或“思考预算”。GLM/Kimi 的具体型号能力依赖可识别的模型名称；无法识别版本时保守提供开关。
- 将 Claude 等模型转译为 OpenAI `reasoning_effort` 的网关，可显式选择 GPT / OpenAI 参数适配，但前提是网关确实实现该转换。原生厂商之间的字段不能任意混用。
- 未识别的 Chat Completions 型号默认使用 OpenAI 参数，关闭时发送 `none`。普通非推理接口若不接受该字段，可以显式选择“普通非推理模型”；这个选项仅适用于模型本身没有思考模式，不能用于关闭强制推理模型。
- 服务拒绝参数时直接显示错误，不通过移除参数重试而落回服务商的默认思考行为。兼容网关可能忽略参数，需要自行确认其支持。
- 不发送 `temperature` 等与部分推理模型冲突的参数。只解析最终 `content` / Claude `text` 块，思考文本不作为分类方案，不保存进任务。
- 共用传输层对每次 fetch 设置 20 秒超时，仅 429/5xx 最多重试一次。较慢的思考任务可能超时，不会因为提高思考档位自动延长等待时间。

## 开发者维护

`resolveThinkingAdapter` 选择适配器，`thinkingCapabilities` 决定可用档位及能否关闭，`thinkingParameters` 生成协议字段。UI 和请求端应共享这套能力判断，避免界面允许的选项在后台产生另一种语义。

扩展型号规则时，检查完整模型名、厂商前缀和自定义别名；不要仅凭产品系列名推断所有型号具有相同能力。字段变更应加入 `tests/thinking.test.ts` 的 mock 请求断言，同时检查分类是否复用标准 Chat、协议是否匹配，以及关闭时确实发送了预期参数。

测试方法见[测试指南](testing.md)。本页维护适配规则，不累积逐轮测试数量或通过结论。

## 官方接口依据

接入或更新型号前应核对所用服务的参数说明；下列链接供查询，型号与账号权限以实际服务为准。

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 与 [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude 思考类型与型号限制](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting) 与 [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [GLM Deep Thinking](https://docs.z.ai/guides/capabilities/thinking)
- [Kimi 型号参数](https://platform.kimi.ai/docs/api/models-overview) 与 [Reasoning Effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort)
