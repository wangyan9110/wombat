# Decision Note: Check official prices when rates are missing

[中文](2026-09-30-automatic-prices.md) | English

Status: implemented

## Problem

Bundled catalogs may lack new models, and manual updates require users to notice missing rates. Live lists query frequently; downloading every time would multiply requests and slow queries.

## Decision

Rust marks repairable missing prices: an identified OpenAI model, valid nonzero usage, and no applicable rate. The Node live client reuses the fixed official document download and Rust validation. Model lists, logs, and account credentials are never sent. Success repeats the original filtered query once; fixed snapshots and cached queries never trigger it. An environment variable disables automatic networking.

Rust persists attempt state in the product data directory and coalesces cross-process downloads with a file lock and 60-second lease. Failure cools down for 15 minutes; a successful check for 24 hours. Automatic downloads take at most 5 seconds, with a separate parsing/publication timeout. The host caches cooldown receipts to avoid starting a checking process every second. Failure returns existing usage and a separate price state without claiming that prices are known. Manual updates can retry immediately.

## Alternatives considered

Manual-only updates do not meet the user's request. Downloading on every missing-price query repeats requests to the official page. A permanent scheduled service adds lifecycle and idle-resource overhead, so checks are query-triggered with persistent cooldowns and short leases. Missing model names or request conditions are evidence gaps that a catalog cannot repair; they must not cause repeated downloads or borrowed prices.

## Impact and verification

The user requested automatic fetching for missing prices, so default live queries may now access the network. Source logs remain read-only and no API key is required. Only standard rates verified by the existing parser are imported; page changes or access rejection retain the previous catalog. Public `priceUpdate` is separate from log freshness, and unpriced remains distinct from zero. Synthetic cases verify cross-process throttling, lease expiry, failure preservation, independent amounts, old snapshots, and terminal paths. Actual results belong in verification records retained in Git history; usage and limits are in [pricing](../../../reference/pricing.en.md).
