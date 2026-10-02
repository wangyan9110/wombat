//! Reproducible static detection and durable human decisions, independent of usage filters.
use crate::{config::View, config_dto::Kind, dto::operation_error, optimize_dto::*};
use anyhow::Result;
mod store;
use rusqlite::Connection;
use std::{collections::BTreeMap, fs, path::Path, time::Duration};
pub(crate) fn parameters(overrides: Option<RuleOverrides>) -> Result<RuleParameters> {
    let overrides = overrides.unwrap_or_default();
    if overrides
        .agents_bytes
        .is_some_and(|n| n == 0 || n > 9_007_199_254_740_991)
        || overrides.description_characters.is_some_and(|n| n > 1024)
    {
        return Err(operation_error("INVALID_ARGUMENT", "整理提醒值无效"));
    }
    Ok(RuleParameters {
        overrides,
        ..Default::default()
    })
}
fn known_body(item: &crate::config_dto::Item) -> Option<u64> {
    item.body_token_estimate
        .as_ref()
        .filter(|e| {
            item.body_estimate_status == "estimated"
                && e.payload == "skillBody"
                && e.method == "tiktoken-rs-0.12.0/o200k_base/ordinary-v1"
                && e.encoding == "o200k_base"
                && e.tokenizer_version.as_deref() == Some("tiktoken-rs-0.12.0")
                && e.applicability == "referenceEncodingOnly"
                && !e.content_hash.is_empty()
        })
        .map(|e| e.tokens)
}
fn detect(view: &View, rules: &RuleParameters) -> Vec<Suggestion> {
    let mut suggestions: Vec<_> = view
        .items
        .iter()
        .filter(|i| i.current && !i.stale && i.measurement_status == "complete")
        .filter_map(|item| {
            let mut findings = vec![];
            let finding = |rule: &str, basis: &str, observed, threshold, evidence_codes| Finding {
                rule: rule.into(),
                status: "failed".into(),
                observed,
                threshold,
                evidence_codes,
                basis: Some(basis.into()),
                evidence: None,
            };
            if let Some(m) = &item.skill_metadata {
                if m.status == "invalid" {
                    findings.push(finding(
                        "skillFormat",
                        "fieldFormat",
                        None,
                        None,
                        m.issues.clone(),
                    ));
                }
                if let Some(n) = m.description_characters {
                    if n > rules.description_standard_max {
                        findings.push(finding(
                            "descriptionStandard",
                            "agentSkillsSpecification",
                            Some(n),
                            Some(rules.description_standard_max),
                            vec![],
                        ));
                    } else if n > rules
                        .overrides
                        .description_characters
                        .unwrap_or(rules.description_characters_default)
                    {
                        findings.push(finding(
                            "descriptionSize",
                            "productReminder",
                            Some(n),
                            Some(
                                rules
                                    .overrides
                                    .description_characters
                                    .unwrap_or(rules.description_characters_default),
                            ),
                            vec![],
                        ));
                    }
                }
                if m.status == "parsed"
                    && let Some(n) = known_body(item).filter(|n| *n >= rules.body_tokens)
                {
                    findings.push(finding(
                        "bodyTokens",
                        "agentSkillsRecommendation",
                        Some(n),
                        Some(rules.body_tokens),
                        vec![],
                    ));
                }
            }
            if item.kind == Kind::Rule
                && let Some(n) = item.bytes.filter(|n| {
                    *n > rules
                        .overrides
                        .agents_bytes
                        .unwrap_or(rules.agents_bytes_default)
                })
            {
                findings.push(finding(
                    "fileSize",
                    "productReminder",
                    Some(n),
                    Some(
                        rules
                            .overrides
                            .agents_bytes
                            .unwrap_or(rules.agents_bytes_default),
                    ),
                    vec![],
                ));
            }
            if findings.is_empty() {
                findings.extend(
                    view.analysis
                        .findings
                        .get(&item.id)
                        .cloned()
                        .unwrap_or_default(),
                );
                if findings.is_empty() {
                    return None;
                }
            } else {
                findings.extend(
                    view.analysis
                        .findings
                        .get(&item.id)
                        .cloned()
                        .unwrap_or_default(),
                );
            }
            let category = if findings.iter().any(|f| {
                matches!(
                    f.rule.as_str(),
                    "skillFormat" | "descriptionStandard" | "declaredCopyDrift"
                )
            }) {
                Category::Repair
            } else {
                Category::Trim
            };
            let id = crate::hash(
                serde_json::to_vec(&(
                    &item.id,
                    &item.content_hash,
                    &rules.version,
                    rules
                        .overrides
                        .agents_bytes
                        .unwrap_or(rules.agents_bytes_default),
                    rules
                        .overrides
                        .description_characters
                        .unwrap_or(rules.description_characters_default),
                    rules.body_tokens,
                    rules.description_standard_max,
                    &findings,
                ))
                .ok()?,
            );
            Some(Suggestion {
                scope_project: None,
                id,
                item: item.clone(),
                category,
                status: "pending".into(),
                findings,
                checked_at: view.checked.clone(),
                rule_version: rules.version.clone(),
                rule_parameters: Some(rules.clone()),
                recheck_rule_parameters: None,
                review_baseline: None,
                record_id: None,
                recorded_at: None,
            })
        })
        .collect();
    suggestions.sort_by_key(|s| {
        (
            if s.category == Category::Repair { 0 } else { 1 },
            s.item.path.clone(),
            s.item.source_instance_id.clone(),
        )
    });
    suggestions
}
pub(crate) fn capabilities() -> Response {
    Response {
        output_version: 1,
        action: Action::Capabilities,
        capabilities: Capabilities::default(),
        read_view: None,
        config_revision: String::new(),
        usage_revision: None,
        decision_revision: String::new(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        suggestions: vec![],
        pending: 0,
        history: 0,
        page: crate::usage_app_dto::Page {
            offset: 0,
            limit: 50,
            total: 0,
            next_offset: None,
        },
        issues: vec![],
        result_status: "complete".into(),
        rule_parameters: RuleParameters::default(),
    }
}
fn connect(path: &Path) -> Result<Connection> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path.parent().unwrap())?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(operation_error(
                    "REVIEWS_UNAVAILABLE",
                    "处理记录不是普通文件",
                ));
            }
        }
        Err(e) => return Err(e.into()),
    }
    let mut db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    store::initialize(&mut db)?;
    Ok(db)
}
pub(crate) fn execute(request: Request, id: String, view: &View) -> Result<Response> {
    let path = crate::storage::data_home()?.join("user-v1/reviews.sqlite3");
    execute_at(request, id, view, &path)
}
fn execute_at(r: Request, id: String, view: &View, path: &Path) -> Result<Response> {
    if r.project
        .as_ref()
        .is_some_and(|p| !view.projects.contains(p))
    {
        return Err(operation_error("INVALID_ARGUMENT", "项目目录尚未授权"));
    }
    let rules = parameters(r.rule_overrides.clone())?;
    let offset = r.offset.unwrap_or(0);
    let limit = r.limit.unwrap_or(50);
    if limit == 0 || limit > 200 || offset > 9_007_199_254_740_991 {
        return Err(operation_error("INVALID_ARGUMENT", "分页无效"));
    }
    let mut db = connect(path)?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut revision = store::revision(&tx)?;
    if r.decision_revision.as_ref().is_some_and(|v| v != &revision) {
        return Err(operation_error(
            "VIEW_EXPIRED",
            "处理记录版本已变化，请刷新",
        ));
    }
    let mut current = detect(view, &rules);
    let accessible = |i: &crate::config_dto::Item| {
        i.applies(r.source_instance_id.as_deref(), r.project.as_deref())
    };
    store::authorize(
        &tx,
        view.items
            .iter()
            .filter(|i| accessible(i))
            .flat_map(|i| i.inventory_ids().map(move |id| (id, i.id.as_str()))),
    )?;
    let states = store::states(&tx, r.project.as_deref())?;
    current.retain(|s| accessible(&s.item));
    for s in &mut current {
        s.scope_project = r.project.clone();
        s.id = crate::hash(format!("{}:{}", s.id, r.project.as_deref().unwrap_or("")));
    }
    if matches!(
        r.action,
        Action::Ignore | Action::MarkEdited | Action::Restore
    ) {
        let target = r
            .suggestion_id
            .as_ref()
            .ok_or_else(|| operation_error("INVALID_ARGUMENT", "需要建议身份"))?;
        let mut s = if r.action == Action::Restore {
            states
                .get(target)
                .filter(|s| s.status == "ignored")
                .map(|s| store::get(&tx, s.seq))
                .transpose()?
        } else {
            current.iter().find(|s| s.id == *target).cloned()
        }
        .ok_or_else(|| operation_error("NOT_FOUND", "建议已变化或不存在"))?;
        s.status = match r.action {
            Action::Ignore => "ignored",
            Action::MarkEdited => "awaitingRecheck",
            _ => "restored",
        }
        .into();
        if r.action == Action::MarkEdited {
            s.review_baseline = Some(s.item.clone());
        }
        if states.get(&s.id).is_none_or(|old| old.status != s.status) {
            store::append(&tx, &mut s)?;
        }
    }
    if r.action == Action::Recheck {
        let current_objects = current
            .iter()
            .map(|s| s.item.id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        let items_by_id: BTreeMap<_, _> = view
            .items
            .iter()
            .flat_map(|i| i.inventory_ids().map(move |id| (id, i)))
            .collect();
        for seq in store::rechecks(&tx, r.project.as_deref())? {
            let mut s = store::get(&tx, seq)?;
            let Some(item) = items_by_id.get(s.item.id.as_str()).copied() else {
                continue;
            };
            s.status = if !item.current
                || item.stale
                || item.measurement_status != "complete"
                || (s.findings.iter().any(|f| f.evidence.is_some())
                    && !view.analysis.complete_for(&s))
                || (item.kind == crate::config_dto::Kind::Skill
                    && item
                        .skill_metadata
                        .as_ref()
                        .is_none_or(|m| !matches!(m.status.as_str(), "parsed" | "invalid")))
                || (item.kind == Kind::Skill
                    && item
                        .skill_metadata
                        .as_ref()
                        .is_some_and(|m| m.status == "parsed")
                    && known_body(item).is_none())
            {
                "recheckUnavailable"
            } else if current_objects.contains(item.id.as_str()) {
                "stillNeedsReview"
            } else {
                "verified"
            }
            .into();
            s.checked_at = view.checked.clone();
            s.recheck_rule_parameters = Some(rules.clone());
            s.item = item.clone();
            store::append(&tx, &mut s)?;
        }
    }
    revision = store::revision(&tx)?;
    let latest = store::states(&tx, r.project.as_deref())?;
    current.retain(|s| latest.get(&s.id).is_none_or(|r| r.status != "ignored"));
    let pending = current.len();
    let history = store::history_count(&tx, r.project.as_deref())?;
    let (total, mut suggestions) = if r.group == Group::History {
        store::page(&tx, &r, offset, limit)?
    } else {
        if r.action == Action::Detail {
            current.retain(|s| Some(&s.id) == r.suggestion_id.as_ref());
        }
        if let Some(category) = &r.category {
            current.retain(|s| &s.category == category);
        }
        let total = current.len();
        (
            total,
            current
                .into_iter()
                .skip(offset)
                .take(limit)
                .collect::<Vec<_>>(),
        )
    };
    if r.action == Action::Detail && total == 0 {
        return Err(operation_error("NOT_FOUND", "未找到建议"));
    }
    if r.group != Group::History {
        for s in &mut suggestions {
            if let Some(old) = latest.get(&s.id).filter(|s| s.status == "awaitingRecheck") {
                s.status.clone_from(&old.status);
                s.review_baseline = store::baseline(&tx, old.seq)?;
            }
        }
    }
    let end = offset.saturating_add(limit).min(total);
    tx.commit()?;
    let mut issues = view.issues.clone();
    issues.extend(
        [
            "inactivityCoverageUnavailable",
            "mcpFaultEvidenceUnavailable",
            "spaceAdapterUnavailable",
            "hookEffectiveRegistryUnavailable",
        ]
        .map(|code| crate::config_dto::Issue {
            code: code.into(),
            path: None,
        }),
    );
    Ok(Response {
        output_version: 1,
        action: r.action,
        capabilities: Capabilities::default(),
        read_view: Some(id),
        config_revision: view.revision.clone(),
        usage_revision: view
            .snapshot
            .as_ref()
            .map(|s| s.manifest.snapshot_ref.snapshot_id.clone()),
        decision_revision: revision,
        checked_at: view.checked.clone(),
        suggestions,
        pending,
        history,
        page: crate::usage_app_dto::Page {
            offset,
            limit,
            total,
            next_offset: (end < total).then_some(end),
        },
        issues,
        result_status: "partial".into(),
        rule_parameters: rules,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_dto::{Counts, Item, Observation, SkillMetadata};
    use rusqlite::params;
    fn body_estimate(tokens: u64) -> crate::config_dto::ContentEstimate {
        crate::config_dto::ContentEstimate {
            tokens,
            encoding: "o200k_base".into(),
            method: "tiktoken-rs-0.12.0/o200k_base/ordinary-v1".into(),
            payload: "skillBody".into(),
            content_hash: "synthetic-body".into(),
            applicability: "referenceEncodingOnly".into(),
            tokenizer_version: Some("tiktoken-rs-0.12.0".into()),
        }
    }
    #[test]
    fn thresholds_distinguish_body_metadata_standards_and_product_reminders() {
        let mut v = view();
        let item = &mut v.items[0];
        item.bytes = Some(100_000);
        item.skill_metadata = Some(SkillMetadata {
            status: "parsed".into(),
            description_characters: Some(500),
            issues: vec![],
        });
        item.body_estimate_status = "estimated".into();
        item.body_token_estimate = Some(body_estimate(4999));
        let rules = RuleParameters::default();
        assert!(
            detect(&v, &rules).is_empty(),
            "large full file alone never triggers Skill body reminder"
        );
        for (n, expected) in [
            (500, None),
            (501, Some("descriptionSize")),
            (1024, Some("descriptionSize")),
            (1025, Some("descriptionStandard")),
        ] {
            v.items[0]
                .skill_metadata
                .as_mut()
                .unwrap()
                .description_characters = Some(n);
            let result = detect(&v, &rules);
            assert_eq!(
                result.first().map(|s| s.findings[0].rule.as_str()),
                expected
            );
            if n == 1025 {
                assert_eq!(result[0].category, Category::Repair);
                assert_eq!(result[0].findings.len(), 1);
            }
        }
        v.items[0].body_token_estimate = Some(body_estimate(5000));
        let combined = detect(&v, &rules);
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0].findings.len(), 2);
        assert_eq!(combined[0].findings[1].rule, "bodyTokens");
        v.items[0]
            .skill_metadata
            .as_mut()
            .unwrap()
            .description_characters = Some(500);
        v.items[0].body_token_estimate.as_mut().unwrap().method = "unknown-model".into();
        assert!(
            detect(&v, &rules).is_empty(),
            "unverified methods never trigger numeric reminders"
        );
        v.items[0].kind = Kind::Rule;
        v.items[0].skill_metadata = None;
        for (n, expected) in [(16384, 0), (16385, 1)] {
            v.items[0].bytes = Some(n);
            assert_eq!(detect(&v, &rules).len(), expected);
        }
        let custom = parameters(Some(RuleOverrides {
            agents_bytes: Some(20000),
            description_characters: Some(1024),
        }))
        .unwrap();
        assert!(detect(&v, &custom).is_empty());
        v.items[0].kind = Kind::Skill;
        v.items[0].skill_metadata = Some(SkillMetadata {
            status: "parsed".into(),
            description_characters: Some(1025),
            issues: vec![],
        });
        assert_eq!(
            detect(&v, &custom)[0].findings[0].rule,
            "descriptionStandard",
            "product overrides never bypass the standard"
        );
        assert!(
            parameters(Some(RuleOverrides {
                description_characters: Some(1025),
                ..Default::default()
            }))
            .is_err()
        );
    }
    #[test]
    fn older_inventory_and_ignore_records_remain_readable_without_hiding_v2() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reviews.sqlite3");
        let mut v = view();
        let mut old = detect(&v, &RuleParameters::default()).remove(0);
        old.id = "legacy-id".into();
        old.rule_version = "static-config-v1".into();
        old.rule_parameters = None;
        old.status = "ignored".into();
        let mut payload = serde_json::to_value(&old).unwrap();
        payload.as_object_mut().unwrap().remove("ruleParameters");
        payload.as_object_mut().unwrap().remove("reviewBaseline");
        payload["item"]
            .as_object_mut()
            .unwrap()
            .remove("bodyTokenEstimate");
        payload["item"]
            .as_object_mut()
            .unwrap()
            .remove("bodyEstimateStatus");
        payload["findings"][0]
            .as_object_mut()
            .unwrap()
            .remove("basis");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,object_id TEXT NOT NULL,suggestion_id TEXT NOT NULL,payload TEXT NOT NULL)").unwrap();
        db.execute(
            "INSERT INTO decisions(object_id,suggestion_id,payload) VALUES(?1,?2,?3)",
            params![old.item.id, old.id, payload.to_string()],
        )
        .unwrap();
        drop(db);
        let result = query(&path, &v, Request::default());
        assert_eq!(result.pending, 1);
        assert_eq!(result.history, 1);
        let history = query(
            &path,
            &v,
            Request {
                group: Group::History,
                ..Default::default()
            },
        );
        assert!(history.suggestions[0].item.body_token_estimate.is_none());
        assert_eq!(history.suggestions[0].item.body_estimate_status, "unknown");
        let id = result.suggestions[0].id.clone();
        query(
            &path,
            &v,
            Request {
                action: Action::MarkEdited,
                suggestion_id: Some(id),
                ..Default::default()
            },
        );
        v.items[0].skill_metadata = Some(SkillMetadata {
            status: "parsed".into(),
            description_characters: Some(500),
            issues: vec![],
        });
        let result = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(
            result.suggestions[0].status, "recheckUnavailable",
            "missing body estimates cannot pass"
        );
    }
    fn view() -> View {
        View {
            snapshot: None,
            items: vec![Item {
                id: "object".into(),
                name: "synthetic".into(),
                kind: Kind::Skill,
                source_instance_id: "source".into(),
                path: "/synthetic/SKILL.md".into(),
                project: None,
                authorized_projects: vec![],
                source_contexts: vec![],
                native_key: None,
                configured_state: "discovered".into(),
                content_hash: "original".into(),
                observed_at: "2026-10-01T00:00:00Z".into(),
                current: true,
                stale: false,
                bytes: Some(16385),
                content_tokens: None,
                estimate_status: "unavailable".into(),
                characters: Some(16385),
                measurement_status: "complete".into(),
                bytes_source: Some("completeUtf8File".into()),
                estimate: None,
                body_token_estimate: None,
                body_estimate_status: "unknown".into(),
                skill_metadata: Some(SkillMetadata {
                    status: "invalid".into(),
                    description_characters: Some(501),
                    issues: vec!["nameMissing".into()],
                }),
                usage_count: None,
                last_record_at: None,
                observation: Observation::Unknown,
                counts: Counts::default(),
                related_turns: 0,
                usage: None,
            }],
            issues: vec![],
            projects: vec!["/project".into(), "/other".into()],
            roots: vec![],
            project_roots: vec![],
            revision: "version".into(),
            checked: "2026-10-01T00:00:00Z".into(),
            history_status: "unavailable".into(),
            analysis: Default::default(),
        }
    }
    fn query(path: &Path, v: &View, r: Request) -> Response {
        execute_at(r, "config:test".into(), v, path).unwrap()
    }
    #[test]
    fn normalized_history_shares_evidence_and_only_decodes_the_requested_page() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reviews.sqlite3");
        let v = view();
        let mut s = detect(&v, &RuleParameters::default()).remove(0);
        s.review_baseline = Some(s.item.clone());
        s.status = "ignored".into();
        let mut db = connect(&path).unwrap();
        let tx = db.transaction().unwrap();
        for _ in 0..100 {
            store::append(&tx, &mut s).unwrap();
        }
        assert_eq!(
            tx.query_row("SELECT COUNT(*) FROM review_parts", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        let read = store::get(&tx, 100).unwrap();
        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            serde_json::to_value(&s).unwrap()
        );
        tx.execute("UPDATE review_events SET event=jsonb('{}') WHERE seq=1", [])
            .unwrap();
        tx.commit().unwrap();
        drop(db);
        let page = query(
            &path,
            &v,
            Request {
                group: Group::History,
                limit: Some(1),
                ..Default::default()
            },
        );
        assert_eq!(page.history, 100);
        assert_eq!(page.page.total, 100);
        assert_eq!(page.suggestions.len(), 1);
        assert_eq!(page.suggestions[0].record_id, s.record_id);
        assert!(
            execute_at(
                Request {
                    group: Group::History,
                    offset: Some(99),
                    limit: Some(1),
                    ..Default::default()
                },
                "test".into(),
                &v,
                &path
            )
            .is_err()
        );
    }
    #[test]
    fn legacy_migration_preserves_events_baselines_and_rolls_back_bad_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite3");
        let v = view();
        let mut s = detect(&v, &RuleParameters::default()).remove(0);
        s.review_baseline = Some(s.item.clone());
        s.status = "awaitingRecheck".into();
        s.record_id = Some("immutable-record".into());
        let payload = serde_json::to_string(&s).unwrap();
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,object_id TEXT NOT NULL,suggestion_id TEXT NOT NULL,payload TEXT NOT NULL)").unwrap();
        db.execute(
            "INSERT INTO decisions VALUES(17,?1,?2,?3)",
            params![s.item.id, s.id, payload],
        )
        .unwrap();
        db.execute(
            "INSERT INTO decisions VALUES(18,'object','bad','broken')",
            [],
        )
        .unwrap();
        drop(db);
        assert!(connect(&path).is_err());
        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM decisions", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name='review_events'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        db.execute("DELETE FROM decisions WHERE seq=18", [])
            .unwrap();
        drop(db);
        let mut db = connect(&path).unwrap();
        let tx = db.transaction().unwrap();
        assert_eq!(store::revision(&tx).unwrap(), "17");
        assert_eq!(
            serde_json::to_value(store::get(&tx, 17).unwrap()).unwrap(),
            serde_json::to_value(&s).unwrap()
        );
        store::append(&tx, &mut s).unwrap();
        assert_eq!(store::revision(&tx).unwrap(), "18");
        tx.commit().unwrap();
        db.pragma_update(None, "user_version", 999).unwrap();
        drop(db);
        assert!(connect(&path).is_err());
        assert_eq!(
            Connection::open(path)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM review_events", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn legacy_source_objects_are_authorized_but_rechecks_follow_one_physical_object() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reviews.sqlite3");
        let mut v = view();
        let mut legacy = detect(&v, &RuleParameters::default()).remove(0);
        legacy.item.id = "old-source-object".into();
        legacy.status = "awaitingRecheck".into();
        legacy.review_baseline = Some(legacy.item.clone());
        v.items[0].source_contexts = vec![crate::config_dto::SourceContext {
            inventory_id: legacy.item.id.clone(),
            source_instance_id: "source".into(),
            global: true,
            content_hash: "original".into(),
            configured_state: "discovered".into(),
            counts: Counts::default(),
            observation: Observation::Unknown,
            last_record_at: None,
        }];
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,object_id TEXT NOT NULL,suggestion_id TEXT NOT NULL,payload TEXT NOT NULL)").unwrap();
        db.execute(
            "INSERT INTO decisions(object_id,suggestion_id,payload) VALUES(?1,?2,?3)",
            params![
                legacy.item.id,
                legacy.id,
                serde_json::to_string(&legacy).unwrap()
            ],
        )
        .unwrap();
        drop(db);
        let request = Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        };
        assert_eq!(query(&path, &v, request.clone()).history, 2);
        assert_eq!(query(&path, &v, request.clone()).history, 3);
        v.items[0].skill_metadata = Some(SkillMetadata {
            status: "parsed".into(),
            description_characters: Some(10),
            issues: vec![],
        });
        v.items[0].body_estimate_status = "estimated".into();
        v.items[0].body_token_estimate = Some(body_estimate(0));
        let fixed = query(&path, &v, request.clone());
        assert_eq!(fixed.history, 4);
        assert_eq!(fixed.suggestions[0].status, "verified");
        assert_eq!(
            fixed.suggestions[0].review_baseline.as_ref().unwrap().id,
            "old-source-object"
        );
        assert_eq!(
            query(&path, &v, request).history,
            4,
            "verified physical object supersedes legacy pending aliases"
        );
    }
    #[test]
    fn object_findings_ignore_scope_and_versions_are_independent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("user/reviews.sqlite3");
        let mut v = view();
        let first = query(
            &path,
            &v,
            Request {
                project: Some("/project".into()),
                ..Default::default()
            },
        );
        assert_eq!(first.pending, 1);
        assert_eq!(first.suggestions[0].findings.len(), 2);
        assert_eq!(first.suggestions[0].category, Category::Repair);
        let ignored = query(
            &path,
            &v,
            Request {
                action: Action::Ignore,
                suggestion_id: Some(first.suggestions[0].id.clone()),
                project: Some("/project".into()),
                decision_revision: Some(first.decision_revision.clone()),
                ..Default::default()
            },
        );
        assert_eq!(ignored.pending, 0);
        assert_eq!(ignored.history, 1);
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    project: Some("/project".into()),
                    rule_overrides: Some(RuleOverrides {
                        agents_bytes: Some(16384),
                        description_characters: Some(500)
                    }),
                    ..Default::default()
                }
            )
            .pending,
            0,
            "explicit defaults do not invalidate an unchanged ignore decision"
        );
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    action: Action::Ignore,
                    suggestion_id: Some(first.suggestions[0].id.clone()),
                    project: Some("/project".into()),
                    decision_revision: Some(ignored.decision_revision.clone()),
                    ..Default::default()
                }
            )
            .history,
            1,
            "an acknowledged retry does not duplicate the user record"
        );
        assert!(
            execute_at(
                Request {
                    decision_revision: Some(first.decision_revision),
                    ..Default::default()
                },
                "id".into(),
                &v,
                &path
            )
            .is_err()
        );
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    project: Some("/other".into()),
                    ..Default::default()
                }
            )
            .pending,
            1
        );
        assert_eq!(query(&path, &v, Request::default()).pending, 1);
        assert!(
            execute_at(
                Request {
                    project: Some("/unauthorized".into()),
                    ..Default::default()
                },
                "id".into(),
                &v,
                &path
            )
            .is_err()
        );
        v.items[0].content_hash = "changed".into();
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    project: Some("/project".into()),
                    ..Default::default()
                }
            )
            .pending,
            1,
            "new content is not ignored"
        );
        v.items[0].content_hash = "original".into();
        v.items[0]
            .skill_metadata
            .as_mut()
            .unwrap()
            .issues
            .push("independentProblem".into());
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    project: Some("/project".into()),
                    ..Default::default()
                }
            )
            .pending,
            1,
            "independent findings are not ignored"
        );
    }
    #[test]
    fn manual_review_requires_observable_recheck_and_retains_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reviews.sqlite3");
        let mut v = view();
        let first = query(&path, &v, Request::default());
        let target = first.suggestions[0].id.clone();
        query(
            &path,
            &v,
            Request {
                action: Action::MarkEdited,
                suggestion_id: Some(target),
                ..Default::default()
            },
        );
        let unchanged = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(unchanged.suggestions[0].status, "stillNeedsReview");
        let baseline = unchanged.suggestions[0].review_baseline.as_ref().unwrap();
        assert_eq!(
            baseline.content_hash,
            first.suggestions[0].item.content_hash
        );
        assert_eq!(baseline.bytes, first.suggestions[0].item.bytes);
        // Removed files can retain complete historical metadata in the inventory.
        v.items[0].current = false;
        let removed = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(removed.suggestions[0].status, "recheckUnavailable");
        assert_eq!(
            removed.suggestions[0]
                .review_baseline
                .as_ref()
                .unwrap()
                .content_hash,
            first.suggestions[0].item.content_hash
        );
        v.items[0].current = true;
        v.items[0].measurement_status = "unavailable".into();
        let unavailable = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(unavailable.suggestions[0].status, "recheckUnavailable");
        v.items[0].measurement_status = "complete".into();
        v.items[0].bytes = Some(16384);
        v.items[0].skill_metadata = Some(SkillMetadata {
            status: "parsed".into(),
            description_characters: Some(500),
            issues: vec![],
        });
        v.items[0].body_token_estimate = Some(body_estimate(4999));
        v.items[0].body_estimate_status = "estimated".into();
        v.items[0].content_hash = "fixed".into();
        let fixed = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(fixed.pending, 0);
        assert_eq!(fixed.suggestions[0].status, "verified");
        assert_eq!(fixed.history, 5);
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    group: Group::History,
                    limit: Some(1),
                    ..Default::default()
                }
            )
            .page
            .next_offset,
            Some(1)
        );
        let fresh = view();
        assert_eq!(
            query(
                &path,
                &fresh,
                Request {
                    group: Group::History,
                    ..Default::default()
                }
            )
            .history,
            5,
            "a rebuilt inventory does not delete user records"
        );
        assert!(
            fs::read(&path)
                .unwrap()
                .windows(10)
                .all(|w| w != b"secretbody")
        );
    }
    #[test]
    fn incomplete_yaml_checks_cannot_pass_a_manual_recheck() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let mut v = view();
        let id = query(&path, &v, Request::default()).suggestions[0]
            .id
            .clone();
        query(
            &path,
            &v,
            Request {
                action: Action::MarkEdited,
                suggestion_id: Some(id),
                ..Default::default()
            },
        );
        v.items[0].bytes = Some(20);
        for status in ["resourceLimited", "unsupported"] {
            v.items[0].skill_metadata = Some(SkillMetadata {
                status: status.into(),
                description_characters: None,
                issues: vec![],
            });
            let result = query(
                &path,
                &v,
                Request {
                    action: Action::Recheck,
                    group: Group::History,
                    ..Default::default()
                },
            );
            assert_eq!(result.suggestions[0].status, "recheckUnavailable");
            assert_eq!(
                result.pending, 0,
                "no fabricated format error for budget/extension gaps"
            );
        }
    }
    #[test]
    fn restore_rejects_repeated_stale_actions_and_limits_are_strict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let v = view();
        let id = query(&path, &v, Request::default()).suggestions[0]
            .id
            .clone();
        query(
            &path,
            &v,
            Request {
                action: Action::Ignore,
                suggestion_id: Some(id.clone()),
                ..Default::default()
            },
        );
        assert_eq!(
            query(
                &path,
                &v,
                Request {
                    action: Action::Restore,
                    suggestion_id: Some(id.clone()),
                    ..Default::default()
                }
            )
            .pending,
            1
        );
        assert!(
            execute_at(
                Request {
                    action: Action::Restore,
                    suggestion_id: Some(id),
                    ..Default::default()
                },
                "id".into(),
                &v,
                &path
            )
            .is_err()
        );
        assert!(
            execute_at(
                Request {
                    limit: Some(201),
                    ..Default::default()
                },
                "id".into(),
                &v,
                &path
            )
            .is_err()
        );
        assert!(!capabilities().capabilities.execution);
    }
}
