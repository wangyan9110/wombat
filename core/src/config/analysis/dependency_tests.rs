use super::*;
fn item(id: &str) -> Item {
    serde_json::from_value(serde_json::json!({
        "id":id,"name":id,"kind":"rule","path":format!("/safe/{id}"),"sourceInstanceId":"source",
        "authorizedProjects":[],"sourceContexts":[],"configuredState":"discovered","contentHash":"v1",
        "observedAt":"2026-10-01T00:00:00Z","current":true,"stale":false,"bytes":10,"estimateStatus":"unknown",
        "measurementStatus":"complete","bodyEstimateStatus":"unknown","observation":"unknown",
        "counts":{"fileReads":0,"toolCalls":0,"resourceReads":0,"succeeded":0,"failed":0,"outcomeUnknown":0},
        "relatedTurns":0,"relatedTasks":0
    })).unwrap()
}
fn relation(id: &str) -> RelationIdentity {
    RelationIdentity {
        source_instance_id: "source".into(),
        project: "/safe".into(),
        declaration_path: "/safe/.wombat/analysis.json".into(),
        declaration_hash: "decl-v1".into(),
        relation_id: id.into(),
        kind: RelationKind::Copy,
    }
}
#[test]
fn successful_empty_relation_dependencies_bind_peers_and_declarations_only() {
    let mut items = vec![item("object"), item("peer"), item("other")];
    let mut analysis = Analysis::default();
    analysis.assessed.extend(["object".into(), "peer".into()]);
    let key = relation("related");
    analysis.relations.insert(
        key.clone(),
        RelationAssessment::Complete(BTreeSet::from(["object".into(), "peer".into()])),
    );
    let fingerprint = |analysis: &Analysis, items: &[Item]| {
        analysis
            .rule_dependency_revision("declaredCopyDrift", &items[0], items, &[], 128 * 1024)
            .unwrap()
    };
    let first = fingerprint(&analysis, &items);
    assert_eq!(analysis.copy_complete("object"), Some(true));
    items[2].content_hash = "irrelevant".into();
    analysis.assessed.insert("other".into());
    analysis.relations.insert(
        relation("unrelated"),
        RelationAssessment::Complete(BTreeSet::from(["other".into()])),
    );
    assert_eq!(first, fingerprint(&analysis, &items));
    items[1].content_hash = "peer-v2".into();
    let peer = fingerprint(&analysis, &items);
    assert_ne!(first, peer);
    let state = analysis.relations.remove(&key).unwrap();
    let mut changed = key;
    changed.declaration_hash = "decl-v2".into();
    analysis.relations.insert(changed, state);
    let declared = fingerprint(&analysis, &items);
    assert_ne!(peer, declared);
    analysis.assessed.remove("peer");
    assert_ne!(declared, fingerprint(&analysis, &items));
}
#[test]
fn scoped_reference_completeness_and_work_budgets_are_explicit() {
    let items = vec![item("object")];
    let mut analysis = Analysis::default();
    analysis.reference_checks.insert(
        "object".into(),
        super::super::references::Assessment::default(),
    );
    let get = |analysis: &Analysis| {
        analysis.rule_dependency_revision("localReference", &items[0], &items, &[], 128 * 1024)
    };
    let unknown = get(&analysis).unwrap();
    analysis
        .reference_checks
        .get_mut("object")
        .unwrap()
        .complete = true;
    assert_ne!(unknown, get(&analysis).unwrap());
    assert!(
        analysis
            .rule_dependency_revision("localReference", &items[0], &items, &[], 1)
            .is_none()
    );
    let projects = vec!["/safe"; 1025];
    assert!(
        analysis
            .rule_dependency_revision("hookTarget", &items[0], &items, &projects, 128 * 1024)
            .is_none()
    );
    for n in 0..4097 {
        analysis
            .relations
            .insert(relation(&n.to_string()), RelationAssessment::Unknown);
    }
    assert!(
        analysis
            .rule_dependency_revision("declaredCopyDrift", &items[0], &items, &[], 128 * 1024)
            .is_none()
    );
    assert!(get(&analysis).is_some()); // References do not scan unrelated relations.
}
#[test]
fn peer_lookup_has_one_candidate_budget_and_never_claims_unexamined_absence() {
    let target = item("object");
    let peer = item("peer");
    let mut analysis = Analysis::default();
    analysis.relations.insert(
        relation("related"),
        RelationAssessment::Complete(BTreeSet::from(["object".into(), "peer".into()])),
    );
    let mut items = vec![item("unrelated"); 4096];
    items.push(peer.clone());
    assert!(
        analysis
            .rule_dependency_revision("declaredCopyDrift", &target, &items, &[], 128 * 1024)
            .is_none()
    );
    items[0] = peer;
    assert!(
        analysis
            .rule_dependency_revision("declaredCopyDrift", &target, &items, &[], 128 * 1024)
            .is_some()
    );
}
