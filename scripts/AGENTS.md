# Development Script Instructions

Follow [root instructions](../AGENTS.md). This directory owns checks, generators, and assembly, not product rules.

- Use TypeScript and the existing Node toolchain. Explain executable `.mjs` exceptions; migrations preserve validation and evidence.
- Checks are read-only by default; generation, confirmation updates, and publication have explicit entry points.
- Source checks run after locked dependency installation without dist, real Agent logs, or user configuration. Artifact checks declare a preceding build; missing artifacts must not silently skip acceptance.
- Connect checks to a root package.json aggregate and CI; a standalone script is not an executed check.
- Changed acceptance rules need isolated synthetic valid/invalid fixtures, nonzero failure exits, and actionable diagnostics. Never mutate the real repository to manufacture failures.
- Bound subprocess time/output and clean temporary directories. Do not turn failures into success or disable rules globally; justify object-specific exceptions.
- Script each programmable/computable step and evidence check behind one package entry; do not leave decisions to an operator. Reuse checks and report stages. Git/external mutations resume by revalidating identities, never replacing a published identity.
- test:repo discovers *.test.ts and *.test.mjs here. It verifies development tools, not product behavior, browsers, or installation.
