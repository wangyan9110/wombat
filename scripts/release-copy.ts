export type ReleaseStage = 'development-preview' | 'beta' | 'release-candidate' | 'stable';

export function releaseStage(version: string): ReleaseStage {
  if (version.includes('-dev.')) return 'development-preview';
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-rc.')) return 'release-candidate';
  return 'stable';
}

function replaceSection(content: string, start: RegExp, endHeading: string, replacement: string, file: string): string {
  const match = start.exec(content);
  if (!match || match.index === undefined) throw new Error(`${file}: cannot locate release copy section`);
  const end = content.indexOf(endHeading, match.index);
  if (end < 0) throw new Error(`${file}: cannot locate release copy section end`);
  return content.slice(0, match.index) + replacement.trimEnd() + '\n\n' + content.slice(end);
}

function stableReadme(content: string, version: string, chinese: boolean, file: string): string {
  const status = chinese
    ? `**正式版：[\`v${version}\`](https://github.com/wangyan9110/wombat/releases/tag/v${version})。**`
    : `**Stable: [\`v${version}\`](https://github.com/wangyan9110/wombat/releases/tag/v${version}).**`;
  let next = content.replace(/\*\*(?:Beta:|Development Preview:|Release Candidate:|Stable:|Beta 测试版：|开发者预览版：|RC 候选版：|正式版：)[^\n]+/, status);
  next = next
    .replace(/^\s*curl -fsSL https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/main\/install\.sh.*$/m,
      '   curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open')
    .replace(/^\s*& \(\[scriptblock\]::Create\(\(irm https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/main\/install\.ps1\)\)\).*$/m,
      '   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open');
  const update = chinese
    ? `### 更新 Wombat\n\n检查或安装最新稳定版：\n\n\`\`\`sh\nwombat update --check\nwombat update\n\`\`\``
    : `### Update Wombat\n\nCheck for or install the latest stable release:\n\n\`\`\`sh\nwombat update --check\nwombat update\n\`\`\``;
  return replaceSection(next, chinese ? /^### (?:更新预发行版本|更新 Wombat)$/m : /^### (?:Update a pre-release|Update Wombat)$/m,
    '## ', update, file);
}

export function applyReleaseCopy(file: string, content: string, version: string): string {
  if (releaseStage(version) !== 'stable') return content;
  if (file === 'README.md') return stableReadme(content, version, false, file);
  if (file === 'README.zh-CN.md') return stableReadme(content, version, true, file);
  return content;
}
