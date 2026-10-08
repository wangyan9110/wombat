# Account and allowance

Use `account --json`, or `account refresh --json` when fresh data is requested. Never wait for a usage scan or ask for a project to read account allowance.

Identity, allowance and activity have independent statuses and read times. Preserve actual windows/buckets, model applicability, full-precision balances, limits and reset timestamps. Do not assume five-hour/seven-day windows, equate token use with subscription quota, or derive a remaining percentage from an unknown value.

Explain unknown, expired or failed reads. Passing a reset time does not prove restored allowance, and read-only entitlements do not offer a reset operation. Existing handoff eligibility checks determine whether a model is explicitly blocked; low balance and unknown status are distinct.
