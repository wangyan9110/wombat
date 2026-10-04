# 配置执行

以下命令的 `wombat` 替换为 Skill 的绝对 runtime 命令，所有调用保持相同 `--project-root` / `--root` 范围。以当前 `optimize execution --help`、候选资格和返回状态为准，不把尚未支持的停用、清理或副本方向当可执行能力。

先查询候选：

```sh
wombat optimize execution candidates --project-root /absolute/project --json
```

用户要求生成优化方案且已选定目标时，通过受限执行入口生成，不能自行启动无约束的 shell 修复：

```sh
wombat optimize execution begin --suggestion ID --key UNIQUE_KEY --project-root /absolute/project --json
wombat optimize execution status --execution EXECUTION_ID --project-root /absolute/project --json
```

生成会启动另一个 Codex 作业并产生独立用量；只发送选中配置内容。保存返回的execution ID，同一请求重试保留幂等key。按返回状态检查进度；不要重复begin充当轮询。取消使用 `cancel --execution ID`；重新生成用 `regenerate --execution ID --key NEW_KEY`，旧方案的批准不能沿用。

在应用前展示已生成方案的具体文件、差异和恢复边界，确认批准绑定当前 `planRevision` 与选中文件。泛泛的“检查/优化一下”不足以批准尚未看过的方案；已有明确的版本/文件批准则继续执行，不重复询问。

```sh
wombat optimize execution apply --execution EXECUTION_ID --plan PLAN_REVISION --file FILE_ID --project-root /absolute/project --json
wombat optimize execution history --project-root /absolute/project --limit 20 --json
```

`--file` 可重复。逐文件读取回执、冲突和复查结果，单文件原子替换不代表整批事务。冲突后重读现状并重新审阅，不能强行覆盖。格式复查通过不代表运行效果或Token节省。

用户明确要求撤销已应用文件时，通过恢复入口：

```sh
wombat optimize execution restore --execution EXECUTION_ID --file FILE_ID --project-root /absolute/project --json
```

恢复可能因当前文件已变更而冲突，保留用户的新编辑并报告回执。`optimize restore --suggestion …` 只恢复被忽略的建议，不恢复文件。忽略/标记编辑/复查属于处理记录操作；只有用户要求时使用，继续携带最新 `readView` / `decisionRevision`。
