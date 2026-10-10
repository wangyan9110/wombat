# Use the local Web dashboard

[中文](web.md) | English

Install Wombat with the [installation guide](installation.en.md). The Web dashboard reads local Codex records.

## Open Web

1. Run:

```sh
wombat web --open
```

2. If the browser does not open, use the full URL printed in the terminal.
3. To stop the Web host, press Ctrl+C in that terminal.

Closing the browser tab does not stop the host. A host restart requires a new link.

## Read the results

Overview shows usage trends, project and model totals, and period comparisons. Tasks provides task statistics, turn details, and recorded timing. Configuration pages show instructions, extensions, checks, and action history. Budget settings provide reminders and closed-period reviews.

The header's **Use with Skill** entry shows the discovered invocation and example questions. **Setup and collection** separates discovery, Hook registration, trust, and received events. An installed Skill does not prove that the first data read is complete.

## Recover a failed read

- If no tasks appear, complete a Codex task. Then select **Refresh data**.
- If reading fails, open **Data sources**. Select **Retry**.
- To inspect another project's configuration, add its directory in **Data sources**.

Reads can continue with available records during initial loading. Timing shows recorded activity, overlaps, and coverage gaps; it does not measure pure model reasoning time.

## Limits

The host listens on loopback only. The browser stores the access token for its session. Remote deployment is unsupported.

Tokens, API-equivalent estimates, and account allowance remain separate. Unknown values are not zero. See [privacy](../reference/privacy.en.md) and [pricing](../reference/pricing.en.md) for data and network limits.
