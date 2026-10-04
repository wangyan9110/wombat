//! Explicit instruction chains and source-copy relations; filesystem location implies no loading.
use super::{
    Analysis, RelationAssessment,
    blocks::{ExactGroup, duplicate_finding},
    bounded_read, version,
};
use crate::{
    config_dto::{Item, Kind},
    optimize_dto::*,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path},
};
fn declared_path<'a>(
    root: &Path,
    path: &str,
    items: &'a [Item],
    source_id: &str,
) -> Option<&'a Item> {
    let relative = Path::new(path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    let joined = root.join(relative);
    let canonical = dunce::canonicalize(&joined).ok()?;
    if !canonical.starts_with(root) {
        return None;
    }
    items.iter().find(|i| {
        Path::new(&i.path) == joined
            && i.in_source(source_id)
            && i.current
            && !i.stale
            && i.measurement_status == "complete"
    })
}
pub(super) fn evaluate(
    out: &mut Analysis,
    items: &[Item],
    projects: &[String],
    groups: &BTreeMap<String, Vec<ExactGroup<'_>>>,
    texts: &BTreeMap<&str, String>,
) {
    for project in projects {
        let root = Path::new(project);
        let manifest = root.join(".wombat/analysis.json");
        // Missing declaration is ordinary absence; unreadable/unsafe/malformed remains a visible gap.
        match fs::symlink_metadata(&manifest) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                out.issue("analysisDeclarationUnreadable", &manifest.to_string_lossy());
                continue;
            }
            Ok(_) => {}
        }
        if !dunce::canonicalize(&manifest).is_ok_and(|p| p.starts_with(root)) {
            out.issue(
                "analysisDeclarationOutsideRoot",
                &manifest.to_string_lossy(),
            );
            continue;
        }
        let text = match bounded_read(&manifest, 64 * 1024) {
            Ok(s) => s,
            Err(_) => {
                out.issue("analysisDeclarationUnreadable", &manifest.to_string_lossy());
                continue;
            }
        };
        let declaration = match serde_json::from_str::<AnalysisDeclaration>(&text) {
            Ok(d) if d.version == 1 && d.chains.len() + d.copies.len() <= 256 => d,
            _ => {
                out.issue(
                    "analysisDeclarationUnsupported",
                    &manifest.to_string_lossy(),
                );
                continue;
            }
        };
        let hash = crate::hash(text);
        for source_id in items
            .iter()
            .flat_map(Item::source_ids)
            .collect::<BTreeSet<_>>()
        {
            let mut ids = BTreeSet::new();
            for chain in &declaration.chains {
                let relation = RelationIdentity {
                    source_instance_id: source_id.into(),
                    project: project.clone(),
                    declaration_path: manifest.to_string_lossy().into(),
                    declaration_hash: hash.clone(),
                    relation_id: chain.id.clone(),
                    kind: RelationKind::Chain,
                };
                out.relations
                    .insert(relation.clone(), RelationAssessment::Unknown);
                if chain.id.is_empty()
                    || chain.id.len() > 128
                    || !ids.insert(chain.id.clone())
                    || chain.files.len() < 2
                    || chain.files.len() > 64
                {
                    out.issue("analysisRelationInvalid", &manifest.to_string_lossy());
                    continue;
                }
                let members: Option<Vec<_>> = chain
                    .files
                    .iter()
                    .map(|p| declared_path(root, p, items, source_id))
                    .collect();
                let Some(members) = members.filter(|v| {
                    v.iter()
                        .all(|i| out.assessed.contains(&i.id) && i.kind == Kind::Rule)
                }) else {
                    out.issue("analysisRelationUnavailable", &manifest.to_string_lossy());
                    continue;
                };
                let member_ids: BTreeSet<_> = members.iter().map(|i| i.id.clone()).collect();
                let mut complete = true;
                for group in groups.values().flatten() {
                    let selected: Vec<_> = group
                        .occurrences
                        .iter()
                        .filter(|o| member_ids.contains(&o.item.id))
                        .collect();
                    let distinct = selected.iter().map(|o| &o.item.id).collect::<BTreeSet<_>>();
                    if distinct.len() < 2 {
                        continue;
                    }
                    // Heading conditions and relative-reference bases cannot be inferred equivalent.
                    if selected
                        .iter()
                        .any(|o| o.context.headings != selected[0].context.headings)
                        || ((group.bytes.contains("./") || group.bytes.contains("]("))
                            && selected.iter().any(|o| {
                                Path::new(&o.item.path).parent()
                                    != Path::new(&selected[0].item.path).parent()
                            }))
                    {
                        out.issue("blockApplicabilityUnknown", &manifest.to_string_lossy());
                        complete = false;
                        continue;
                    }
                    for id in distinct {
                        out.push(id, duplicate_finding(&selected, Some(&relation)));
                    }
                }
                if complete && member_ids.iter().all(|id| out.assessed.contains(id)) {
                    out.relations
                        .insert(relation, RelationAssessment::Complete(member_ids));
                }
            }
            for copy in &declaration.copies {
                let relation = RelationIdentity {
                    source_instance_id: source_id.into(),
                    project: project.clone(),
                    declaration_path: manifest.to_string_lossy().into(),
                    declaration_hash: hash.clone(),
                    relation_id: copy.id.clone(),
                    kind: RelationKind::Copy,
                };
                out.relations
                    .insert(relation.clone(), RelationAssessment::Unknown);
                if copy.id.is_empty() || copy.id.len() > 128 || !ids.insert(copy.id.clone()) {
                    out.issue("analysisRelationInvalid", &manifest.to_string_lossy());
                    continue;
                }
                if copy.transform != "identity-v1" {
                    out.issue("copyTransformUnsupported", &manifest.to_string_lossy());
                    continue;
                }
                let pair = declared_path(root, &copy.source, items, source_id)
                    .zip(declared_path(root, &copy.copy, items, source_id));
                let Some((source, target)) = pair.filter(|(s, t)| {
                    s.id != t.id && s.in_source(source_id) && t.in_source(source_id)
                }) else {
                    out.issue("analysisRelationUnavailable", &manifest.to_string_lossy());
                    continue;
                };
                let Some((a, b)) = texts
                    .get(source.id.as_str())
                    .zip(texts.get(target.id.as_str()))
                else {
                    out.issue("analysisRelationUnavailable", &manifest.to_string_lossy());
                    continue;
                };
                out.relations.insert(
                    relation.clone(),
                    RelationAssessment::Complete(
                        [source.id.clone(), target.id.clone()].into_iter().collect(),
                    ),
                );
                if a == b {
                    continue;
                }
                out.push(
                    &target.id,
                    Finding {
                        rule: "declaredCopyDrift".into(),
                        status: "needsReview".into(),
                        observed: None,
                        threshold: None,
                        evidence_codes: vec!["declaredIdentityCopyDiffers".into()],
                        basis: Some("explicitSourceCopyRelation".into()),
                        evidence: Some(StaticEvidence {
                            hook: None,
                            method: "raw-utf8/identity-v1".into(),
                            applicability: "userDeclaredCopy".into(),
                            declaration_hash: Some(hash.clone()),
                            relation_id: Some(copy.id.clone()),
                            direction: Some("sourceToCopy".into()),
                            transform: Some(copy.transform.clone()),
                            versions: vec![version(source), version(target)],
                            positions: vec![],
                            relation: Some(relation),
                            references: vec![],
                        }),
                    },
                );
            }
        }
    }
}
