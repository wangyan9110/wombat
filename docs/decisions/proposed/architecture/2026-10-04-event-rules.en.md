# Decision Note: Rule evaluation over unified evidence

[中文](2026-10-04-event-rules.md) | English

Status: proposed

## Problem

This record owns all design responsibilities from section 20 of the [upgrade overview](2026-10-04-codex-task-timing.en.md), as their single detailed design owner. The overview retains research evidence, cross-module constraints, task dependencies, and final acceptance; its entry points define neighboring workstreams. Splitting the documents does not indicate implementation completion.

## Proposal

The [statistical analysis architecture revision](2026-10-05-analysis-first-events.en.md) updates observation semantics, partial results, fallback calculations, and suggestion requirements. It takes precedence over older whole-result unavailability constraints below. Privacy, use-count semantics, identity protection, and final acceptance remain applicable.

### 20. Rule architecture based on unified evidence

This section describes the complete target: fixed evidence and shared analysis → independent rule evaluation → assessments → findings → suggestions and handling views. Current implementation and limits belong to the [core reference](../../../../core/README.en.md): rule caching, independent method versions, finding identities, and immutable review baselines are implemented. U12/U13 still require final shared-use integration and cross-entry and rebuild acceptance; partial delivery does not close either task. Whether a suggestion exists does not determine an assessment outcome.

#### 20.1 Design references and technology choice

Adopt data-quality and static-analysis layering with native Rust types and a rule registry. Draw on [Deequ](https://github.com/awslabs/deequ/blob/master/src/main/scala/com/amazon/deequ/VerificationSuite.scala) for separating shared analysis from constraints, [OPA](https://www.openpolicyagent.org/docs/management-decision-logs) for associating decisions with input revisions, [SARIF](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) for separating finding fingerprints, baselines, and suppressions, and [Salsa](https://salsa-rs.github.io/salsa/how_salsa_works.html) for pure dependencies and result reuse. These are project-specific choices, not guarantees that those systems fit Wombat. Adopt principles only, without adding these runtimes or promising format conformance.

[Drools](https://kie.apache.org/docs/10.0.x/drools/drools/rule-engine/index.html) working memory, activation agendas, and linked rule actions are unnecessary for current checks, so do not introduce it initially. Parameters remain validated typed configuration. Evaluate restricted languages such as [CEL](https://cel.dev/?hl=en) only if user-defined conditions become an explicit requirement; do not prebuild a DSL, dynamic plugins, or remote rule service.

#### 20.2 Collection, shared analysis, and rule evaluation

Configuration scans read authorized files during collection. Bodies exist only during bounded analysis; retain safe content revisions, measurements, locations, fingerprints, methods, and completeness records. Bodies and full arguments never enter the unified log. Body-dependent algorithms such as exact-block analysis still run during collection analysis; fingerprints do not enable arbitrary future algorithms to be replayed. Insufficient metadata requires recollection. Changed files produce new observations, never invented old content.

EvidenceView pins independent session-event, configuration-measurement, and host-observation revisions, sources, authorization scopes, observation times, and evaluation cutoff. Historical calls associate with current configuration only through provable identities; this does not establish historical use of current contents. Rules consume their own typed inputs without scanning raw logs, reading files, networking, executing commands, or modifying other rule inputs. Use counts, related turns, and post-recheck usage observations all consume the operation projection in [section 19 of the metrics workstream](2026-10-04-event-metrics.en.md) rather than separate counting logic.

Each rule declares a stable ID, version, applicable objects, validated parameters, required analyses and method versions, evidence requirements, observation scope, and resource budget. Check capability and evidence sufficiency before evaluating conditions. Determinism means identical input revisions, rule, parameters, and cutoff produce identical judgments; window rules cannot implicitly read the current clock during pure evaluation.

| Assessment outcome | Meaning and next step |
|---|---|
| Hit | Evidence establishes the problem condition; produce a finding and evidence |
| Miss | Required checks completed without detecting the problem; usable for comparable rechecks |
| Insufficient evidence | Supported check lacks fields, coverage, identity, or resources; disclose gaps |
| Unsupported | Current collector or analyzer cannot perform this check; never present it as passed |
| Check failed | Evaluation encountered an error; retain a safe reason rather than reporting a miss |

Exclude inapplicable objects before scheduling and explain when requested; a user's “Not applicable” choice remains a separate handling decision. Retain established local findings while marking the remaining scope incomplete; local hits cannot establish a complete pass rate or exact total finding count. Failure of one rule preserves valid results from others and marks the batch partially complete.

#### 20.3 Finding identity, user decisions, and rechecks

Separate finding identity from assessment identity. Finding keys use the rule, reliable object/relation identity, scope, and necessary problem-location features; line numbers and timestamps alone cannot define identity. Assessment identity covers dependency and content revisions, rule/method versions, parameters, cutoff, and result. Unrelated log appends should not change static finding identity. If association is unreliable, preserve both records and the gap rather than merging by name.

Each assessment retains actual measurements, thresholds or judgment basis, gaps, evidence references, and its revision. Each user decision identifies the finding, supporting basis at decision time, and applicability scope. Material content or rule-semantic changes require reassessing applicability without automatically applying old suppressions to new findings or deleting prior decisions. Decisions, reasons, management baselines, and recheck records remain in independent durable storage, untouched by event-index rebuilding. Format changes follow the current-format-only policy without automatic legacy migration; preserve uninterpretable records and explicitly report unavailability.

Only a miss with complete required evidence within the same finding's applicable scope can establish resolution. Disappearing sources, read failures, rule errors, ambiguous ownership, and rule upgrades do not directly prove resolution. Checks with changed rules or parameters record a separate revision and explicit comparability with the original baseline. Subsequent calls establish observed activity, not adoption, improvement, or savings.

#### 20.4 Incremental updates and capability limits

Start with explicit dependency tables and bounded caches. Keys include authorization scope, relevant observation/metric revisions, rule version, parameters, and time window. Static rules depend on required configuration and relation revisions; runtime rules depend on relevant event projections. Appends, truncation, replacement, and late corrections invalidate affected results. Moving windows may require recomputation without new events; fixed views retain their original cutoff. Recompute on demand after invalidation without introducing a permanent scheduler. Prove equivalence with full recomputation before deciding from measurements whether an incremental-computation library is needed. Caches are not user history.

Inactivity requires continuous coverage and enabled-state evidence. Duplicate injection requires content and position evidence within the same request context. MCP connection faults require explicit connection observations or error classification. Usage logs, repeated reads, and an individual tool failure cannot substitute for those respective prerequisites. Sufficient facts can establish use; absent facts establish only no observed use and cannot justify automatic disabling.

#### 20.5 Code ownership and acceptance

Retain collection and static algorithms in core/config. Within core/optimize, separate input preparation, rule registration/evaluation, and result composition by responsibility; service assembles them, while reviews/store retain independent user history. Add no crate or general event bus. Generate public contracts from optimize_dto and retain existing optimization/check entry points rather than adding rules to timing requests. Configuration pages, rule details, follow-up observations, and CLI reuse usage projections and evidence identities; present assessment facts separately from user decisions.

R1—R3 synthetic acceptance covers unchanged existing static truth; five assessment outcomes and isolated rule failures; three same-turn uses counted consistently across entry points; threshold changes reusing measurements; unrelated log appends preserving static finding identity; relevant configuration changes and late events triggering recomputation; window movement invalidating results without new events; missing coverage not implying inactivity; read failures not proving resolution; rule upgrades not claiming comparable fixes; index rebuilding preserving decisions and baselines; and equivalence of cold rebuilds and incremental results. Measure bounded caches, full-source scans, and rule batches rather than treating single-rule tests as overall performance acceptance.


## Alternatives considered

Tradeoffs within the moved sections remain intact. The [upgrade overview](2026-10-04-codex-task-timing.en.md) continues to own shared alternatives and rejection reasons. This change only splits documentation ownership, without changing existing technical choices.

## Acceptance criteria

This workstream owns U11–U13. The [overview task table](2026-10-04-codex-task-timing.en.md) remains the single list of completion gates and dependencies; field, failure, privacy, and algorithm constraints in this record also apply. Partial implementation remains proposed. Validate independent modules, commit, and push each increment; integration and full regression remain in U19. After an interrupting task completes, return to the unfinished workstream item; passing a local check does not skip remaining tasks.
