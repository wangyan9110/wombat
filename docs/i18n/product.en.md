# Product language and copy

[中文](product.md) | English

This page defines the CLI/TUI presentation language. The [bilingual documentation workflow](README.en.md) owns document pairing.

## Usage

```sh
wombat --lang en
wombat usage --lang zh
wombat prices --lang en
WOMBAT_LANG=en wombat --help
```

Language precedence is `--lang`, `WOMBAT_LANG`, system language, then the Chinese compatibility default. Supported languages are `zh` / `en` and their regional tags. The system language is the first nonempty value of `LC_ALL`, `LC_MESSAGES`, and `LANG`, or the runtime language when none is set; `C` / `POSIX` selects English. An unsupported explicit selection is an argument error; an unmatched system language falls back to Chinese.

Press `L` on the main usage or conversation view to switch languages while retaining the query scope, selection, and original data. Switching alone does not rescan. Filters and prices use the current language; return to the main view to switch again. The selection lasts for the current process; use an environment variable for a lasting preference. No preference file or new settings command is introduced.

## Module boundaries

- `@wombat/client/locale` is a separate public entry written in portable TypeScript, with no Node, OpenTUI, or Rust dependency. It provides `LocaleRuntime`, `resolveLocale`, typed `t`, immutable state, and subscriptions; CLI/TUI share one presentation instance per process.
- `client/src/locale/zh.ts` and `en.ts` contain complete messages with feature-prefixed keys; the Chinese key set constrains the English keys. Parameter names are derived from Chinese templates, and a separate check verifies bilingual parameter parity. Values are inserted verbatim without recursive parsing or translation.
- The CLI interprets language arguments and environment variables; the TUI reads language state. Module-level labels resolve lazily to avoid capturing an old language at startup. UI operations use stable identifiers and must not infer business actions from translated text.
- Language affects help, notices, labels, dates, and compact number display. JSON fields, error codes, model identifiers, source titles, user content, usage, and amounts are not translated. Known core and host progress signals are mapped at the presentation layer; unknown core diagnostics and source issues remain verbatim.

## Verification and limits

`corepack pnpm i18n:check` checks dictionary keys and parameters, Chinese literals in CLI/TUI source, and selected English copy properties. It uses the TypeScript syntax tree and ignores comments; it cannot judge translation quality or detect every dynamically assembled English message. New messages still require review.

`corepack pnpm test:repo` exercises checker failure cases; module tests cover language precedence, runtime switching, native terminal behavior, and formatting; end-to-end tests after a build confirm that language does not alter shared core data. This delivery covers Chinese and English CLI/TUI presentation. It does not add arbitrary language plugins, plural syntax, right-to-left layout, a documentation website, or full translation of core diagnostics.
