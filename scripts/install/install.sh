#!/bin/sh
set -eu

repo="wangyan9110/wombat"
version="latest"
prefix="${WOMBAT_INSTALL_PREFIX:-$HOME/.local}"
base_url=""
modify_path=1
open_app=0
install_plugin_requested=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version=${2:?missing version}; shift 2 ;;
    --prefix) prefix=${2:?missing prefix}; shift 2 ;;
    --base-url) base_url=${2:?missing base URL}; shift 2 ;;
    --no-modify-path) modify_path=0; shift ;;
    --open) open_app=1; shift ;;
    --plugin) install_plugin_requested=1; shift ;;
    -h|--help) echo "Usage: install.sh [--version VERSION|latest] [--prefix PATH] [--base-url URL] [--no-modify-path] [--plugin] [--open]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }
download() {
  curl -fL --http1.1 --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15 "$1" -o "$2"
}
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
download "$base/$archive" "$tmp/$archive"
download "$base/SHA256SUMS" "$tmp/SHA256SUMS"
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
configure_path() {
  case "${PATH:-}" in
    "$bin_dir"|"$bin_dir:"*) path_was_active=1 ;;
    *) path_was_active=0; PATH="$bin_dir${PATH:+:$PATH}"; export PATH ;;
  esac
  if [ "$modify_path" -eq 1 ] && [ "$prefix" = "$HOME/.local" ]; then
    shell_path=${SHELL:-}
    shell_name=${shell_path##*/}
    case "$shell_name" in
      zsh) profile="$HOME/.zshrc"; path_lines='# Wombat PATH
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac' ;;
      bash) profile="$HOME/.bashrc"; path_lines='# Wombat PATH
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac' ;;
      fish) profile="$HOME/.config/fish/config.fish"; path_lines='# Wombat PATH
fish_add_path "$HOME/.local/bin"' ;;
      *) profile="$HOME/.profile"; path_lines='# Wombat PATH
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac' ;;
    esac
    mkdir -p "${profile%/*}"
    if [ ! -f "$profile" ] || ! grep -Fq '# Wombat PATH' "$profile"; then
      printf '\n%s\n' "$path_lines" >> "$profile"
      echo "Added $bin_dir to PATH in $profile."
    fi
  elif [ "$path_was_active" -eq 0 ]; then
    echo "Add $bin_dir to PATH for future commands."
  fi
}
configure_path
install_plugin() {
  [ "$install_plugin_requested" -eq 1 ] || return 0
  "$destination/runtime/node" --input-type=commonjs - "$destination/lib/skill" <<'WOMBAT_PLUGIN_BOOTSTRAP'
// BEGIN generated Wombat plugin bootstrap
/* Bundled dependency notices
cross-spawn@7.0.6
The MIT License (MIT)

Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

isexe@2.0.0
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

path-key@3.1.1
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

shebang-command@2.0.0
MIT License

Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

shebang-regex@3.0.0
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

which@2.0.2
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

*/
"use strict";var De=Object.create;var F=Object.defineProperty;var _e=Object.getOwnPropertyDescriptor;var Ge=Object.getOwnPropertyNames;var Ue=Object.getPrototypeOf,Ke=Object.prototype.hasOwnProperty;var h=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Ve=(e,t)=>{for(var r in t)F(e,r,{get:t[r],enumerable:!0})},K=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of Ge(t))!Ke.call(e,o)&&o!==r&&F(e,o,{get:()=>t[o],enumerable:!(n=_e(t,o))||n.enumerable});return e};var L=(e,t,r)=>(r=e!=null?De(Ue(e)):{},K(t||!e||!e.__esModule?F(r,"default",{value:e,enumerable:!0}):r,e)),Ye=e=>K(F({},"__esModule",{value:!0}),e);var Z=h((It,Q)=>{Q.exports=X;X.sync=Qe;var V=require("fs");function Xe(e,t){var r=t.pathExt!==void 0?t.pathExt:process.env.PATHEXT;if(!r||(r=r.split(";"),r.indexOf("")!==-1))return!0;for(var n=0;n<r.length;n++){var o=r[n].toLowerCase();if(o&&e.substr(-o.length).toLowerCase()===o)return!0}return!1}function Y(e,t,r){return!e.isSymbolicLink()&&!e.isFile()?!1:Xe(t,r)}function X(e,t,r){V.stat(e,function(n,o){r(n,n?!1:Y(o,e,t))})}function Qe(e,t){return Y(V.statSync(e),e,t)}});var oe=h((Nt,ne)=>{ne.exports=te;te.sync=Ze;var ee=require("fs");function te(e,t,r){ee.stat(e,function(n,o){r(n,n?!1:re(o,t))})}function Ze(e,t){return re(ee.statSync(e),t)}function re(e,t){return e.isFile()&&et(e,t)}function et(e,t){var r=e.mode,n=e.uid,o=e.gid,s=t.uid!==void 0?t.uid:process.getuid&&process.getuid(),i=t.gid!==void 0?t.gid:process.getgid&&process.getgid(),p=parseInt("100",8),g=parseInt("010",8),c=parseInt("001",8),u=p|g,f=r&c||r&g&&o===i||r&p&&n===s||r&u&&s===0;return f}});var ie=h((Ft,se)=>{var jt=require("fs"),$;process.platform==="win32"||global.TESTING_WINDOWS?$=Z():$=oe();se.exports=M;M.sync=tt;function M(e,t,r){if(typeof t=="function"&&(r=t,t={}),!r){if(typeof Promise!="function")throw new TypeError("callback not provided");return new Promise(function(n,o){M(e,t||{},function(s,i){s?o(s):n(i)})})}$(e,t||{},function(n,o){n&&(n.code==="EACCES"||t&&t.ignoreErrors)&&(n=null,o=!1),r(n,o)})}function tt(e,t){try{return $.sync(e,t||{})}catch(r){if(t&&t.ignoreErrors||r.code==="EACCES")return!1;throw r}}});var de=h(($t,fe)=>{var O=process.platform==="win32"||process.env.OSTYPE==="cygwin"||process.env.OSTYPE==="msys",ae=require("path"),rt=O?";":":",ce=ie(),le=e=>Object.assign(new Error(`not found: ${e}`),{code:"ENOENT"}),ue=(e,t)=>{let r=t.colon||rt,n=e.match(/\//)||O&&e.match(/\\/)?[""]:[...O?[process.cwd()]:[],...(t.path||process.env.PATH||"").split(r)],o=O?t.pathExt||process.env.PATHEXT||".EXE;.CMD;.BAT;.COM":"",s=O?o.split(r):[""];return O&&e.indexOf(".")!==-1&&s[0]!==""&&s.unshift(""),{pathEnv:n,pathExt:s,pathExtExe:o}},pe=(e,t,r)=>{typeof t=="function"&&(r=t,t={}),t||(t={});let{pathEnv:n,pathExt:o,pathExtExe:s}=ue(e,t),i=[],p=c=>new Promise((u,f)=>{if(c===n.length)return t.all&&i.length?u(i):f(le(e));let m=n[c],w=/^".*"$/.test(m)?m.slice(1,-1):m,y=ae.join(w,e),d=!w&&/^\.[\\\/]/.test(e)?e.slice(0,2)+y:y;u(g(d,c,0))}),g=(c,u,f)=>new Promise((m,w)=>{if(f===o.length)return m(p(u+1));let y=o[f];ce(c+y,{pathExt:s},(d,k)=>{if(!d&&k)if(t.all)i.push(c+y);else return m(c+y);return m(g(c,u,f+1))})});return r?p(0).then(c=>r(null,c),r):p(0)},nt=(e,t)=>{t=t||{};let{pathEnv:r,pathExt:n,pathExtExe:o}=ue(e,t),s=[];for(let i=0;i<r.length;i++){let p=r[i],g=/^".*"$/.test(p)?p.slice(1,-1):p,c=ae.join(g,e),u=!g&&/^\.[\\\/]/.test(e)?e.slice(0,2)+c:c;for(let f=0;f<n.length;f++){let m=u+n[f];try{if(ce.sync(m,{pathExt:o}))if(t.all)s.push(m);else return m}catch{}}}if(t.all&&s.length)return s;if(t.nothrow)return null;throw le(e)};fe.exports=pe;pe.sync=nt});var ge=h((Bt,q)=>{"use strict";var me=(e={})=>{let t=e.env||process.env;return(e.platform||process.platform)!=="win32"?"PATH":Object.keys(t).reverse().find(n=>n.toUpperCase()==="PATH")||"Path"};q.exports=me;q.exports.default=me});var be=h((Lt,ye)=>{"use strict";var he=require("path"),ot=de(),st=ge();function we(e,t){let r=e.options.env||process.env,n=process.cwd(),o=e.options.cwd!=null,s=o&&process.chdir!==void 0&&!process.chdir.disabled;if(s)try{process.chdir(e.options.cwd)}catch{}let i;try{i=ot.sync(e.command,{path:r[st({env:r})],pathExt:t?he.delimiter:void 0})}catch{}finally{s&&process.chdir(n)}return i&&(i=he.resolve(o?e.options.cwd:"",i)),i}function it(e){return we(e)||we(e,!0)}ye.exports=it});var xe=h((Mt,W)=>{"use strict";var R=/([()\][%!^"`<>&|;, *?])/g;function at(e){return e=e.replace(R,"^$1"),e}function ct(e,t){return e=`${e}`,e=e.replace(/(?=(\\+?)?)\1"/g,'$1$1\\"'),e=e.replace(/(?=(\\+?)?)\1$/,"$1$1"),e=`"${e}"`,e=e.replace(R,"^$1"),t&&(e=e.replace(R,"^$1")),e}W.exports.command=at;W.exports.argument=ct});var Se=h((qt,Ee)=>{"use strict";Ee.exports=/^#!(.*)/});var ke=h((Rt,ve)=>{"use strict";var lt=Se();ve.exports=(e="")=>{let t=e.match(lt);if(!t)return null;let[r,n]=t[0].replace(/#! ?/,"").split(" "),o=r.split("/").pop();return o==="env"?n:n?`${o} ${n}`:o}});var Pe=h((Wt,Ce)=>{"use strict";var z=require("fs"),ut=ke();function pt(e){let r=Buffer.alloc(150),n;try{n=z.openSync(e,"r"),z.readSync(n,r,0,150,0),z.closeSync(n)}catch{}return ut(r.toString())}Ce.exports=pt});var Ie=h((zt,Te)=>{"use strict";var ft=require("path"),Oe=be(),Ae=xe(),dt=Pe(),mt=process.platform==="win32",gt=/\.(?:com|exe)$/i,ht=/node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;function wt(e){e.file=Oe(e);let t=e.file&&dt(e.file);return t?(e.args.unshift(e.file),e.command=t,Oe(e)):e.file}function yt(e){if(!mt)return e;let t=wt(e),r=!gt.test(t);if(e.options.forceShell||r){let n=ht.test(t);e.command=ft.normalize(e.command),e.command=Ae.command(e.command),e.args=e.args.map(s=>Ae.argument(s,n));let o=[e.command].concat(e.args).join(" ");e.args=["/d","/s","/c",`"${o}"`],e.command=process.env.comspec||"cmd.exe",e.options.windowsVerbatimArguments=!0}return e}function bt(e,t,r){t&&!Array.isArray(t)&&(r=t,t=null),t=t?t.slice(0):[],r=Object.assign({},r);let n={command:e,args:t,options:r,file:void 0,original:{command:e,args:t}};return r.shell?n:yt(n)}Te.exports=bt});var Fe=h((Jt,je)=>{"use strict";var J=process.platform==="win32";function H(e,t){return Object.assign(new Error(`${t} ${e.command} ENOENT`),{code:"ENOENT",errno:"ENOENT",syscall:`${t} ${e.command}`,path:e.command,spawnargs:e.args})}function xt(e,t){if(!J)return;let r=e.emit;e.emit=function(n,o){if(n==="exit"){let s=Ne(o,t);if(s)return r.call(e,"error",s)}return r.apply(e,arguments)}}function Ne(e,t){return J&&e===1&&!t.file?H(t.original,"spawn"):null}function Et(e,t){return J&&e===1&&!t.file?H(t.original,"spawnSync"):null}je.exports={hookChildProcess:xt,verifyENOENT:Ne,verifyENOENTSync:Et,notFoundError:H}});var Le=h((Ht,A)=>{"use strict";var $e=require("child_process"),D=Ie(),_=Fe();function Be(e,t,r){let n=D(e,t,r),o=$e.spawn(n.command,n.args,n.options);return _.hookChildProcess(o,n),o}function St(e,t,r){let n=D(e,t,r),o=$e.spawnSync(n.command,n.args,n.options);return o.error=o.error||_.verifyENOENTSync(o.status,n),o}A.exports=Be;A.exports.spawn=Be;A.exports.sync=St;A.exports._parse=D;A.exports._enoent=_});var At={};Ve(At,{installBundledPlugin:()=>Je});module.exports=Ye(At);var E=require("node:fs"),v=L(require("node:path"),1),ze=L(require("node:os"),1);var Me=require("node:child_process"),qe=L(Le(),1),I=require("node:fs"),S=require("node:fs");var G=require("node:timers/promises");function Re(e){let t=/\n\[(stdout|stderr)\] /g,r=[...e.matchAll(t)];return r.map((n,o)=>n[1]==="stdout"?e.slice(n.index+n[0].length,r[o+1]?.index??e.length):"").join("")}async function Pt(e){if(!e.pid)return e.exitCode!==null||e.signalCode!==null;let t=new Promise(r=>e.once("close",()=>r()));if(process.platform==="win32"){let r=(0,Me.spawnSync)("taskkill",["/PID",String(e.pid),"/T","/F"],{encoding:"utf8",timeout:5e3,maxBuffer:65536,windowsHide:!0});(r.error||r.status!==0)&&e.kill("SIGKILL")}else{try{process.kill(-e.pid,"SIGTERM")}catch{e.kill("SIGTERM")}await Promise.race([t,(0,G.setTimeout)(1e3)]);try{process.kill(-e.pid,"SIGKILL")}catch{e.exitCode===null&&e.signalCode===null&&e.kill("SIGKILL")}}return await Promise.race([t.then(()=>!0),(0,G.setTimeout)(3e3).then(()=>!1)])}async function We(e){let[t,...r]=e.command;if(!t)throw new Error("Command cannot be empty");let n=(0,S.openSync)(e.logFile,"wx",384);(0,S.writeSync)(n,`start=${new Date().toISOString()}
timeoutMs=${e.timeoutMs}
command=${JSON.stringify(e.command)}
`),(0,S.closeSync)(n);let o=(0,S.createWriteStream)(e.logFile,{flags:"a"}),s=(0,I.statSync)(e.logFile).size,i=!1,p=!1,g=!1,c=!1,u,f,m,w,y=new Promise(l=>{w=l}),d=(0,qe.default)(t,r,{cwd:e.cwd,env:e.env,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"],windowsHide:!0}),k=new Promise(l=>d.once("close",P=>l({exitCode:P}))),C=l=>{l==="timeout"&&(i=!0),l==="output"&&(p=!0),l==="signal"&&(g=!0),m??=Pt(d),m.then(w)},a=()=>C("signal");e.signal?.addEventListener("abort",a,{once:!0}),e.signal?.aborted&&a();let B=setTimeout(()=>C("timeout"),e.timeoutMs),T=(l,P)=>{if(p||f)return;let N=Buffer.from(`
[${l}] `),j=e.maxBytes-s;if(j<=N.length||P.byteLength>j-N.length){let He=Buffer.from(`
[output budget exceeded; process terminated]
`);j>0&&o.write(He.subarray(0,j)),s=e.maxBytes,C("output");return}s+=N.length+P.byteLength,o.write(N),o.write(P)};d.stdout?.on("data",l=>T("stdout",l)),d.stderr?.on("data",l=>T("stderr",l)),d.once("error",l=>{u=l}),o.once("error",l=>{f=l,C("output")});let x,U=!1;try{x=await Promise.race([k,y.then(P=>{U=!P})])}finally{clearTimeout(B),e.signal?.removeEventListener("abort",a),m&&(c=!await m),(U||c)&&(d.stdout?.destroy(),d.stderr?.destroy()),await new Promise(l=>{o.closed?l():(o.once("finish",()=>l()),o.once("close",()=>l()),o.end())})}return{exitCode:x?.exitCode??d.exitCode,timedOut:i,outputLimit:p,interrupted:g,closeTimedOut:c,...f?{logError:f.message}:{},...u?{spawnError:u}:{}}}var b=e=>!!e&&typeof e=="object"&&!Array.isArray(e);function Ot(e){let t=v.default.join(e,".agents/plugins/marketplace.json"),r=(0,E.lstatSync)(t);if(!r.isFile()||r.isSymbolicLink()||r.size>65536)throw new Error("Invalid bundled plugin marketplace.");let n=JSON.parse((0,E.readFileSync)(t,"utf8"));if(!b(n)||n.name!=="wombat-local"||!Array.isArray(n.plugins))throw new Error("Invalid bundled plugin marketplace.");let o=n.plugins;if(!["wombat","wombat-collection"].every(s=>o.some(i=>b(i)&&i.name===s&&b(i.source)&&i.source.source==="local"&&i.source.path===(s==="wombat"?"./plugin":"./collection-plugin"))))throw new Error("Invalid bundled plugin marketplace.")}async function Je(e,t={}){let r=v.default.resolve(e);Ot(r);let n=t.env??process.env,o=t.binary??n.WOMBAT_CODEX_BIN??"codex",s=/\.[cm]?js$/.test(o)?[process.execPath,o]:[o],i=(0,E.mkdtempSync)(v.default.join(ze.default.tmpdir(),"wombat-plugin-install-")),p=new AbortController,g=()=>p.abort(),c=t.signal?AbortSignal.any([t.signal,p.signal]):p.signal;process.once("SIGINT",g),process.once("SIGTERM",g);try{let u=async(a,B)=>{let T=v.default.join(i,a+".log"),x=await We({command:[...s,...B],cwd:process.cwd(),env:n,logFile:T,timeoutMs:t.timeoutMs??2e4,maxBytes:1024*1024,signal:c});if(x.exitCode!==0||x.timedOut||x.outputLimit||x.interrupted||x.closeTimedOut||x.spawnError||x.logError)throw new Error(`Codex plugin ${a} failed. Wombat is installed; install or check Codex, then rerun the installer with the plugin option.`);return Re((0,E.readFileSync)(T,"utf8"))},f=JSON.parse(await u("list",["plugin","list","--marketplace","wombat-local","--json"]));if(!b(f)||!Array.isArray(f.installed))throw new Error("Unrecognized Codex plugin list. Wombat is installed.");let m=f.installed.filter(a=>b(a)&&a.enabled===!0&&typeof a.pluginId=="string"&&["wombat@wombat-local","wombat-collection@wombat-local"].includes(a.pluginId));if(m.length>1)throw new Error("Multiple Wombat plugins are enabled. Choose one in Codex, then rerun the installer.");let w=m.some(a=>b(a)&&a.pluginId==="wombat-collection@wombat-local")?"wombat-collection":"wombat",y=JSON.parse(await u("catalogs",["plugin","marketplace","list","--json"]));if(!b(y)||!Array.isArray(y.marketplaces))throw new Error("Unrecognized Codex marketplace list. Wombat is installed.");let d=y.marketplaces.find(a=>b(a)&&a.name==="wombat-local"),k;if(d!==void 0){if(!b(d)||!b(d.marketplaceSource)||d.marketplaceSource.sourceType!=="local"||typeof d.marketplaceSource.source!="string")throw new Error("Existing wombat-local marketplace is not local. Choose its source in Codex before retrying.");v.default.resolve(d.marketplaceSource.source)!==r&&(k=d.marketplaceSource.source,await u("unregister",["plugin","marketplace","remove","wombat-local"]))}let C=!1;try{await u("marketplace",["plugin","marketplace","add",r]),C=!0;let a=JSON.parse(await u("install",["plugin","add",w+"@wombat-local","--json"]));if(!b(a)||a.pluginId!==w+"@wombat-local"||typeof a.installedPath!="string"||!v.default.isAbsolute(a.installedPath))throw new Error("Unrecognized Codex plugin installation result. Check the plugin in Codex.")}catch(a){if(k&&!c.aborted)try{C&&await u("restore-remove",["plugin","marketplace","remove","wombat-local"]),await u("restore",["plugin","marketplace","add",k])}catch{throw new Error("Plugin installation and marketplace recovery failed. Wombat is installed; restore wombat-local in Codex and rerun the installer.")}throw a}return w}finally{process.off("SIGINT",g),process.off("SIGTERM",g),(0,E.rmSync)(i,{recursive:!0,force:!0})}}if(process.argv[1]==="-"||v.default.basename(process.argv[1]??"")==="install-plugin-bootstrap.ts"){let e=process.argv[2];!e||process.argv.length!==3?(console.error("A bundled plugin marketplace path is required."),process.exitCode=2):Je(e).then(t=>console.log(`Installed ${t} through Codex. Start a new Codex conversation to use the plugin.`),t=>{console.error(t instanceof Error?t.message:"Plugin installation failed. Wombat is installed."),process.exitCode=1})}0&&(module.exports={installBundledPlugin});
// END generated Wombat plugin bootstrap
WOMBAT_PLUGIN_BOOTSTRAP
}
install_plugin
start_app() {
  [ "$open_app" -eq 1 ] || return 0
  rm -rf "$tmp"
  echo "Starting Wombat..."
  "$launcher" web --open
}
start_app
