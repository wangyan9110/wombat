# Install and update Wombat

[中文](installation.md) | English

Wombat `v0.2.0` supports macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Installation includes everything needed to run Wombat. No development tools or API key are required.

## Install and open

On macOS or Linux, run:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
```

On Windows PowerShell, run:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
```

The terminal prints a local URL and opens it in your browser. The `wombat` command is available for later use.

If installation does not complete, run the command again. If it still fails, [report the problem](https://github.com/wangyan9110/wombat/issues). If the browser does not open, use the full URL printed in the terminal.

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
