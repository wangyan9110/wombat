import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scripts = path.dirname(fileURLToPath(import.meta.url));

// Run the shipped checker in a synthetic repository without build outputs or user data.
function check(script: string, files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-guidance-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    if (script === 'check-skills.mjs') symlinkSync(path.resolve(scripts, '../node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    copyFileSync(path.join(scripts, script), path.join(root, 'scripts', script));
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('document budgets count Unicode characters and reject excess or missing files', () => {
  const manifest = JSON.stringify({ 'AGENTS.md': 3 });
  assert.equal(check('check-doc-budgets.mjs', {
    'scripts/doc-budgets.json': manifest, 'AGENTS.md': '中 文 🐾\n',
  }).status, 0);
  const excess = check('check-doc-budgets.mjs', {
    'scripts/doc-budgets.json': manifest, 'AGENTS.md': '中文🐾多',
  });
  assert.equal(excess.status, 1);
  assert.match(excess.output, /AGENTS\.md: 4 non-whitespace characters exceed 3/);
  const missing = check('check-doc-budgets.mjs', { 'scripts/doc-budgets.json': manifest });
  assert.equal(missing.status, 1);
  assert.match(missing.output, /AGENTS\.md:.*missing file/);
});

for (const owner of ['.agents/skills', 'plugin/skills']) {
  test(`Skill metadata validates both acceptance and rejection in ${owner}`, () => {
    const file = `${owner}/sample/SKILL.md`;
    const valid = '---\nname: sample\ndescription: Synthetic workflow\n---\nRun a check.\n';
    assert.equal(check('check-skills.mjs', { [file]: valid }).status, 0);
    for (const [content, diagnostic] of [
      [valid.replace('name: sample', 'name: other'), /name must be kebab-case and match/],
      [valid.replace('description:', 'name: sample\ndescription:'), /duplicate name field/],
      [valid.replace('description: Synthetic workflow\n', ''), /description is required/],
      [valid.replace('Run a check.', ''), /instruction body is empty/],
      [valid.replace('\n---\nRun', '\nRun'), /expected closed YAML frontmatter/],
    ] as const) {
      const result = check('check-skills.mjs', { [file]: content });
      assert.equal(result.status, 1);
      assert.ok(result.output.includes(file));
      assert.match(result.output, diagnostic);
    }
  });
}

test('decision records reject lifecycle drift, invalid dates and proposal sections after implementation', () => {
  const file = 'docs/decisions/implemented/process/2026-10-04-sample.md';
  const valid = '# 决策记录：合成样例\n\nStatus: implemented\n\n## 问题\n\n## 决定\n\n## 考虑过的方案\n\n## 影响与验证\n';
  assert.equal(check('check-decisions.mjs', { [file]: valid }).status, 0);
  for (const [relative, content, diagnostic] of [
    [file, valid.replace('Status: implemented', 'Status: proposed'), /status must match Status: implemented/],
    [file, `${valid}\n## 验收条件\n`, /implemented notes describe shipped decisions/],
    [file, valid.replace('## 决定', '## 影响与验证'), /missing or out-of-order/],
    [file.replace('2026-10-04', '2026-02-30'), valid, /invalid date/],
  ] as const) {
    const result = check('check-decisions.mjs', { [relative]: content });
    assert.equal(result.status, 1);
    assert.ok(result.output.includes(relative));
    assert.match(result.output, diagnostic);
  }
});


for (const skillRoot of ['.agents/skills', 'plugin/skills']) {
  test(`Skill resource checks use portable paths and follow nested references in ${skillRoot}`, () => {
    const owner = `${skillRoot}/sample`;
    const resource = path.posix.relative(`${owner}/references`, 'owner.md');
    const skill = '---\nname: sample\ndescription: Synthetic workflow\n---\nRead [procedure](references/procedure.md).\n';
    const files: Record<string, string> = {
      [owner + '/SKILL.md']: skill,
      [owner + '/references/procedure.md']: `# Procedure\n\nRead [owner][facts].\n\n[facts]: ${resource}\n\n\`\`\`md\n[example](missing-example.md)\n\`\`\`\n`,
      'owner.md': '# Owner\n',
    };
    assert.equal(check('check-skills.mjs', files).status, 0);
    delete files['owner.md'];
    const missing = check('check-skills.mjs', files);
    assert.equal(missing.status, 1);
    assert.ok(missing.output.includes(`${owner}/references/procedure.md: missing linked resource ${resource}`));
    const entry = check('check-skills.mjs', { [owner + '/SKILL.md']: skill });
    assert.equal(entry.status, 1);
    assert.ok(entry.output.includes(`${owner}/SKILL.md: missing linked resource references/procedure.md`));
  });
}
