# CLI 命令入口

中文 | [English](README.en.md)

`@wombat/cli` 解析参数，输出文本或 JSON，并装配查询与本机 Web 启动。命令和参数以[CLI 使用说明](../docs/guides/cli.md)为准。

## 公开入口

- 包根入口提供参数解析与 `runUsageCli`；`./format` 提供结果文本格式化。
- `refresh`、`usage`、`threads`、`turns`、`steps`、`prices`、`optimize`、`timing` 经 `@wombat/client/node` 调用共享内核。
- 无子命令时输出用量文本，与 `usage` 一致；`web` 显式启动交互页面。

- 展示语言使用 `@wombat/client/locale`，详见[产品语言与文案](../docs/i18n/product.md)。

## 限制与验证

CLI 只负责参数、输出、进度与退出码，不计算费用或改变快照语义。JSON 进度写 stderr，结果写 stdout；按[命令入口约定](AGENTS.md)在构建后验证参数错误、部分结果与完整命令路径。

## 整轮耗时

`wombat timing`（或 `timing summary`）要求完整任务和轮次身份，默认输出一个 JSON 对象；`--text` 选择本地化文本，与 `--json` 互斥。`--share` 请求内核独立的分享投影。`timing evidence` 要求相同目标和固定快照，通过不透明游标分页，每页 1..200 条。`--collection` 选择 `turn_events`（默认）、`use_objects` 或 `use_records`；仅 `use_records` 可用 `--object` 筛选对象，游标保持同一快照、目标和集合。使用对象的全轮次数与已关联次数分别呈现，缺少归属证据时不以零补齐；`timing capabilities` 不接受目标或来源路径，不执行扫描。耗时查询不触发自动补价、配置扫描、Hook 采集或账户观察。

摘要退出码依据内核质量：已检查范围完整时返回 0，即使可选值未知；部分或暂定结果返回 2，错误返回 1，取消返回 130。证据页导航和能力查询成功时返回 0，不据此推断整轮完整性。JSON 错误使用 v1 安全模板，不输出来源路径和底层错误详情。独立合成 CLI 测试不代表真实内核或浏览器验收。

## Web 装配

`wombat web` 动态加载本机宿主，注入 Node 客户端并使用打包的 `dist/web/` 资产。启动链接和退出归 CLI 管理；来源范围固定于启动参数。
