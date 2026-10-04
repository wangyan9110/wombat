# Development Script Instructions

Follow the [root instructions](../AGENTS.md). This directory owns checks, generators, and release assembly, not product business rules.

- Write new scripts in TypeScript using the existing Node toolchain. Explain exceptions, including new directly executed .mjs files. Preserve validation scope and evidence formats when migrating scripts.
- Checks are read-only by default; generation, confirmation updates, and publication have explicit entry points.
- Source checks run after locked dependency installation without dist, real Agent logs, or user configuration. Artifact checks declare a preceding build; missing artifacts must not silently skip acceptance.
- Connect checks to the appropriate root package.json aggregate and verify the CI call chain. A standalone script is not an executed check.
- Changed acceptance rules need isolated synthetic valid/invalid fixtures, nonzero failure exits, and actionable diagnostics. Never mutate the real repository to manufacture failures.
- Bound subprocess time/output and clean temporary directories. Do not turn failures into success or disable rules globally; justify object-specific exceptions.
- test:repo discovers *.test.ts and *.test.mjs here. It verifies development tools, not product behavior, browsers, or installation.
