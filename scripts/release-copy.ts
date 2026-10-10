export type ReleaseStage = 'development-preview' | 'beta' | 'release-candidate' | 'stable';

export function releaseStage(version: string): ReleaseStage {
  if (version.includes('-dev.')) return 'development-preview';
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-rc.')) return 'release-candidate';
  return 'stable';
}

function replaceSection(content: string, start: RegExp, endHeading: RegExp, replacement: string, file: string): string {
  const match = start.exec(content);
  if (!match || match.index === undefined) throw new Error(`${file}: cannot locate release copy section`);
  const afterHeading = match.index + match[0].length;
  const remaining = content.slice(afterHeading);
  const boundary = endHeading.exec(remaining);
  if (!boundary) throw new Error(`${file}: cannot locate release copy section end`);
  const end = afterHeading + boundary.index;
  return content.slice(0, match.index) + replacement.trimEnd() + '\n\n' + content.slice(end);
}

function releaseReadme(content: string, version: string, chinese: boolean, file: string): string {
  const stage = releaseStage(version);
  const labels: Record<ReleaseStage, [string, string]> = {
    'development-preview': ['Development Preview:', '开发者预览版：'],
    beta: ['Beta:', 'Beta 测试版：'],
    'release-candidate': ['Release Candidate:', 'RC 候选版：'],
    stable: ['Stable:', '正式版：'],
  };
  const label = labels[stage][chinese ? 1 : 0];
  const preview = version.includes('-');
  const status = chinese
    ? `**${label}[\`v${version}\`](https://github.com/YannByte/wombat/releases/tag/v${version})。**`
    : `**${label} [\`v${version}\`](https://github.com/YannByte/wombat/releases/tag/v${version}).**`;
  const statusPattern = /\*\*(?:Beta:|Development Preview:|Release Candidate:|Stable:|Beta 测试版：|开发者预览版：|RC 候选版：|正式版：)[^\n]+/;
  if (!statusPattern.test(content)) throw new Error(`${file}: cannot locate release status`);
  let next = content.replace(statusPattern, status);
  next = next
    .replace(/^([ \t]*)curl -fsSL https:\/\/raw\.githubusercontent\.com\/YannByte\/wombat\/main\/(?:scripts\/install\/)?install\.sh.*$/m,
      (_match, indent: string) => `${indent}curl -fsSL https://raw.githubusercontent.com/YannByte/wombat/main/scripts/install/install.sh | sh -s --${preview ? ` --version ${version}` : ''} --plugin`)
    .replace(/^([ \t]*)& \(\[scriptblock\]::Create\(\(irm https:\/\/raw\.githubusercontent\.com\/YannByte\/wombat\/main\/(?:scripts\/install\/)?install\.ps1\)\)\).*$/m,
      (_match, indent: string) => `${indent}& ([scriptblock]::Create((irm https://raw.githubusercontent.com/YannByte/wombat/main/scripts/install/install.ps1)))${preview ? ` -Version ${version}` : ''} -Plugin`);
  const commands = preview ? `wombat update --check --version ${version}\nwombat update --version ${version}` : 'wombat update --check\nwombat update';
  const update = chinese
    ? `## 更新\n\n重新执行上面的安装命令，可以更新 Wombat 与 Codex 插件。检查更新，或只更新 Wombat 运行时：\n\n\`\`\`sh\n${commands}\n\`\`\`\n\n指定版本和自定义安装目录见[安装指南](docs/guides/installation.md)。`
    : `## Update\n\nRerun the installation command above to update Wombat and its Codex plugin. Check for updates, or update only the Wombat runtime:\n\n\`\`\`sh\n${commands}\n\`\`\`\n\nSee the [installation guide](docs/guides/installation.en.md) for specific versions and custom installation directories.`;
  return replaceSection(next, chinese ? /^#{2,3} (?:更新|更新预发行版本|更新 Wombat)$/m : /^#{2,3} (?:Update|Update a pre-release|Update Wombat)$/m,
    /^## /m, update, file);
}

export function applyReleaseCopy(file: string, content: string, version: string): string {
  if (file === 'README.md') return releaseReadme(content, version, false, file);
  if (file === 'README.zh-CN.md') return releaseReadme(content, version, true, file);
  return content;
}
