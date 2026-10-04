import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoots = ['.agents/skills', 'integrations/codex/skills'];
const errors = [];
let checked = 0;

for (const relativeRoot of skillRoots) {
  const skillsRoot = path.join(root, relativeRoot);
  if (!existsSync(skillsRoot)) continue;
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relative = `${relativeRoot}/${entry.name}/SKILL.md`;
    const file = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(file)) {
      errors.push(`${relative}: missing skill instructions`);
      continue;
    }
    checked++;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const end = lines.indexOf('---', 1);
    if (lines[0] !== '---' || end < 2) {
      errors.push(`${relative}: expected closed YAML frontmatter at the start`);
      continue;
    }
    const fields = new Map();
    for (const line of lines.slice(1, end)) {
      const match = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
      if (!match) {
        errors.push(`${relative}: frontmatter must use single-line key: value fields`);
        continue;
      }
      if (fields.has(match[1])) errors.push(`${relative}: duplicate ${match[1]} field`);
      fields.set(match[1], match[2].trim().replace(/^(["'])(.*)\1$/, '$2'));
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || fields.get('name') !== entry.name) {
      errors.push(`${relative}: name must be kebab-case and match its directory`);
    }
    if (!fields.get('description')) errors.push(`${relative}: description is required`);
    if (!lines.slice(end + 1).join('\n').trim()) errors.push(`${relative}: instruction body is empty`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Skill metadata passed: ${checked} skill(s).`);
}
