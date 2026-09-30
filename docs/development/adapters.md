# 来源与计价验收样本

中文 | [English](adapters.en.md)

Wombat 的独立合成样本使用协议字段与手算期望，不安装或运行 ccusage，不包含真实对话和工具输出。来源实现版本为 `codex-rollout-1`。测试代码见 [Codex 样本](../../core/src/adapters/codex/tests.rs)、[异构协议样本](../../core/src/adapters/mod.rs)、[计价样本](../../core/src/pricing/tests.rs)和[完整查询链路](../../tests/integration/usage-v1.test.ts)。

| 案例 | 已覆盖行为与测试定位 |
|---|---|
| A01 身份与去重 | `response_identity_not_equal_counts_deduplicates_copies`：相同 Token 的独立响应保留，明确同响应的归档副本合并出处；`source_namespaces_and_archive_activity_ignore_filename_date`：跨来源同 ID 隔离。 |
| A02 累计状态机 | `legacy_refresh_delta_reset_and_bad_boundary_do_not_reuse_context`、`stale_last_usage_cannot_replace_cumulative_delta_and_gap_cannot_rebill_history`：重复累计不新增账，增量优先于陈旧 last；回退只采用明确单次用量，格式断点不重填整个历史累计。 |
| A03 继承重放 | `exact_fork_replay_is_excluded_but_independent_same_counts_stay`：明确 fork 关系加完全相同原事件才移除继承；`owner_id_on_inherited_modern_response_preserves_parent_ownership`：现代记录按明确 owner 归属，不挪到子对话。 |
| A04 双格式与压缩 | `modern_ledger_excludes_matching_legacy_telemetry_and_compaction_copy`：现代响应主账本、累计覆盖区间去重、压缩副本去重；`modern_without_totals_is_primary_in_same_turn_but_preserves_older_turn` 和 `partial_overlap_keeps_direct_and_exposes_unresolved_legacy_coverage` 验证无法确认覆盖时返回 partial。 |
| A04a 历史模型上下文 | `applied_thread_settings_supply_model_and_effort_until_turn_context`：读取 `thread_settings_applied.thread_settings` 的模型、供应商及强度，之后的轮次上下文可覆盖；无历史上下文时不借当前配置补造。 |
| A05 Token 分类 | `unknown_conflicting_and_zero_fields_remain_distinct`、`legacy_cache_write_zero_is_protocol_specific_and_modern_missing_is_unknown`：未知和零分开；现代缓存类别缺失不冒充非缓存输入；旧 token_count 没有 cache-write 类别时按该协议归零。计价 `reasoning_is_a_subset_and_never_charged_twice` 验证推理不重复收费。 |
| A06 时间范围 | 来源样本验证归档和文件路径日期不决定计量日期；集成“日期按真实时区跨夏令时和年份分组”验证查询自然日；“对话搜索汇总对应命中集合，周/月边界只计所选日期”验证范围裁剪。 |
| A07 历史设置 | `historical_context_conflict_and_explicit_effort_changes_are_visible`、`turn_context_does_not_leak_across_new_turn_without_history_settings`：冲突字段未知，轮次上下文不补另一轮历史，坏行结束继承，不读取当前 config。 |
| A08 模型匹配 | 计价 `official_snapshot_aliases_are_explicit_no_fuzzy_model_matching`、`explicit_other_provider_does_not_borrow_openai_price`：仅已核对的原名和别名匹配，供应商隔离，未知模型不猜价。 |
| A09 计费条件 | 计价 `long_context_boundary_is_strict_and_applies_to_entire_request`、`daily_total_is_sum_of_request_prices_not_daily_tier`、`unscoped_cumulative_difference_does_not_invent_long_context_tier`、`cache_write_without_official_rate_remains_unpriced`：按请求条件，日汇总不触发请求档位，未核对缓存类别保持未知。 |
| A10 费用政策 | 计价 `legacy_amount_never_becomes_official_or_mixes_policies`、`persisted_price_replays_without_catalog_recalculation`：旧金额和标准 API 折算不混加，旧快照不随价表重算；精度样本验证十进制与科学计数法。 |
| A11 读取与隐私 | `large_line_is_fully_skipped_without_losing_next_event_and_tail_is_reported`：完整大行不截断，未完成尾行公开；`source_failure_isolated_and_cancellation_reported`、`explicit_missing_root_has_failure_receipt_and_resource_caps_are_public`：失败隔离、取消与上限回执；工具样本验证正文、参数和结果正文不进入快照。 |
| A12 关联与守恒 | `tools_merge_by_call_identity_and_never_store_arguments_or_outputs`：call/item 身份合并，MCP 和明确 Skill 文件读取保留安全元数据；集成“用量 → 跨日对话 → 轮次 → 操作”验证同一计量并集的 Token / 金额与占比。 |

另有 `existing_identity_registry_migrates_without_writing_or_reusing_replaced_prefix`：只读旧 `identity-v1.json`；来源沿用已登记实例身份，文件前缀哈希仍匹配时沿用已建立的对话身份。改写前缀不错误复用旧文件世代。异构适配器仅用于测试，验证仅有日用量、无对话/轮次、未知供应商的来源无需制造空壳对话。

## 当前支持边界

- 首版解析 rollout 的 `session_meta`、`turn_context`、历史 `thread_settings_applied`、现代 `token_usage_record`、旧 `token_count`、轮次生命周期、工具调用/返回、受支持的 `item_started/item_completed` 和压缩计量副本。不是对所有 Codex 历史版本及任意新事件的兼容承诺。
- 同轮现代记录缺累计覆盖信息时，选择逐响应账本，并报告旧累计覆盖无法核对；累计区间与直接记录仅部分重叠时，不叠加有重叠的整条旧累计，来源标为 partial。未覆盖部分的真实费用不能从这类记录可靠还原。
- 旧 fork 只有明确关系和完全相同事件才能判定重放；没有身份依据的相似内容不能用 Token 或时间近似去重。工具记录没有独占计量时不分摊费用。
- 只保存事件类型、工具名、明确路径、MCP server/tool、退出码、耗时、状态、身份与出处；不回放对话正文，不解析任意 shell 文本来推断 Skill。只有明确文件参数指向 `SKILL.md` 才标记为技能文件读取。
- 大日志行通过复用缓冲区和临时映射完整读取，消息/输出正文由选择性反序列化跳过；计量、对话及操作元数据仍会在来源整理期间驻留内存。目录深度、文件数量、读取字节及标题索引上限会有回执，不能将其宣传为无界或常量内存扫描。
- 原生标题来自同来源 `session_index.jsonl`。标题缺失保持缺失，不用用户提问生成标题；多次设置、失败和缺失字段按来源证据处理。

运行方式：`cargo test --locked --manifest-path core/Cargo.toml adapters`、`cargo test --locked --manifest-path core/Cargo.toml pricing`；完整 CLI 链路先执行 `corepack pnpm build`，再运行相应集成测试。验证结果和未完成的验收条件记录在[进度记录](../project/progress.md)，本页不以测试名称代替测试通过证据。
