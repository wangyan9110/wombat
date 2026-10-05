#!/bin/sh
set -eu

repo="wangyan9110/wombat"
version="latest"
prefix="${WOMBAT_INSTALL_PREFIX:-$HOME/.local}"
base_url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version=${2:?missing version}; shift 2 ;;
    --prefix) prefix=${2:?missing prefix}; shift 2 ;;
    --base-url) base_url=${2:?missing base URL}; shift 2 ;;
    -h|--help) echo "Usage: install.sh [--version v0.1.0|latest] [--prefix PATH] [--base-url URL]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "This installer supports macOS and Linux; use install.ps1 on Windows" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
target="$os-$arch"
archive="wombat-$target.tar.gz"
if [ "$version" = latest ]; then
  base="https://github.com/$repo/releases/latest/download"
else
  case "$version" in v*) tag=$version ;; *) tag="v$version" ;; esac
  base="https://github.com/$repo/releases/download/$tag"
fi
[ -z "$base_url" ] || base=${base_url%/}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/wombat-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl -fL --retry 3 --connect-timeout 15 "$base/$archive" -o "$tmp/$archive"
curl -fL --retry 3 --connect-timeout 15 "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected=$(awk -v file="$archive" '$2 == file {print $1}' "$tmp/SHA256SUMS")
[ -n "$expected" ] || { echo "Checksum not found for $archive" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$archive" | awk '{print $1}')
else actual=$(shasum -a 256 "$tmp/$archive" | awk '{print $1}'); fi
[ "$actual" = "$expected" ] || { echo "Checksum mismatch for $archive" >&2; exit 1; }
tar -tzf "$tmp/$archive" | awk 'BEGIN { ok=1 } $0 !~ /^wombat\/?/ || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\// { ok=0 } END { exit ok ? 0 : 1 }' || { echo "Unsafe path in $archive" >&2; exit 1; }
tar -tvzf "$tmp/$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { bad=1 } END { exit bad ? 1 : 0 }' || { echo "Links or special files are not allowed in $archive" >&2; exit 1; }
tar -xzf "$tmp/$archive" -C "$tmp"

payload="$tmp/wombat"
runtime="$payload/runtime/node"
[ -x "$runtime" ] && [ -f "$payload/lib/wombat.js" ] && [ -f "$payload/release.json" ] || { echo "Invalid Wombat archive" >&2; exit 1; }
release_id=$("$runtime" -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.format!==1||r.target!==process.argv[2]||!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(r.version)||!/^[0-9a-f]{40}$/.test(r.source)||!/^[0-9a-f]{64}$/.test(r.sourceSha256))process.exit(2);process.stdout.write(r.version+"-"+r.source.slice(0,12)+"-"+r.sourceSha256.slice(0,12))' "$payload/release.json" "$target")
[ -n "$release_id" ] || { echo "Invalid Wombat release identity" >&2; exit 1; }

install_root="$prefix/lib/wombat"
versions="$install_root/versions"
bin_dir="$prefix/bin"
launcher="$bin_dir/wombat"
marker="$install_root/.managed-by-wombat"
mkdir -p "$prefix/lib" "$bin_dir"
if [ -e "$install_root" ] && [ ! -f "$marker" ]; then echo "Refusing to replace an unmanaged directory: $install_root" >&2; exit 1; fi
if [ -e "$launcher" ] && ! grep -q 'managed GitHub installation' "$launcher" 2>/dev/null; then echo "Refusing to replace an unmanaged command: $launcher" >&2; exit 1; fi
mkdir -p "$versions"
destination="$versions/$release_id"
if [ ! -e "$destination" ]; then mv "$payload" "$destination"; fi
printf '%s\n' 'managed GitHub installation' > "$marker"
printf '%s\n' "$release_id" > "$install_root/.current-$$"
mv -f "$install_root/.current-$$" "$install_root/current.txt"
cat > "$launcher" <<'EOF'
#!/bin/sh
# Wombat managed GitHub installation
set -eu
case "$0" in */*) WOMBAT_SCRIPT_DIR=${0%/*} ;; *) WOMBAT_SCRIPT_DIR=. ;; esac
WOMBAT_ROOT=$(CDPATH= cd -- "$WOMBAT_SCRIPT_DIR/../lib/wombat" && pwd)
IFS= read -r WOMBAT_RELEASE < "$WOMBAT_ROOT/current.txt"
case "$WOMBAT_RELEASE" in *[!0-9A-Za-z._-]*|'') echo "Invalid Wombat installation" >&2; exit 1 ;; esac
exec "$WOMBAT_ROOT/versions/$WOMBAT_RELEASE/runtime/node" "$WOMBAT_ROOT/versions/$WOMBAT_RELEASE/lib/wombat.js" "$@"
EOF
chmod 755 "$launcher"

installed_version=$("$launcher" --version --json | "$destination/runtime/node" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).version))')
echo "Installed Wombat $installed_version for $target"
echo "Command: $launcher"
case ":$PATH:" in *":$bin_dir:"*) ;; *) echo "Add $bin_dir to PATH to run: wombat web --open" ;; esac
