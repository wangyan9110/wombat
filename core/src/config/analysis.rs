//! Bounded static analysis coordinates independent block, relation and reference checks.
mod blocks;
#[cfg(test)]
mod boundary_tests;
mod relations;
#[cfg(test)]
mod tests;
use crate::{
    config_dto::{Issue, Item, Kind},
    optimize_dto::*,
};
use blocks::{ExactGroup, Occurrence, blocks, duplicate_finding, exact_bucket, position};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
};
const FILE_LIMIT: usize = 1024 * 1024;
const ROUND_LIMIT: usize = 8 * 1024 * 1024;
const BLOCK_LIMIT: usize = 32768;
const FINDING_LIMIT: usize = 256;
const POSITION_LIMIT: usize = 4096;
#[derive(Default)]
pub(crate) struct Analysis {
    pub findings: BTreeMap<String, Vec<Finding>>,
    pub issues: Vec<Issue>,
    assessed: BTreeSet<String>,
    relations: BTreeMap<RelationIdentity, RelationAssessment>,
    metadata_bytes: usize,
    pub hook_checks: BTreeMap<(String, String), bool>,
    pub reference_checks: BTreeMap<String, super::references::Assessment>,
}
#[derive(serde::Serialize)]
enum RelationAssessment {
    Complete(BTreeSet<String>),
    Unknown,
}
impl Analysis {
    /// Safe collection output, including successful empty analyses and uncertain relations.
    pub(crate) fn observation_revision(&self) -> anyhow::Result<String> {
        super::observations::hash_safe(&(
            super::observations::FORMAT_VERSION,
            "static-analysis-v1",
            &self.findings,
            &self.issues,
            &self.assessed,
            self.relations.iter().collect::<Vec<_>>(),
            self.hook_checks.iter().collect::<Vec<_>>(),
            self.reference_checks
                .iter()
                .map(|(id, assessment)| {
                    (
                        id,
                        assessment.complete,
                        &assessment.findings,
                        &assessment.reasons,
                    )
                })
                .collect::<Vec<_>>(),
        ))
    }
    pub fn complete_finding(&self, item: &str, finding: &Finding) -> bool {
        if finding.rule == "hookTarget" {
            return finding
                .evidence
                .as_ref()
                .and_then(|e| e.hook.as_ref())
                .is_some_and(|e| {
                    self.hook_checks.get(&(item.into(), e.project.clone())) == Some(&true)
                });
        }
        if finding.rule == "localReference"
            && !self.reference_checks.get(item).is_some_and(|a| a.complete)
        {
            return false;
        }
        finding.evidence.iter()
            .all(|e| {
                e.versions
                    .iter()
                    .all(|v| self.assessed.contains(&v.item_id))
                    && if e.declaration_hash.is_some() {
                        e.relation.as_ref().is_some_and(|key| {
                            matches!(self.relations.get(key), Some(RelationAssessment::Complete(members))
                                if members.iter().all(|id| self.assessed.contains(id)))
                        })
                    } else { true }
            })
    }
    pub fn blocks_complete(&self, id: &str) -> bool {
        self.assessed.contains(id)
    }
    pub fn copy_complete(&self, id: &str) -> Option<bool> {
        let relevant: Vec<_> = self.relations.iter().filter(|(key, value)| key.kind == RelationKind::Copy
            && matches!(value, RelationAssessment::Complete(members) if members.contains(id))).collect();
        (!relevant.is_empty()).then(|| self.assessed.contains(id))
    }
    fn issue(&mut self, code: &str, path: &str) {
        if self.issues.len() < 256 {
            self.issues.push(Issue {
                code: code.into(),
                path: Some(path.into()),
            });
        }
    }
    pub(super) fn push(&mut self, id: &str, finding: Finding) -> bool {
        let bytes = serde_json::to_vec(&finding).map_or(usize::MAX, |v| v.len());
        if self.metadata_bytes.saturating_add(bytes) > 2 * 1024 * 1024
            || self
                .findings
                .get(id)
                .is_some_and(|v| v.len() >= FINDING_LIMIT)
        {
            self.assessed.remove(id);
            self.issue("staticAnalysisResourceLimited", id);
            return false;
        }
        self.metadata_bytes += bytes;
        self.findings.entry(id.into()).or_default().push(finding);
        true
    }
}
fn bounded_read(path: &Path, max: usize) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("notFile"));
    }
    let mut bytes = vec![];
    (&mut file).take(max as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(std::io::Error::other("resourceLimited"));
    }
    String::from_utf8(bytes).map_err(std::io::Error::other)
}
fn version(item: &Item) -> FileVersion {
    FileVersion {
        item_id: item.id.clone(),
        path: item.path.clone(),
        content_hash: item.content_hash.clone(),
    }
}
#[cfg(test)]
pub(super) fn analyze(items: &[Item], projects: &[String]) -> Analysis {
    analyze_authorized(items, projects, projects)
}
pub(super) fn analyze_authorized(
    items: &[Item],
    projects: &[String],
    roots: &[String],
) -> Analysis {
    let mut out = Analysis::default();
    let mut used = 0;
    let mut count = 0;
    let mut reference_budget = super::references::Budget::default();
    // Hash -> collision buckets, followed by exact bytes. Memory is bounded by the round read budget.
    let mut groups: BTreeMap<String, Vec<ExactGroup<'_>>> = BTreeMap::new();
    let mut texts = BTreeMap::new();
    for item in items.iter().filter(|i| {
        i.current
            && !i.stale
            && i.measurement_status == "complete"
            && matches!(i.kind, Kind::Rule | Kind::Skill)
    }) {
        let path = Path::new(&item.path);
        let allowed = projects.iter().any(|p| path.starts_with(p)) || item.project.is_none();
        if !allowed {
            continue;
        }
        if !fs::canonicalize(path).is_ok_and(|p| p == path) {
            out.issue("staticAnalysisPathUnknown", &item.path);
            continue;
        }
        let text = match bounded_read(path, FILE_LIMIT.min(ROUND_LIMIT.saturating_sub(used))) {
            Ok(s) => s,
            Err(_) => {
                out.issue("staticAnalysisUnavailable", &item.path);
                continue;
            }
        };
        used += text.len();
        if crate::hash(&text) != item.content_hash {
            out.issue("staticAnalysisVersionChanged", &item.path);
            continue;
        }
        let body = if item.kind == Kind::Rule {
            Some(text.as_str())
        } else {
            super::measure::skill_with_body(&text).1
        };
        if let Some(body) = body {
            let base = text.len() - body.len();
            let mut assessment =
                super::references::check(item, body, base, &text, roots, &mut reference_budget);
            for reason in &assessment.reasons {
                out.issue(reason, &item.path);
            }
            for finding in &assessment.findings {
                if !out.push(&item.id, finding.clone()) {
                    assessment.complete = false;
                }
            }
            out.reference_checks.insert(item.id.clone(), assessment);
            let lines = text[..base].bytes().filter(|b| *b == b'\n').count();
            let parsed = blocks(body)
                .into_iter()
                .map(|mut block| {
                    block.range = block.range.start + base..block.range.end + base;
                    block.line += lines;
                    block.end_line += lines;
                    block
                })
                .collect::<Vec<_>>();
            count += parsed.len();
            if count > BLOCK_LIMIT {
                out.issue("staticAnalysisResourceLimited", &item.path);
                continue;
            }
            let mut truncated = false;
            for block in parsed {
                let bytes = &text[block.range.clone()];
                let hash = crate::hash(bytes);
                let buckets = groups.entry(hash.clone()).or_default();
                let index = exact_bucket(buckets, bytes);
                if buckets[index].occurrences.len() < POSITION_LIMIT {
                    buckets[index].occurrences.push(Occurrence {
                        item,
                        position: position(item, &block, &hash),
                        context: block.context,
                    });
                } else {
                    truncated = true;
                    out.issue("staticAnalysisResourceLimited", &item.path);
                }
            }
            if !truncated {
                out.assessed.insert(item.id.clone());
            }
        }
        // Unknown skill-body parsing and truncated groups cannot prove recheck completion.
        texts.insert(item.id.as_str(), text);
    }
    for group in groups.values().flatten() {
        let mut by_context: BTreeMap<(&str, &str), Vec<&Occurrence<'_>>> = BTreeMap::new();
        for o in &group.occurrences {
            by_context
                .entry((&o.item.id, &o.context.fingerprint))
                .or_default()
                .push(o);
        }
        for occurrences in by_context.values().filter(|v| v.len() > 1) {
            // Hashes only select candidates. Compare the shared raw heading strings as well.
            if occurrences
                .iter()
                .any(|o| o.context.headings != occurrences[0].context.headings)
            {
                out.issue("blockApplicabilityUnknown", &occurrences[0].item.path);
                out.assessed.remove(&occurrences[0].item.id);
                continue;
            }
            out.push(
                &occurrences[0].item.id,
                duplicate_finding(occurrences, None),
            );
        }
    }
    relations::evaluate(&mut out, items, projects, &groups, &texts);
    out
}

#[cfg(test)]
mod observation_tests {
    use super::*;
    #[test]
    fn safe_revision_includes_empty_completion_and_relation_identity_state() {
        let mut analysis = Analysis::default();
        let empty = analysis.observation_revision().unwrap();
        analysis.assessed.insert("synthetic-item".into());
        let assessed = analysis.observation_revision().unwrap();
        assert_ne!(empty, assessed);
        let key = RelationIdentity {
            source_instance_id: "synthetic-source".into(),
            project: "/synthetic/project".into(),
            declaration_path: "/synthetic/project/.wombat/analysis.json".into(),
            declaration_hash: "synthetic-declaration".into(),
            relation_id: "synthetic-relation".into(),
            kind: RelationKind::Copy,
        };
        analysis
            .relations
            .insert(key.clone(), RelationAssessment::Unknown);
        let unknown = analysis.observation_revision().unwrap();
        assert_ne!(assessed, unknown);
        analysis.relations.insert(
            key.clone(),
            RelationAssessment::Complete(BTreeSet::from(["synthetic-item".into()])),
        );
        let complete = analysis.observation_revision().unwrap();
        assert_ne!(unknown, complete);
        analysis.relations.remove(&key);
        let mut changed = key;
        changed.declaration_hash = "changed-declaration".into();
        analysis.relations.insert(
            changed,
            RelationAssessment::Complete(BTreeSet::from(["synthetic-item".into()])),
        );
        assert_ne!(complete, analysis.observation_revision().unwrap());
    }
    #[test]
    fn reference_and_hook_completion_are_part_of_analysis_identity() {
        let mut analysis = Analysis::default();
        analysis.reference_checks.insert(
            "synthetic-item".into(),
            super::super::references::Assessment::default(),
        );
        let incomplete = analysis.observation_revision().unwrap();
        analysis
            .reference_checks
            .get_mut("synthetic-item")
            .unwrap()
            .complete = true;
        let complete = analysis.observation_revision().unwrap();
        assert_ne!(incomplete, complete);
        analysis.hook_checks.insert(
            ("synthetic-item".into(), "/synthetic/project".into()),
            false,
        );
        let unchecked = analysis.observation_revision().unwrap();
        analysis
            .hook_checks
            .insert(("synthetic-item".into(), "/synthetic/project".into()), true);
        assert_ne!(unchecked, analysis.observation_revision().unwrap());
    }
}
