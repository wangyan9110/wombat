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
    ? `**正式版：[\`v${version}\`](https://github.com/wangyan9110/wombat/releases/tag/v${version})。** 这是 Wombat 的首个稳定版本，面向本机 Codex 用量、配置检查和建议处理流程。`
    : `**Stable: [\`v${version}\`](https://github.com/wangyan9110/wombat/releases/tag/v${version}).** This is the first stable Wombat release for local Codex usage review, configuration checks, and recommendation workflows.`;
  let next = content.replace(/\*\*(?:Beta:|Development Preview:|Release Candidate:|Stable:|Beta 测试版：|开发者预览版：|RC 候选版：|正式版：)[^\n]+/, status);
  next = next
    .replace(/ \| sh -s -- --version [^\s\n]+/, ' | sh')
    .replace(/\)\)\) -Version [^\s\n]+/, ')))');
  const update = chinese
    ? `### 更新 Wombat\n\n检查或安装最新稳定版：\n\n\`\`\`sh\nwombat update --check\nwombat update\n\`\`\``
    : `### Update Wombat\n\nCheck for or install the latest stable release:\n\n\`\`\`sh\nwombat update --check\nwombat update\n\`\`\``;
  return replaceSection(next, chinese ? /^### (?:更新预发行版本|更新 Wombat)$/m : /^### (?:Update a pre-release|Update Wombat)$/m,
    chinese ? '安装选项、升级行为' : 'See the [distribution guide]', update, file);
}

function stableDistribution(content: string, version: string, chinese: boolean): string {
  let next = content.replace(
    chinese ? /^Wombat 以 GitHub Releases[^\n]+$/m : /^Wombat uses GitHub Releases[^\n]+$/m,
    chinese
      ? `Wombat 以 GitHub Releases 为唯一产品分发渠道，不发布 npm 包。根工作区的 npm 包保持 \`private: true\`，只用于源码开发。\`v${version}\` 是首个稳定版本。源码工具要求 Node.js 26.4.0 或更新版本，用户安装包已内置固定的 Node.js 26.4.0、CLI/Web 和本机 Rust 内核，无需另装 Node、npm、Rust、pnpm 或编译器。`
      : `Wombat uses GitHub Releases as its only product distribution channel and does not publish an npm package. The root npm workspace stays \`private: true\` for source development. \`v${version}\` is the first stable release. Source tools require Node.js 26.4.0 or newer. User archives bundle a fixed Node.js 26.4.0 runtime, CLI/Web, and the local Rust core, so users do not install Node, npm, Rust, pnpm, or a compiler.`,
  );
  next = next.replaceAll(`--version ${version}`, '--version PREVIEW_VERSION')
    .replaceAll(`-Version ${version}`, '-Version PREVIEW_VERSION');
  return next;
}

export function applyReleaseCopy(file: string, content: string, version: string): string {
  if (releaseStage(version) !== 'stable') return content;
  if (file === 'README.md') return stableReadme(content, version, false, file);
  if (file === 'README.zh-CN.md') return stableReadme(content, version, true, file);
  if (file === 'docs/reference/distribution.en.md') return stableDistribution(content, version, false);
  if (file === 'docs/reference/distribution.md') return stableDistribution(content, version, true);
  return content;
}
