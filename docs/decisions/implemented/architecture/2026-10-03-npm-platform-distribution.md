# 决策记录：npm 按平台安装预编译内核

中文 | [English](2026-10-03-npm-platform-distribution.en.md)

Status: implemented

当前产品分发已由 [GitHub Release 独立归档决定](2026-10-04-github-release-distribution.md)取代；本记录保留此前已实施方案及仍适用的平台身份与许可校验理由。

## 问题

单包携带五个内核使每台机器重复下载其他平台的二进制；源码的Node26.4工具要求也被当作用户运行要求。用户要求参考Codex CLI，通过npm一键安装，避免编译工具依赖和过大的磁盘占用。当前没有公开发行，不需要旧发行迁移。

## 决定

npm为主渠道。主包携带已打包的CLI依赖、Web静态资产及许可，通过五个精确平台别名安装同一包名的平台预发布版本。包名保持`@wangyan9110/wombat`，例如别名`@wangyan9110/wombat-darwin-arm64`指向`npm:@wangyan9110/wombat@0.3.0-darwin-arm64`。平台包声明os/cpu，Linux仅glibc；没有安装脚本或运行时下载器。该结构参考[Codex官方包定义](https://github.com/openai/codex/blob/main/codex-cli/package.json)及[构建脚本](https://github.com/openai/codex/blob/main/codex-cli/scripts/build_npm_package.py)，实现独立编写。

用户运行Node22+，源码工具保持26.4.0+。客户端通过包解析定位唯一内核，核对版本、目标与提交；缺失依赖明确给出重新包含optional的恢复命令。开发目录保留本机构建定位，但已安装的包不回退其他内核。Windows静态链接CRT并拒绝编译器DLL导入；macOS部署最低11，Linux当前构建基线Ubuntu24.04。系统最低版本仍需真实机器验收。

构建回执绑定源码内容、产物内容及执行权限；复用时仍检查指纹，原生产物导出及汇总核对版本/提交、二进制与许可哈希。发行组包含五个平台版本和一个主版本，平台版本先以非latest标签发布并核验，主版本最后发布。CI安装同一最终组；构建不执行公开上传。

本决定替代[旧npm决策](2026-09-30-portable-npm.md)的单包携带所有内核部分；本地通信决定保持有效。具体入口与平台边界以[分发说明](../../../reference/distribution.md)为准。

## 考虑过的方案

独立安装器内置Node可免去用户运行时准备，但增加下载、磁盘、更新与多平台维护成本；用户明确接受npm安装，因此移除独立bundle入口。旧单包减少发布协调，却让所有用户承担五平台体积；现在用同包名平台版本，保留精确版本约束并减少命名空间维护。

## 影响与验证

安装只下载主包和本机内核，不增加常驻进程，不改计量或存储算法。代价是发行须协调六个版本、用户须具备Node/npm；不保证所有操作系统、musl或Windows ARM64可用。

本机macOS arm64候选已以Node22.0.0/26.4.0运行真实npm安装、空PATH查询及Web端到端；缺项、版本混用、损坏产物和构建过期均有故障检查。五平台CI和Node24兼容流程已配置，尚无本轮托管运行证据或公开发行；系统浏览器打开与旧版OS交互未实测。完整门禁及候选证据见[进度](../../../project/progress.md)。
