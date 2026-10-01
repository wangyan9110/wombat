# Decision Note: GUI Technical Routes

[中文](2026-10-01-gui-technical-routes.md) | English

Status: proposed

Implementation update (2026-10-01): the local Web path now uses Node HTTP and React / TypeScript / Vite; see the [local Web decision](../../implemented/architecture/2026-10-01-local-web.en.md). The text below preserves the research baseline. Tauri 2 remains selected; desktop delivery and TUI removal are still pending.

Research date: 2026-10-01. This note records desktop frameworks, core integration, CLI and Web coexistence, and verification tradeoffs for developers and maintainers. Tauri 2 is the selected desktop framework; the product direction is to remove the TUI, retain GUI and CLI entry points, and provide a CLI+Web edition. The full product plan is being written separately; this note does not determine specific features, pages, interactions, or platform delivery order. Framework selection is settled, but GUI/Web implementation, TUI removal, and performance measurement have not been completed. Under the repository lifecycle, proposed means engineering work is unshipped, not that the framework remains undecided.

## Problem

Compare the runtime cost, implementation reuse, and maintenance cost of GUI, CLI, and CLI+Web. The current code still includes CLI/TUI; see the [architecture](../../../development/architecture.en.md) for module boundaries and the [support matrix](../../../reference/support-matrix.en.md) for actual support. TUI removal is an unimplemented product direction. Current product boundaries are only a research baseline, not a constraint on the forthcoming product plan.

Source evidence: the generic [UsageClient](../../../../client/src/client.ts) provides generated contract validation, queries, pricing, and an optional live interface; the [Node host](../../../../client/src/node/core.ts) manages core subprocesses; [live transport](../../../../client/src/node/live.ts) connects to the shared service; and [pricing transport](../../../../client/src/node/prices.ts) performs restricted downloads. A shared [Rust library](../../../../core/src/lib.rs) and executable entry point already exist, but their lifecycle when embedded in a desktop host has not been verified.

## Proposal

### Selected framework and core integration

The desktop uses Tauri 2 and reuses the existing Rust business core. The framework and core integration are separate decisions: Tauri can call an independent core or link the Rust library. Integration still requires verification, which does not reopen the settled desktop framework choice. A Web UI does not require a Node server. React/TypeScript/Vite is only a frontend candidate; component choices await clearer product requirements. Tauri supports static frontends and officially recommends Vite for common single-page frameworks. [Frontend configuration](https://v2.tauri.app/start/frontend/)

| Integration | Potential benefit | Cost and open verification |
|---|---|---|
| Independent Rust core process | Retains existing protocols and fault isolation, with reuse of the on-demand service | Process packaging, communication copies, startup and cancellation, service version negotiation; Tauri supports bundled platform binaries |
| In-process Rust library | Removes one process boundary between the host and core | Requires design for blocking work, cooperative cancellation, crash impact, and ownership of the index shared with the CLI |

Validating a separate process first is an engineering judgment based on the existing implementation, not a performance finding. Tauri's [sidecar mechanism](https://v2.tauri.app/develop/sidecar/) requires binaries for each target.

### The role of GUI and CLI and CLI+Web

The target entry points are a desktop GUI, a non-TTY CLI, and a CLI+Web edition where the CLI starts a local service for browser access. Startup details and command names remain undecided. The current CLI assembles the TUI, which is to be removed; this note records the direction without performing the migration. New business capabilities should live in the shared core and contracts for the retained entry points to consume; the product plan determines specific features and entry-point coverage.

| Entry point | Current or target host | Technical responsibility |
|---|---|---|
| CLI JSON and text | Existing Node host | Arguments, exit codes, machine output; help and ordinary queries do not load OpenTUI |
| GUI | Selected Tauri 2 host, not yet implemented | Windows and desktop runtime, with restricted transport and shared business contracts |
| CLI+Web | Local service and browser, not yet implemented | CLI manages startup and shutdown; the browser accesses the same business contracts through restricted HTTP endpoints |

Performance comparisons distinguish one-shot CLI calls, a running GUI, and CLI+Web. Use the same data, cache, and query conditions, accounting separately for startup and resident costs and stating which browser processes are included for Web. Editions may upgrade independently; shared-service access must verify the running service's protocol, storage, and capability compatibility rather than only its bundled binary. Cancelling one client must not kill a shared service used by another entry point.

The current [multi-entry delivery workflow](../../../development/workflow.en.md) still describes the CLI/TUI baseline. Implementing the product migration will require corresponding updates to the conventions, support matrix, and distribution manifest; this research does not present the target as shipped behavior.

### Candidate reuse between desktop and Web

The Tauri desktop edition is intended to share frontend modules and generated contracts with CLI+Web, injecting Tauri IPC or local HTTP transport. Shared frontend modules must not directly import Node or Tauri host implementations; desktop-specific capabilities use explicit adapter interfaces. This reuse design has not been implemented and its actual reuse ratio remains unverified.

The CLI+Web local service could use Node to reuse the existing host or Rust to reduce runtime layers; neither is selected. Evaluate loopback access, per-launch access credentials, Origin/Host validation, cross-site request and DNS rebinding defenses, resource and connection limits, and cleanup after browser closure or CLI exit. Endpoints must expose product operations rather than map generic core dispatch directly to HTTP. Remote access, LAN sharing, and hosted deployment are undecided and require separate identity and security design.

### Host and communication boundaries

- Reuse Rust-generated DTOs, validation, and the shared locale service; host adapters must not maintain a second set of business fields or pricing rules.
- Map cancellation signals and progress callbacks to request identifiers, cancellation operations, and progress channels; verify the distinct meanings of disconnecting and stopping work.
- Tauri needs the restricted download, process, and connection management currently supplied by Node, preserving offline behavior, timeouts, output limits, and failure receipts.
- Verify copying, backlog, ordering, and subscription cleanup for large responses and continuous delivery. Ordinary Tauri events are unsuitable for high throughput or large messages; Channels are a streaming candidate, not proof of end-to-end backpressure. [Communication guidance](https://v2.tauri.app/develop/calling-frontend/)
- Expose only explicit product operations to pages; validate callers and arguments without arbitrary commands, file writes, or generic core dispatch. Tauri application commands need explicit permission boundaries. [Permissions](https://v2.tauri.app/security/capabilities/)

## Alternatives considered

The table retains the selected route and alternatives actually considered, with framework capabilities sourced from official documentation. Electron and Rust GUI frameworks remain tradeoff records, not desktop candidates being pursued in parallel.

| Route | Technical characteristics and reuse | Cost and current assessment |
|---|---|---|
| Tauri 2 with Web UI | Rust host and system WebView; reusable generic TS client and locale service | Selected for distribution size and fit with the Rust architecture; host adaptation and per-platform verification remain, without a claim of proven best performance |
| Electron with Web UI | Chromium rendering and Node host; greatest opportunity to reuse current Node transport | Not adopted; retained as tradeoff evidence. Bundles its runtime and requires embedded Node, packaging paths, lifecycle verification, and ongoing upgrades |
| Rust GUI such as Iced or GPUI | Rust UI and core integration, independent of WebView | Not adopted; retained as tradeoff evidence. Less reuse of TS presentation and locale code, and usually a separate browser interface |
| CLI+Web local service and browser | Explicitly retained edition direction; can share frontend code and contracts with a Web UI desktop route | Implementation remains undecided; adds HTTP, access authentication, ports, and service lifecycle, without inheriting private-socket security assumptions |

Framework sources: [Tauri process model](https://v2.tauri.app/concept/process-model/), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [Iced](https://github.com/iced-rs/iced), and [GPUI](https://gpui.rs/). Electron currently supports its latest three stable releases, creating ongoing maintenance work. [Support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

### Limits of performance conclusions

Tauri does not bundle a complete browser engine, giving it an architectural advantage in distribution size. Startup and memory may benefit, but require measurement of the complete process tree. System WebView rendering and versions vary by platform, so this does not establish that Tauri has the best performance. [WebView versions](https://v2.tauri.app/reference/webview-versions/)

With the same Rust core, the main algorithmic costs of scanning, pricing, and querying do not disappear through a different shell; communication and rendering can still change end-to-end latency. Existing source reconciliation and large-index resource limits remain relevant; see the [current architecture](../../../development/architecture.en.md). Empty-window measurements and third-party benchmarks have not been adopted as performance evidence for this project.

## Acceptance criteria

The following engineering checks for the selected route have not been run; they establish implementation details and verified capabilities. Use a synthetic test application independent of final product pages, with fixed data, release builds, OS versions, cache conditions, and measurement methods.

| Dimension | Evidence to retain |
|---|---|
| Runtime cost | Installed size, cold startup, idle CPU, complete process-tree memory, and long-running trends; state shared-page accounting |
| Communication and cancellation | Latency and peak memory across response sizes, continuous delivery, backlog, timeout, cancellation, and exit cleanup |
| Result consistency | Matching business results across CLI/GUI/CLI+Web for identical queries and fixed data; pagination and presentation do not change totals |
| Coexistence and recovery | Concurrent entry points, core crashes, reconnects, surviving old services, incompatible versions, and storage migrations |
| Desktop compatibility | Chinese IME, fonts, scaling, focus, accessibility, sleep recovery, and target OS differences |
| Web host | Desktop/browser frontend reuse, access credentials, Origin/Host and cross-site defenses, port conflicts, service shutdown, and connection cleanup across tabs |
| Testing and distribution | Real-app automation, signing, notarization, clean installation, failed-update recovery, dependency licenses, and target-platform CI |

Tauri's currently recommended embedded WebdriverIO driver supports macOS, Windows, and Linux; the direct traditional tauri-driver desktop route is limited to Windows/Linux. Test plugins should remain in test builds, and browser mocks do not replace real-app and final-installer verification. [Testing guidance](https://v2.tauri.app/develop/tests/webdriver/)

Distribution must separately evaluate [OS signing and notarization](https://v2.tauri.app/distribute/sign/macos/) and [application update signatures](https://v2.tauri.app/plugin/updater/). Application updates and business price-catalog updates are separate mechanisms. With Tauri 2 selected, verify technical limits and collect benchmarks, then use the product plan to determine core integration, frontend components, and supported platforms.
