# Product language and copy

[中文](product.md) | English

This page defines the CLI/Web presentation language. The [bilingual documentation workflow](README.en.md) owns document pairing.

## Usage

```sh
wombat --lang en
wombat usage --lang zh
wombat prices --lang en
WOMBAT_LANG=en wombat --help
```

Language precedence is `--lang`, `WOMBAT_LANG`, system language, then the Chinese compatibility default. Supported languages are `zh` / `en` and their regional tags. The system language is the first nonempty value of `LC_ALL`, `LC_MESSAGES`, and `LANG`, or the runtime language when none is set; `C` / `POSIX` selects English. An unsupported explicit selection is an argument error; an unmatched system language falls back to Chinese.

Web switches through the header or detail language button while retaining page, filters, dialogs, focus and original content. Explicit link language (from --lang or WOMBAT_LANG) takes precedence, followed by local `user-v1/language.json`, tab-session choice and browser language. Changes persist through the narrow preference API across ports/restarts; save failures offer retry. CLI continues using arguments and environment without reading the Web preference.

## Module boundaries

- `@wombat/client/locale` is a separate public entry written in portable TypeScript, with no Node, React, or Rust dependency. It provides `LocaleRuntime`, `resolveLocale`, typed `t`, immutable state, and subscriptions; each CLI process or browser page uses its own presentation instance.
- `client/src/locale/zh.ts` and `en.ts` contain complete messages with feature-prefixed keys; the Chinese key set constrains the English keys. Parameter names are derived from Chinese templates, and a separate check verifies bilingual parameter parity. Values are inserted verbatim without recursive parsing or translation.
- The CLI interprets language arguments and environment variables; Web reads language state. Module-level labels resolve lazily to avoid capturing an old language at startup. UI operations use stable identifiers and must not infer business actions from translated text.
- Language affects help, notices, labels, dates, and compact number display. JSON fields, error codes, model identifiers, source titles, user content, usage, and amounts are not translated. Known core and host progress signals are mapped at the presentation layer; unknown core diagnostics and source issues remain verbatim.
- Count messages use complete templates and native `Intl.PluralRules` for singular/plural selection; zero, unknown values and two independent counts are handled separately. Month buckets show localized calendar months without converting calendar dates to the host timezone. Configuration instruction tokens are marked as estimates. Lists use KiB (1,024 B), retain exact byte evidence and sort by raw values.

## Verification and limits

`corepack pnpm i18n:check` checks dictionary keys and parameters, Chinese literals in CLI/Web source, and selected English copy properties. It uses the TypeScript syntax tree and ignores comments; it cannot judge translation quality or detect every dynamically assembled English message. New messages still require review.


`corepack pnpm test:repo` exercises checker failure cases; module tests cover language precedence, runtime switching, presentation formatting; end-to-end tests after a build confirm that language does not alter shared core data. This delivery covers Chinese and English CLI/Web presentation. It does not add arbitrary language plugins, a general grammar expression language, right-to-left layout, a documentation website, or full translation of core diagnostics.
