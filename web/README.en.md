# Local Web Host

[中文](README.md) | English

`@wombat/web` exports `startWebHost(options)`, returning the browser URL, origin, and asynchronous `close()`. The CLI injects a Node client; the host does not own pricing, queries, or source parsing rules.

## Access and resource limits

The listener binds to 127.0.0.1 with an automatically assigned port by default. Startup arguments and host-managed directory grants determine source scope; HTTP callers cannot provide arbitrary roots or snapshot paths. The host retains up to 128 returned snapshot identities. Core revision retention is independent; expired versions fail explicitly and require a fresh query.

Startup generates a random token in the URL fragment. The browser moves it into sessionStorage and clears the fragment. APIs require a Bearer token, exact Origin/Host, and JSON POST; CORS is disabled. The root page contains no business data, and CSP forbids remote scripts and embedding. The token grants local service access; it is not a source API key. A server restart requires a new link.

HTTP exposes only generated query, synchronization, catalog, configuration, review, grant, preference, Codex handoff and account operations. Both requests and responses are validated. HTTP uses NDJSON progress/result/error envelopes without redefining business DTOs. Limits are 64 KiB input, 16 MiB output, eight concurrent requests, and a 120-second timeout. Disconnects cancel the corresponding call; CLI exit signals close the listener and cancel its own requests. The shared core service follows its existing idle lifecycle; one departing Web client does not terminate another entry's service. Closing a browser tab does not exit the CLI.

Static files come only from the built asset directory. Startup loads allowed file types, with no directory listing or source access. Node and browser output is bounded; these limits do not verify million-record memory goals. The service does not support LAN, remote, or hosted deployment and exposes no generic file writes, shell execution, or core dispatch.

## Background prices

The host owns one background price task and returns basic usage first. Inject `createNodeClient({automaticPrices:false})` to avoid the client’s existing blocking updates. Host `automaticPrices:false` disables automatic networking; `close()` cancels and waits boundedly for its price task. Rust retains eligibility/cooldown/version ownership. `restartCommand?` is copyable material for authenticated Sources only; the browser cannot execute it or supply arbitrary root paths.

## Verification

After building the client, run `corepack pnpm --filter @wombat/web test`. Tests use only temporary synthetic directories and local listeners, covering authentication, scope, progress, cancellation, concurrency, and static resources. `tests/e2e/web.test.ts` verifies the real core after a full build; installation checks reuse the same black-box case.
