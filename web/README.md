# 本机 Web 宿主

中文 | [English](README.en.md)

`@wombat/web` 导出 `startWebHost({ client, assets, roots?, projectRoots?, port?, locale? })`，返回浏览器 URL、origin 和异步 `close()`。CLI 注入 Node 客户端；宿主不拥有计价、查询或来源解析规则。

## 访问边界

仅监听 `127.0.0.1`；端口默认自动分配。每次启动令牌、精确 Host/Origin 和 JSON POST 保护六个窄 API。来源范围由启动参数确定；只有已返回的快照身份可继续查询。资源限制与生命周期见[架构](../docs/development/architecture.md)，使用方式见[CLI 指南](../docs/guides/cli.md)。

静态目录必须是可信构建产物。浏览器不能访问任意本地路径，宿主不支持局域网或远程部署。关闭标签不结束 CLI；退出服务取消自身请求，不杀死共享内核服务。

## 验证

客户端构建后运行 `corepack pnpm --filter @wombat/web test`。测试仅使用临时合成目录和本机监听，覆盖认证、范围、进度、取消、并发与静态资源。真实内核链路在完整构建后的 `tests/e2e/web.test.ts` 验证，安装检查复用同一黑盒用例。

Web后台补价由宿主单一任务持有，基础用量先返回；必须注入 `createNodeClient({automaticPrices:false})` 以避免客户端原有阻塞补价。宿主 `automaticPrices:false` 关闭自动联网，`close()`取消并有界等待本宿主价表任务；Rust仍拥有资格/限流/版本。`restartCommand?`仅作为已认证来源页的复制材料；启动根固定，浏览器没有执行或更换授权接口。
