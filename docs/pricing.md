# 金额计算

Wombat 在 Rust 内核中按内置或显式更新的官方标准 API 单价折算 Token 金额。采集和查询离线运行，不需要 API Key。金额是 Token 对应的标准 API 等价金额，不是订阅账单、源日志声明的实付金额，也不包含工具调用、存储、税费或地区附加费用。

## 价表与来源

内置价表版本 `openai-standard-2026-09-30.2`，政策 `official-standard-api-equivalent-v1`，核对日期 2026-09-30。价格数据位于 [独立价表](../core/prices/openai-standard-2026-09-30.json)，每条记录附官方链接。快照保留版本与 SHA-256；旧快照查询使用采集时保存的分项金额，不自动按新价重算。

单位为美元 / 百万 Token。

| 模型 | 非缓存输入 | 缓存读取 | 缓存创建 | 输出 | 官方依据 |
|---|---:|---:|---:|---:|---|
| gpt-5.3-codex | 1.75 | 0.175 | 未单列 | 14 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.3-codex) |
| gpt-5.4 | 2.5 | 0.25 | 未单列 | 15 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.4) |
| gpt-5.4-mini | 0.75 | 0.075 | 未单列 | 4.5 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| gpt-5.5 | 5 | 0.5 | 未单列 | 30 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.5) |
| gpt-5.6-sol | 4 | 0.4 | 5 | 20 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| gpt-5.6-terra | 2 | 0.2 | 2.5 | 12 | [模型页](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| gpt-6-sol | 2 | 0.2 | 2.5 | 10 | [模型页](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| gpt-6-astra | 10 | 1 | 12.5 | 50 | [模型页](https://developers.openai.com/api/docs/models/gpt-6-astra) |

GPT-5.4、GPT-5.5、GPT-5.6 Sol/Terra 和 GPT-6 Sol/Astra 的单次请求输入超过 272,000 Token 时，整个请求使用输入及缓存读取两倍、输出 1.5 倍的价格；列有缓存创建价格的模型，该项也使用两倍价格。阈值包含缓存输入；恰好 272,000 使用普通档。费用先按请求计算再汇总，不按每日或整轮 Token 合计套档，也不只对超过阈值的部分加价。无法确定单次请求输入量的累计补差不套用这些模型的条件单价。

明确别名只有官方模型页列出的 `gpt-5.4-2026-03-05`、`gpt-5.4-mini-2026-03-17`、`gpt-5.5-2026-04-23`。没有通配日期、子串匹配、自动去除第三方前缀或猜测相似模型。精确的官方模型名称可以映射到上述标准政策；若日志明确声明其他模型供应商或 API 提供方，本版保持费用未知。原始名称和匹配依据分别保留。

GPT-5.3-Codex、GPT-5.4、GPT-5.4 Mini 和 GPT-5.5 的核对页面没有给出独立缓存创建价格。缓存创建为零时金额为零；有缓存创建量时保留已知分项小计，该分项金额未知。GPT-5.6 Sol 的现行推广价按本次价表固定，后续价格变化可通过显式更新生成新版价表。`codex-auto-review` 是日志中的模型名，但没有经核实的公开标准 API 单价，保留费用未知。不借用其他模型、供应商或缓存 TTL 的单价。

## 联网更新价表

`wombat prices --json` 离线返回当前价表；`wombat prices update --json` 显式联网更新。终端用量页按 U 查看并选择“联网更新价表”。成功后运行 `wombat refresh`（终端按 R）让新快照使用新价表；更新价表不会修改旧快照。

来源固定为[OpenAI 官方价格 Markdown](https://developers.openai.com/api/docs/pricing.md)。这是文档下载接口，不是 OpenAI 承诺稳定的专用价格 API；`/v1/models` 不提供单价。仅解析标准文本模型表和专用表中的 Codex 行，不导入 Batch、Flex、Fast、Ultrafast、多模态、工具和带未来生效时间的其他专用模型。当前解析器要求美元/百万 Token、明确272K长上下文分界及已支持模型完整性；格式、单位、阈值或必需模型变化会报 `PRICE_SOURCE_CHANGED`，等待适配后重试。缺失单价保持 null，新模型只精确匹配名称，日期别名仅沿用内置已核对映射。

无需 API Key，不发送本机日志。Node 宿主只获取固定 HTTPS 文档，禁止重定向，30秒超时、2 MiB上限并支持取消；Rust负责校验、十进制解析、版本、持久化和计价。使用环境代理时，可在 Node 26 下设置 `NODE_USE_ENV_PROXY=1` 并沿用既有 `HTTPS_PROXY`/`HTTP_PROXY`。普通采集与查询不联网。

下载版保存于产品数据目录的 `prices/`：内容哈希命名的历史材料和原子替换的 `active.json`；来源文档SHA-256、抓取校验时间及规范化价表哈希可从接口查询。`openai-standard-live-v1-<hash>`独立于内置价格版本；同一文档重复更新不重写版本或核对时间。下载/解析失败保留原价表，尚未更新时使用内置表；损坏缓存明确报错，可重新更新恢复。旧价表历史不自动清理；这不是账户账单或历史价格生效日服务。

## 分类与精度

计算分类互不重叠：非缓存输入、缓存读取、缓存创建、输出。推理 Token 已包含在输出中，不增加一次费用。源日志的 `reportedCost` 单独保存，不进入标准折算计算，也不自动当作账单金额。

金额使用固定版本 [rust_decimal 1.40.0](https://docs.rs/crate/rust_decimal/1.40.0)（MIT），仅启用标准库功能；运行依赖为 arrayvec 和 num-traits。金额 DTO 使用十进制字符串，汇总在 Rust 中完成，界面只负责显示精度。原始结果不在每条计量阶段四舍五入，避免大量小额费用消失。

- `priced`：全部适用分类都有金额，`cost` 为完整金额。
- `partial`：部分非零用量可计价，`cost` 为空，`knownCost` 是已知小计。
- `unknown`：不能确定用量金额；已知小计为零不代表免费。
- 明确四类 Token 都是零时可确定金额为零；缺失 Token 不能替换为零。

汇总保留同一政策与价表依据。旧 v1/v2 快照的已有金额标记 `legacy_recorded`，不冒充新核对价格；与新标准政策混合汇总会被拒绝。数值错误、负金额、溢出和互相冲突的 Token 分类不能成为已计价金额。

## 独立验证

[计价测试](../core/src/pricing/tests.rs) 使用手工计算的合成数据，验证普通分项、长上下文临界点及整请求费率、推理不重计、按请求再汇总、累计补差条件未知、缺失与零、缓存创建未知、精确别名、供应商隔离、细小金额累加、旧政策隔离、溢出和持久金额回放。测试不下载价表、不安装或执行 ccusage，也不读取真实对话。
