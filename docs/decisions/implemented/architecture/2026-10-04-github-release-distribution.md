# 决策记录：GitHub Release 独立归档与原子升级

中文 | [English](2026-10-04-github-release-distribution.en.md)

Status: implemented

## 问题

Wombat 的目标用户需要一键安装和程序内升级，不应先安装 Node/npm。此前的 npm 平台包方案仍把 Node 22+ 作为用户前置条件，并需要协调一个主版本和五个平台预发布版本。项目尚未公开发行，不需要兼容既有 npm 用户。

## 决定

GitHub Releases 成为唯一产品分发渠道。每个版本生成 macOS arm64/x64、Linux glibc arm64/x64、Windows x64 五份独立归档；每份只携带本机 Rust 内核、打包后的 CLI/Web、固定 Node.js 26.4.0 运行时和完整许可材料。`release-set.json` 与 `SHA256SUMS` 绑定版本、源码提交、目标、大小和哈希。`install.sh` 与 `install.ps1` 识别平台、校验归档并写入受管安装目录。

安装采用 `versions/<version>-<source>/` 和 `current.txt`。`wombat update` 从固定 GitHub 仓库读取 Release 元数据，限制下载大小，交叉核对 release-set 与 SHA256SUMS，拒绝绝对路径、上级路径和链接归档，再把新版本放入并列目录并切换指针。运行中的旧版本不会被覆盖，Windows 无需替换已占用的 `node.exe`。源码副本和手工解压副本没有受管指针，升级器明确拒绝。

标签工作流参考 [Mole 的 GitHub Release 矩阵、校验和与来源证明流程](https://github.com/tw93/Mole/blob/main/.github/workflows/release.yml)，但按 Wombat 的 Rust+Node 架构独立实现。五个平台先导出内核、Node 运行时和许可哈希，汇总后再由五个平台验证最终归档。与 `package.json` 不匹配的标签拒绝发布，普通 CI 和候选构建不上传。

本决定取代 [npm 平台分发决定](2026-10-03-npm-platform-distribution.md)的当前渠道、安装和升级部分；其中平台范围、原生产物身份与许可校验原则继续适用。

## 考虑过的方案

继续 npm 平台包可以减少单份归档体积，但要求用户准备 Node/npm，并协调六个版本。只提供安装脚本、不提供程序升级会让重复安装成为唯一更新方式，无法在 Windows 占用文件时安全替换。单目录覆盖安装更简单，但升级中断会破坏当前版本，也无法可靠回退到上一目录。

## 影响与验证

用户下载包变大，因为每个平台归档内置约 145 MB 的未压缩 Node 运行时；macOS arm64 开发候选压缩后约 48.5 MiB。换来的结果是用户无需 Node/npm，运行环境与验证环境一致。版本目录会短期保留当前和上一运行版本，占用更多磁盘；之后的升级清理更早受管目录。

macOS arm64 开发候选已完成构建、归档哈希、干净解压、实时/追加/固定快照/Web 验证、一键安装，以及应用 PATH 为空时的版本和实时查询。升级的检查、下载、归档约束、哈希与原子切换使用本地模拟 Release 通过。其他四个平台已配置 CI 和标签发布矩阵，尚无本轮托管运行证据；公开 Release、公开安装地址、跨真实版本远端升级和旧系统兼容仍未验收。
