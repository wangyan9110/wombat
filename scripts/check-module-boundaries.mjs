import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const allowed = { client: [], tui: ['@wombat/client', '@wombat/client/locale'], cli: ['@wombat/client/locale', '@wombat/client', '@wombat/client/node', '@wombat/tui'] };
const issues = [];
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
for (const [module, imports] of Object.entries(allowed)) {
  for (const file of files(`${module}/src`)) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('.') && !path.resolve(path.dirname(file), spec).startsWith(path.resolve(module) + path.sep)) issues.push(`${file}: 跨模块内部导入 ${spec}`);
      if (spec.startsWith('@wombat/') && !imports.includes(spec)) issues.push(`${file}: 未允许的模块依赖 ${spec}`);
      if (module !== 'tui' && (spec.startsWith('@opentui/') || spec.startsWith('@inquirer/'))) issues.push(`${file}: 终端库只能由 tui 使用`);
      if (module === 'tui' && /^(node:|child_process|fs$)/.test(spec)) issues.push(`${file}: TUI 不得直接访问宿主业务资源 ${spec}`);
      if (module === 'client' && !file.startsWith('client/src/node/') && /^(node:|child_process|fs$)/.test(spec)) issues.push(`${file}: 通用客户端不得依赖 Node ${spec}`);
    }
  }
}
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log('core / client / tui / cli 导入边界检查通过');
