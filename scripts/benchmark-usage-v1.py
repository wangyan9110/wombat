#!/usr/bin/env python3
"""Deterministic, synthetic, fresh-process CLI query benchmark; no real Agent data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time


PROJECT = Path(__file__).resolve().parent.parent


def digest_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows), encoding="utf-8")


def envelope(at: datetime, kind: str, payload: dict) -> dict:
    return {"timestamp": at.isoformat().replace("+00:00", "Z"), "type": kind, "payload": payload}


def generate(source: Path, threads: int, turns: int) -> dict:
    titles = []
    origin = datetime(2026, 9, 28, tzinfo=timezone.utc)
    for index in range(threads):
        thread_id = f"synthetic-thread-{index:05d}"
        at = origin + timedelta(seconds=index)
        project = f"/synthetic/project-{index % 10:02d}"
        rows = [envelope(at, "session_meta", {"id": thread_id, "cwd": project})]
        for turn in range(turns):
            turn_id = f"turn-{turn:03d}"
            # Fixed two natural days, and a project shared by multiple threads.
            at = origin + timedelta(days=(turn * 2) // turns, minutes=turn * 5, seconds=index)
            rows.append(envelope(at, "turn_context", {"turn_id": turn_id, "model": "gpt-5.3-codex", "effort": "high", "cwd": project}))
            rows.append(envelope(at, "event_msg", {"type": "task_started", "turn_id": turn_id}))
            for response in range(2):
                rows.append(envelope(at + timedelta(seconds=1 + response * 3), "event_msg", {
                    "type": "token_usage_record", "thread_id": thread_id, "turn_id": turn_id,
                    "response_id": f"response-{turn:03d}-{response}",
                    "usage": {"input_tokens": 1000, "cached_input_tokens": 200,
                              "cache_write_input_tokens": 0, "output_tokens": 100,
                              "reasoning_output_tokens": 40, "total_tokens": 1100},
                }))
            rows.append(envelope(at + timedelta(seconds=2), "response_item", {
                "type": "function_call", "call_id": f"call-{turn:03d}", "name": "read_file",
                "arguments": "{\"path\":\"/synthetic/source.ts\"}",
            }))
            rows.append(envelope(at + timedelta(seconds=3), "response_item", {
                "type": "function_call_output", "call_id": f"call-{turn:03d}",
                "output": "SYNTHETIC_BODY_NOT_FOR_SNAPSHOT",
            }))
            rows.append(envelope(at + timedelta(seconds=5), "event_msg", {"type": "task_complete", "turn_id": turn_id}))
        # Archive is included intentionally; path date does not constrain the view.
        location = "archived_sessions" if index % 5 == 0 else "sessions"
        write_jsonl(source / location / f"rollout-{index:05d}.jsonl", rows)
        titles.append({"id": thread_id, "thread_name": f"合成对话 {index:05d}", "updated_at": "2026-09-29T23:59:59Z"})
    write_jsonl(source / "session_index.jsonl", titles)
    corpus_hash = hashlib.sha256()
    total_bytes = 0
    files = sorted(source.rglob("*.jsonl"))
    for path in files:
        data = path.read_bytes()
        relative = path.relative_to(source).as_posix().encode()
        corpus_hash.update(len(relative).to_bytes(8, "big"))
        corpus_hash.update(relative)
        corpus_hash.update(len(data).to_bytes(8, "big"))
        corpus_hash.update(data)
        total_bytes += len(data)
    measurements = threads * turns * 2
    return {
        "threads": threads, "turnsPerThread": turns, "responsesPerTurn": 2,
        "operationsPerTurn": 1, "measurements": measurements,
        "files": len(files), "bytes": total_bytes, "sha256": corpus_hash.hexdigest(),
        "expectedTotalTokens": measurements * 1100,
        # Independent decimal truth: (800*1.75 + 200*.175 + 100*14)/1M.
        "expectedCostUsd": str(Decimal(measurements) * Decimal("0.002835")),
    }


def run(node: str, env: dict, arguments: list[str], measured: bool = False) -> tuple[dict, str]:
    command = [node, str(PROJECT / "dist/wombat.js"), *arguments]
    if measured:
        if platform.system() == "Darwin":
            command = ["/usr/bin/time", "-l", *command]
        elif platform.system() == "Linux":
            command = ["/usr/bin/time", "-f", "WB_MAX_RSS_KIB=%M", *command]
        else:
            raise RuntimeError("RSS measurement is configured only for Darwin and GNU time on Linux")
    start = time.perf_counter()
    result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, timeout=120)
    elapsed = (time.perf_counter() - start) * 1000
    if result.returncode != 0:
        raise RuntimeError(f"CLI failed ({result.returncode}) for {arguments[0]}: {result.stdout[-1500:]} {result.stderr[-1500:]}")
    rss = None
    if measured:
        if platform.system() == "Darwin":
            match = re.search(r"(\d+)\s+maximum resident set size", result.stderr)
            rss = int(match[1]) if match else None
        else:
            match = re.search(r"WB_MAX_RSS_KIB=(\d+)", result.stderr)
            rss = int(match[1]) * 1024 if match else None
        if rss is None:
            raise RuntimeError("time did not report peak RSS")
    return {"wallMs": round(elapsed, 3), "peakRssBytes": rss, "stdoutBytes": len(result.stdout.encode())}, result.stdout


def query(node: str, env: dict, arguments: list[str]) -> dict:
    _, stdout = run(node, env, [*arguments, "--json"])
    return json.loads(stdout)


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def verify_summary(summary: dict, tokens: int, amount: Decimal) -> None:
    assert summary["tokens"]["total"] == tokens, summary
    assert summary["price"]["status"] == "priced", summary
    assert Decimal(summary["price"]["cost"]) == amount, summary


def execute(args: argparse.Namespace) -> dict:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is required")
    core = PROJECT / "dist" / ("wombat-core.exe" if os.name == "nt" else "wombat-core")
    cli = PROJECT / "dist/wombat.js"
    if not core.is_file() or not cli.is_file():
        raise RuntimeError("Build the release product before this benchmark")
    hashes = {"coreSha256": digest_file(core), "cliSha256": digest_file(cli)}
    with tempfile.TemporaryDirectory(prefix="wombat-query-benchmark-") as location:
        root = Path(location).resolve()
        source = root / "synthetic-codex"
        print(f"Generating {args.threads} synthetic threads × {args.turns} turns", file=sys.stderr, flush=True)
        corpus = generate(source, args.threads, args.turns)
        env = {**os.environ, "WOMBAT_DATA_HOME": str(root / "data"), "WOMBAT_CORE_BIN": str(core)}
        refresh_sample, refreshed_json = run(node, env, ["refresh", "--root", str(source), "--json"], measured=True)
        refreshed = json.loads(refreshed_json)
        total_tokens = corpus["expectedTotalTokens"]
        total_cost = Decimal(corpus["expectedCostUsd"])
        verify_summary(refreshed["summary"], total_tokens, total_cost)
        snapshot = refreshed["snapshotRef"]["snapshotId"]
        common = ["--snapshot", snapshot, "--timezone", "UTC"]
        # Resolve fixture IDs from its manifest, without warming query code first.
        generation = root / "data/usage-v3/generations" / snapshot / "committed"
        manifest = json.loads((generation / "manifest.json").read_text())
        selected_thread = manifest["threads"][0]
        thread = selected_thread["thread"]["id"]
        turn = next(iter(selected_thread["turns"]))
        commands = {
            "usage": ["usage", *common, "--since", "2026-09-28", "--until", "2026-09-30"],
            "threads": ["threads", *common, "--sort", "tokens"],
            "turns": ["turns", *common, "--thread", thread, "--sort", "tokens"],
            "steps": ["steps", *common, "--thread", thread, "--turn", turn, "--sort", "tokens"],
        }
        measurements = []
        for name, command in commands.items():
            print(f"Measuring {name}: first invocation + {args.samples} fresh-process warm samples", file=sys.stderr, flush=True)
            first, stdout = run(node, env, command, measured=True)
            assert stdout.strip(), name
            samples = []
            for index in range(args.samples):
                sample, current = run(node, env, command, measured=True)
                assert current == stdout, f"Text result changed across fixed-snapshot queries: {name}"
                samples.append(sample)
                if (index + 1) % 5 == 0:
                    print(f"  {name}: {index + 1}/{args.samples}", file=sys.stderr, flush=True)
            latencies = [sample["wallMs"] for sample in samples]
            p95 = percentile(latencies, 0.95)
            measurements.append({
                "command": name, "output": "Chinese text, default 120 columns, piped stdout",
                "firstInvocation": first, "warmSamples": samples,
                "warmP50Ms": round(statistics.median(latencies), 3), "warmP95Ms": p95,
                "maxObservedRssBytes": max([first["peakRssBytes"], *[sample["peakRssBytes"] for sample in samples]]),
                "warmP95Within300Ms": p95 <= 300, "firstInvocationWithin1000Ms": first["wallMs"] <= 1000,
            })
        print("Checking exact totals and paginated conservation", file=sys.stderr, flush=True)
        report = query(node, env, commands["usage"])
        verify_summary(report["summary"], total_tokens, total_cost)
        subtotal_rows = [row for row in report["items"] if row["isSubtotal"]]
        assert sum(row["usage"]["tokens"]["total"] for row in subtotal_rows) == total_tokens
        assert sum((Decimal(row["usage"]["price"]["cost"]) for row in subtotal_rows), Decimal(0)) == total_cost
        seen_threads, page_tokens, page_cost = set(), 0, Decimal(0)
        offset = 0
        while True:
            page = query(node, env, [*commands["threads"], "--limit", "50", "--offset", str(offset)])
            verify_summary(page["summary"], total_tokens, total_cost)
            assert page["page"]["total"] == args.threads
            for row in page["items"]:
                assert row["id"] not in seen_threads
                seen_threads.add(row["id"])
                page_tokens += row["threadUsage"]["tokens"]["total"]
                page_cost += Decimal(row["threadUsage"]["price"]["cost"])
            offset = page["page"]["nextOffset"]
            if offset is None:
                break
        assert len(seen_threads) == args.threads and page_tokens == total_tokens and page_cost == total_cost
        thread_tokens, thread_cost = args.turns * 2200, Decimal(args.turns) * Decimal("0.00567")
        turns_result = query(node, env, commands["turns"])
        verify_summary(turns_result["summary"], thread_tokens, thread_cost)
        assert len(turns_result["items"]) == args.turns
        for row in turns_result["items"]:
            verify_summary(row["usage"], 2200, Decimal("0.00567"))
            assert abs(row["share"] - 1 / args.turns) < 1e-12
        paged_turn = query(node, env, [*commands["turns"], "--limit", "1"])
        assert paged_turn["summary"] == turns_result["summary"]
        assert paged_turn["items"][0] == turns_result["items"][0]
        steps_result = query(node, env, commands["steps"])
        verify_summary(steps_result["summary"], 2200, Decimal("0.00567"))
        assert len(steps_result["items"]) == 3
        for row in steps_result["items"]:
            if row["kind"] == "measurement":
                verify_summary(row["usage"], 1100, Decimal("0.002835"))
                assert row["share"] == 0.5
            else:
                assert "usage" not in row and "price" not in row
        paged_step = query(node, env, [*commands["steps"], "--limit", "1"])
        assert paged_step["summary"] == steps_result["summary"]
        assert paged_step["items"][0] == steps_result["items"][0]
        assert hashes == {"coreSha256": digest_file(core), "cliSha256": digest_file(cli)}, "Build changed during benchmark"
        snapshot_bytes = sum(path.stat().st_size for path in generation.rglob("*") if path.is_file())
        return {
            "benchmark": "usage-v1-query", "generatedAt": datetime.now(timezone.utc).isoformat(),
            "environment": {"os": platform.system(), "osVersion": platform.release(), "architecture": platform.machine(),
                            "nodeVersion": subprocess.check_output([node, "--version"], text=True).strip(),
                            "pythonVersion": platform.python_version(), "cpuCount": os.cpu_count()},
            "build": {"profile": "release (built by project build script)", **hashes},
            "scope": "Each measured invocation starts Node CLI and Rust core, reads a fixed snapshot, serializes its DTO and renders Chinese text to a pipe; wall time includes /usr/bin/time launch. No TUI key navigation is measured.",
            "cacheControl": "The first invocation of each command is a fresh-process first-use measurement after refresh. OS file cache is NOT flushed; refresh and preceding commands may warm files. Warm samples also start fresh Node and Rust processes. No in-process cache or daemon is reused. Physical-disk cold-cache latency is not verified.",
            "rssMethod": "Darwin /usr/bin/time -l maximum resident set size in bytes (or GNU time %M KiB converted to bytes), for the launched command and waited child resource accounting. This is the maximum reported process RSS, not simultaneous summed process-tree memory; Python fixture generator is excluded.",
            "percentileMethod": "p50 median, p95 nearest-rank ceil(0.95*N), without discarding outliers",
            "corpus": corpus, "snapshotBytes": snapshot_bytes, "refresh": refresh_sample,
            "queries": measurements,
            "consistency": {"passed": True, "fullTokenTotal": total_tokens, "fullCostUsd": str(total_cost),
                            "threadPagesChecked": math.ceil(args.threads / 50), "fixedSnapshotTextStable": True,
                            "dailySubtotalsConserved": True, "threadPagesConserved": True,
                            "turnAndStepAmountsConserved": True, "sharesIndependentOfPagination": True,
                            "operationHasNoInventedCost": True},
            "targets": {"warmP95Ms": 300, "firstInvocationMs": 1000,
                        "allWarmTargetsMet": all(row["warmP95Within300Ms"] for row in measurements),
                        "allFirstInvocationTargetsMet": all(row["firstInvocationWithin1000Ms"] for row in measurements),
                        "physicalDiskColdCacheVerified": False},
            "reproduce": f"corepack pnpm build && python3 scripts/benchmark-usage-v1.py --threads {args.threads} --turns {args.turns} --samples {args.samples} --output <report.json>",
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--threads", type=int, default=500)
    parser.add_argument("--turns", type=int, default=10)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.threads < 1 or not 1 <= args.turns <= 50 or args.samples < 5:
        parser.error("threads >= 1, turns 1..50 and samples >= 5 are required")
    report = execute(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "targets": report["targets"],
                      "queries": [{"command": row["command"], "p95Ms": row["warmP95Ms"],
                                   "peakRssBytes": row["maxObservedRssBytes"]} for row in report["queries"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
