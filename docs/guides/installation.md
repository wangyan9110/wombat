# 安装与更新 Wombat

中文 | [English](installation.en.md)

Wombat `v0.2.0` 支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。安装内容已包含运行所需组件，无需开发工具或 API Key。

## 安装运行时与插件

在 macOS 或 Linux 中执行：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin --open
```

在 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin -Open
```

使用插件前需先安装兼容的本机 Codex。安装器先安装 Wombat，再通过 Codex 注册本地 marketplace 并安装插件，最后打开 Web。在新的 Codex 项目对话中调用 `$wombat:wombat`；已有已启用的采集插件时，安装器保留该模式，调用 `$wombat-collection:wombat`。安装不改变采集模式或 Hooks 信任。之后可以直接使用 `wombat` 命令。

插件安装失败时，已安装的 Wombat 会保留，Web 不会自动启动。检查 Codex 后重新执行同一安装命令；需要先查看数据时，执行 `wombat web --open`。仅安装运行时与 Web，可省略 `--plugin` 或 `-Plugin`。再次失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。浏览器未自动打开时，使用终端输出的完整地址。

## 更新

只检查是否有更新：

```sh
wombat update --check
```

安装最新稳定版：

```sh
wombat update
```

## 安装指定版本

安装预发行版本时必须指定版本。macOS 或 Linux 使用 `--version VERSION`，Windows 使用 `-Version VERSION`。预发行版本不会替代最新稳定版。

如需修改安装目录，macOS 或 Linux 使用 `--prefix PATH`，Windows 使用 `-Prefix PATH`。
