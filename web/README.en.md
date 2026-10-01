# Local Web Host

[中文](README.md) | English

`@wombat/web` exports `startWebHost({ client, assets, roots?, port?, locale? })`, returning the browser URL, origin, and asynchronous `close()`. The CLI injects a Node client; the host does not own pricing, queries, or source parsing rules.

## Access Boundaries

The listener binds only to `127.0.0.1`, using an automatically assigned port by default. A startup token, exact Host/Origin checks, and JSON POST protect four narrow APIs. Startup arguments determine source scope; only previously returned snapshot identities can be queried subsequently. See [architecture](../docs/development/architecture.en.md) for limits and lifecycle, and the [CLI guide](../docs/guides/cli.en.md) for usage.

The static directory must contain trusted build output. The browser cannot access arbitrary local paths; LAN and remote deployment are unsupported. Closing a tab does not end the CLI; service shutdown cancels its own requests without killing the shared core service.

## Verification

After building the client, run `corepack pnpm --filter @wombat/web test`. Tests use only temporary synthetic directories and local listeners, covering authentication, scope, progress, cancellation, concurrency, and static resources. `tests/e2e/web.test.ts` verifies the real core after a full build; installation checks reuse the same black-box case.
