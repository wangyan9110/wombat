# Install and update Wombat

[中文](installation.md) | English

Wombat `v0.2.0` supports macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Installation includes everything needed to run Wombat. No development tools or API key are required.

## Install the runtime and plugin

On macOS or Linux, run:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin --open
```

On Windows PowerShell, run:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin -Open
```

Install a compatible local Codex first. The installer installs Wombat, registers its local marketplace and installs the plugin through Codex, then opens Web. Invoke `$wombat:wombat` in a new Codex project conversation. An existing enabled collection plugin keeps that mode and uses `$wombat-collection:wombat`. Installation does not change collection mode or Hook trust. The `wombat` command is available for later use.

If plugin installation fails, Wombat remains installed and Web does not start automatically. Check Codex and rerun the same installation command. To view data first, run `wombat web --open`. Omit `--plugin` or `-Plugin` to install only the runtime and Web. If installation still fails, [report the problem](https://github.com/wangyan9110/wombat/issues). If the browser does not open, use the full URL printed in the terminal.

## Update

Check for an update without installing it:

```sh
wombat update --check
```

Install the latest stable release:

```sh
wombat update
```

## Install a specific version

Pre-release versions require an explicit version. On macOS or Linux, add `--version VERSION`; on Windows, add `-Version VERSION`. Pre-releases do not replace the latest stable release.

To use a different installation directory, add `--prefix PATH` on macOS or Linux, or `-Prefix PATH` on Windows.
