# Wombat user Skills

[中文](README.md) | English

This directory owns user Skill source; repository development workflows remain in .agents/skills/. The single entry is [wombat/SKILL.md](wombat/SKILL.md), with startup, usage, account, configuration, processing/recheck, and Web references loaded as needed. One Skill serves Chinese and English. See [AGENTS.md](AGENTS.md) for maintenance rules.

The build generates dist/skill/wombat standalone resources, dist/skill/plugin, and a local marketplace from this source. Release archives place these assets under lib/skill. The standalone manifest binds version, source commit, file inventory and hashes; wombat-runtime.json binds the plugin version, content hash and required capabilities. Version comes from the root manifest; both installation modes share content hashes and required runtime capabilities. The plugin contains workflows, manifests, and licenses only; install the local Wombat runtime separately.

Codex owns formal plugin management. The local trial entry is:

```sh
corepack pnpm build
codex plugin marketplace add ./dist/skill
codex plugin add wombat@wombat-local
```

On Codex 0.160.0 the plugin invocation name is $wombat:wombat. For standalone trials, wombat skill install defaults to ~/.agents/skills/wombat with invocation $wombat. status reports files and native discovery separately; uninstall removes only unchanged managed copies. Choose one installation mode; users select among existing multiple instances. Installation does not scan logs or read login credentials, and does not establish data readiness.

Local marketplace installation, enabled discovery and removal have been verified on Codex 0.160.0 on macOS. Packaged marketplace roots live under lib/skill in the selected managed version. No public marketplace submission or public plugin installation page is claimed. Codex manages plugin updates and removal; updating Wombat does not overwrite the plugin. Discovery, queue acceptance, browser interaction and data readiness require separate acceptance. Other platforms and complete conversational journeys remain unverified.

See the [product plan](../docs/decisions/proposed/product/2026-10-04-codex-skill.en.md) for both entries, initialization, and responsibilities; the [CLI guide](../docs/guides/cli.en.md) for arguments and scope; and [installation](../docs/guides/installation.en.md) for the local runtime.

## Local collection package

The same build also produces `dist/skill/collection-plugin` and a `wombat-collection@wombat-local` catalog entry. It shares the canonical Skill and adds source-owned resources from `collection/`: reviewed Hook declarations and a minimal POSIX shell bridge. The skills-only base plugin has no lifecycle Hook declaration. Choose one plugin or standalone Skill mode to avoid competing enabled instances; actual native discovery supplies the invocation name.

For a source-build trial, register `./dist/skill` as above, then install `codex plugin add wombat-collection@wombat-local` instead of the base plugin. An installed archive keeps the same marketplace under `lib/skill`. The bridge prefers the managed user launcher with its ownership marker, then `wombat` on Codex’s PATH. A custom prefix needs that PATH entry. Collection mode and native Hook trust remain explicit separate steps; use the [CLI collection guide](../docs/guides/cli.en.md). Installing or removing the plugin does not remove product data or modify other Hook declarations. The POSIX bridge is implemented; Windows and full native event acceptance remain unverified. Hooks plugins are for local manual installation and cannot claim public-directory publication.

The local collection package uses only the generated `.codex-plugin/plugin.json`. On Codex 0.160.1, a root manifest suppresses its Hook registrations; the skills-only package retains the standard root manifest. Native installation acceptance must detect this difference. Run `corepack pnpm verify:skill-native -- --output-dir /tmp/wombat-native --codex-bin /absolute/path/to/codex` with a fresh profile; it checks installation, discovery, untrusted registration, and data-preserving removal. It does not establish Hook execution or public distribution.

Run `corepack pnpm verify:skill-conversation -- --output-dir /tmp/wombat-conversations --agent-bin /absolute/path/to/codex --language both` after a build to qualify selected real Codex conversations over synthetic usage, allowance and configuration. It creates a new session for each language, confirms the same fixed version and project through the Web host, resumes that exact session for one authorized description edit, then checks the original suggestion and preserved user decision. Use a fresh external output directory; native model execution uses the current authentication profile without reading or copying credentials. It does not change Hook trust or establish all real-project journeys.

After reviewing and trusting the collection declarations in native `codex` → `/hooks`, run `corepack pnpm verify:skill-native-events -- --output-dir /tmp/wombat-native-events --codex-bin /absolute/path/to/codex --wombat-bin /absolute/path/to/wombat --project /absolute/project --source-root /absolute/codex-home`. This explicit real-profile check creates one new read-only `pwd` task, verifies actual common-event receipt, and rechecks exact task/turn association against committed log facts. It preserves source files and credentials, stores private evidence outside the repository, and leaves safe receipts and derived indexes in product storage. It requires existing native trust and never grants or bypasses it. Unobserved lifecycle events remain unverified. Add `--session UUID` with a fresh output directory to recheck that exact native session without another model task. Log preparation waits at most 5 minutes; timeouts or storage failures retain evidence. A pinned usage reread checks that receipts do not add accounting.
