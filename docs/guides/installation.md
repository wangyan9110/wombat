# 安装与更新 Wombat

中文 | [English](installation.en.md)

Wombat `v0.1.0` 支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。安装内容已包含运行所需组件，无需开发工具或 API Key。

## 安装并打开

在 macOS 或 Linux 中执行：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
```

在 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
```

终端会输出本机访问地址，并在浏览器中打开。之后可以直接使用 `wombat` 命令。

安装未完成时，重新执行安装命令；再次失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。浏览器未自动打开时，使用终端输出的完整地址。

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
