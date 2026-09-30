# Third-party notices

Wombat's original code is licensed under [MIT](LICENSE). Third-party components retain their original licenses; the root license does not relicense them.

- Node dependency notices: [license texts](licenses/node-dependencies.txt).
- Rust dependency notices: [license texts](licenses/rust-dependencies.txt).
- Optional Python development tooling notices: [license texts](licenses/python-tooling.txt).
- Versions, declared licenses, selected alternatives and notice hashes: [inventory](docs/dependency-licenses.json).

The inventory covers 102 installed Node packages (13 runtime) and 144 locked Rust packages other than Wombat. Enabled normal/build/dev dependencies are identified separately; optional lock entries not activated by current features are not compiled into this build, but their upstream license notices are still preserved. Node optional platform packages not installed here are recorded as unverified; their presence is not a platform support claim. Development dependencies are included conservatively.

The 2 pinned Python tools support optional terminal tests: pyte is LGPL-3.0 and wcwidth is MIT with its additional upstream permission notice. They are separately installed by developers and are not bundled into the product runtime. Only their original release license/author notices and provenance are retained. Their pins and notice hashes are checked locally without Python, pip, a virtual environment, or network access.

For Rust dual-licensed packages, Wombat uses the offered MIT alternative where available, retaining additional required notices, including Unicode-3.0. The alternative LGPL license offered by r-efi is not selected. Its AUTHORS file is preserved. Binary Node packages without their own license text retain the same-version upstream package notice. Crates that omit license texts retain supplemental notices from recorded upstream revisions, with fixed hashes.

Dependency updates require a license review and regeneration. Run `corepack pnpm licenses:generate`, then `corepack pnpm licenses:check`. Both read local metadata only; an incomplete dependency cache fails explicitly. No dependency installation, upgrade, or network download is performed by these commands.

This inventory records source declarations and notices, not a legal warranty or verification of all platform binaries.
