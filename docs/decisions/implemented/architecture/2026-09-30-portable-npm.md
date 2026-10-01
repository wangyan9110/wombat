# 决策记录：跨平台 npm 分发与本地通信

中文 | [English](2026-09-30-portable-npm.en.md)

Status: implemented

## 问题

原候选仅打包本机内核，npm 元数据限定 darwin/arm64；Windows 实时查询直接拒绝。单纯去掉限制会让其他平台安装错误二进制。

## 决定

一个 npm 包携带 macOS arm64/x64、Linux glibc arm64/x64、Windows x64 的内核，客户端按系统与架构选择；没有目标产物时明确拒绝，不调用错误二进制。CI 分别执行发行与安装检查，导出版本、源码提交和 SHA-256 清单；导出和汇总要求产品源码已提交，汇总拒绝缺项、混合提交和损坏产物。包内保留各平台的许可库存。`--current-platform` 仅生成带平台限制的本机试装候选，不冒充通用包。构建不自动发布。

Windows 通过锁定的 interprocess 库提供本地命名管道，拒绝远程客户端并以所有者 DACL 控制访问；使用有截止时间的非阻塞读写。Unix 保留私有 socket。两者复用同一服务锁、同步工作线程、版本缓存、查询和闲置退出逻辑，无 HTTP 监听。

## 考虑过的方案

按平台拆分 npm 可选依赖能减少下载体积，但需要协调多包发布与版本可用性；首轮选择单包以减少发行步骤。仅删除平台元数据无法修复原生二进制和 Windows IPC。回环 TCP 需要额外的认证与端口发现，因此采用系统本地通信。

## 影响与验证

单包体积增大，安装不需要 Rust 或额外的二进制下载脚本。Linux 当前 CI 基于 Ubuntu 24.04/glibc，未声明 Alpine/musl 或 Windows ARM64。Windows 的系统权限与 ConPTY 仍须在 Windows runner 实测；配置存在、交叉类型检查和 macOS 测试不能代替目标平台验收。当前证据见[进度](../../../project/progress.md)，远端安全控制见[安全政策](../../../../SECURITY.zh-CN.md)。
