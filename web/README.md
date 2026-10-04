# 本机 Web 宿主

中文 | [English](README.en.md)

`@wombat/web` 导出 `startWebHost(options)`，返回浏览器 URL、origin 和异步 `close()`。CLI 注入 Node 客户端；宿主不拥有计价、查询或来源解析规则。

## 访问与资源限制

宿主仅监听 127.0.0.1，默认自动分配端口。来源范围由启动参数与宿主管理的目录授权确定；HTTP 调用者不能传入任意根或快照路径。宿主最多保留 128 个已返回快照身份，内核版本保留期独立；版本过期明确失败，需重新查询当前版本。

启动生成随机令牌，放在 URL fragment 中，由浏览器移入 sessionStorage 并清除地址栏 fragment。API 使用 Bearer 令牌、精确 Origin/Host、JSON POST，不开放 CORS。根页面不含业务数据；CSP 禁止远程脚本与嵌入。令牌只用于本机服务访问，不是来源 API Key；重启服务须打开新链接。

HTTP只开放生成的查询、同步、价表、配置、优化、授权、偏好、Codex交接和账户操作。请求和响应均验证。HTTP 使用 NDJSON 的 progress/result/error 信封，业务 DTO 不另行定义。输入上限64 KiB，响应16 MiB，最多8个同时请求，120秒超时；断线中止对应调用，CLI 收到退出信号时关闭监听并取消自身请求。共享内核服务由原有空闲机制退出，不因一个 Web 客户端离开而杀死其他入口的服务。关闭浏览器标签不会退出 CLI。

静态文件仅来自构建资产目录，启动时读取允许的文件类型，不提供目录浏览或源码访问。Node 与浏览器均保持有界输出，但这些上限不代表已验证百万级数据的内存目标。服务不支持局域网、远程或托管部署；没有通用文件写入、任意 shell 或内核 dispatch。

## 后台补价

Web后台补价由宿主单一任务持有，基础用量先返回；必须注入 `createNodeClient({automaticPrices:false})` 以避免客户端原有阻塞补价。宿主 `automaticPrices:false` 关闭自动联网，`close()`取消并有界等待本宿主价表任务；Rust仍拥有资格/限流/版本。`restartCommand?`仅作为已认证来源页的复制材料；浏览器不能执行该命令或传入任意根路径。

## 验证

客户端构建后运行 `corepack pnpm --filter @wombat/web test`。测试仅使用临时合成目录和本机监听，覆盖认证、范围、进度、取消、并发与静态资源。真实内核链路在完整构建后的 `tests/e2e/web.test.ts` 验证，安装检查复用同一黑盒用例。
