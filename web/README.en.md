# Local Web Host

[中文](README.md) | English

`@wombat/web` exports `startWebHost({ client, assets, roots?, projectRoots?, port?, locale? })`, returning the browser URL, origin, and asynchronous `close()`. The CLI injects a Node client; the host does not own pricing, queries, or source parsing rules.

## Access Boundaries

The listener binds only to `127.0.0.1`, using an automatically assigned port by default. A startup token, exact Host/Origin checks, and JSON POST protect six narrow APIs. Startup arguments determine source scope; only previously returned snapshot identities can be queried subsequently. See [architecture](../docs/development/architecture.en.md) for limits and lifecycle, and the [CLI guide](../docs/guides/cli.en.md) for usage.

The static directory must contain trusted build output. The browser cannot access arbitrary local paths; LAN and remote deployment are unsupported. Closing a tab does not end the CLI; service shutdown cancels its own requests without killing the shared core service.

## Verification

After building the client, run `corepack pnpm --filter @wombat/web test`. Tests use only temporary synthetic directories and local listeners, covering authentication, scope, progress, cancellation, concurrency, and static resources. `tests/e2e/web.test.ts` verifies the real core after a full build; installation checks reuse the same black-box case.

The host owns one background price task and returns basic usage first. Inject `createNodeClient({automaticPrices:false})` to avoid the client’s existing blocking updates. Host `automaticPrices:false` disables automatic networking; `close()` cancels and waits boundedly for its price task. Rust retains eligibility/cooldown/version ownership. `restartCommand?` is copyable material for authenticated Sources only; roots stay fixed and the browser has no execution or authorization-change interface.
