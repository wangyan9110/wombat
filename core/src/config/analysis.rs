//! Exact static blocks and explicitly declared copies. No loading inference or execution.
use crate::{
    config_dto::{Issue, Item, Kind},
    optimize_dto::*,
};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    ops::Range,
    path::{Component, Path},
    sync::Arc,
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
}
enum RelationAssessment {
    Complete(BTreeSet<String>),
    Unknown,
}
impl Analysis {
    pub fn complete_for(&self, s: &Suggestion) -> bool {
        s.findings
            .iter()
            .filter_map(|f| f.evidence.as_ref())
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
    fn issue(&mut self, code: &str, path: &str) {
        if self.issues.len() < 256 {
            self.issues.push(Issue {
                code: code.into(),
                path: Some(path.into()),
            });
        }
    }
    fn push(&mut self, id: &str, finding: Finding) {
        let bytes = serde_json::to_vec(&finding).map_or(usize::MAX, |v| v.len());
        if self.metadata_bytes.saturating_add(bytes) > 2 * 1024 * 1024
            || self
                .findings
                .get(id)
                .is_some_and(|v| v.len() >= FINDING_LIMIT)
        {
            self.assessed.remove(id);
            self.issue("staticAnalysisResourceLimited", id);
            return;
        }
        self.metadata_bytes += bytes;
        self.findings.entry(id.into()).or_default().push(finding);
    }
}
#[derive(Debug, Default)]
struct HeadingContext {
    headings: [Option<Arc<str>>; 6],
    fingerprint: String,
}
#[derive(Debug)]
struct Block {
    range: Range<usize>,
    line: usize,
    end_line: usize,
    context: Arc<HeadingContext>,
}
fn blocks(text: &str) -> Vec<Block> {
    let mut result = vec![];
    let mut stack = vec![];
    let mut heading_start = 0;
    let newlines: Vec<_> = text
        .bytes()
        .enumerate()
        .filter_map(|(i, b)| (b == b'\n').then_some(i))
        .collect();
    let mut candidate: Option<(usize, usize, Arc<HeadingContext>)> = None;
    let mut headings: [Option<Arc<str>>; 6] = Default::default();
    let mut heading_hashes: [String; 6] = Default::default();
    let mut context = Arc::new(HeadingContext::default());
    // Offsets always refer to original UTF-8; no newline, case, punctuation or Unicode normalization.
    for (event, range) in Parser::new(text).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                let excluded = stack.iter().any(|t| {
                    matches!(
                        t,
                        TagEnd::BlockQuote(_) | TagEnd::CodeBlock | TagEnd::HtmlBlock
                    )
                });
                let top = stack.is_empty();
                if !excluded && top && matches!(tag, Tag::Paragraph | Tag::List(_)) {
                    candidate = Some((range.start, stack.len(), context.clone()));
                }
                if top && matches!(tag, Tag::Heading { .. }) {
                    heading_start = range.start;
                }
                if matches!(tag, Tag::BlockQuote(_) | Tag::CodeBlock(_) | Tag::HtmlBlock) {
                    candidate = None;
                }
                stack.push(tag.to_end());
            }
            Event::End(tag) => {
                stack.pop();
                if let TagEnd::Heading(level) = tag
                    && stack.is_empty()
                {
                    let depth = level as usize - 1;
                    let raw = &text[heading_start..range.end];
                    headings[depth] = Some(Arc::from(raw));
                    heading_hashes[depth] = crate::hash(raw);
                    for i in depth + 1..6 {
                        headings[i] = None;
                        heading_hashes[i].clear();
                    }
                    context = Arc::new(HeadingContext {
                        headings: headings.clone(),
                        fingerprint: crate::hash(heading_hashes.join("\0")),
                    });
                }
                if candidate
                    .as_ref()
                    .is_some_and(|(_, depth, _)| *depth == stack.len())
                {
                    let (start, _, context) = candidate.take().unwrap();
                    if range.end > start && result.len() <= BLOCK_LIMIT {
                        result.push(Block {
                            range: start..range.end,
                            line: newlines.partition_point(|i| *i < start) + 1,
                            end_line: newlines
                                .partition_point(|i| *i < range.end.saturating_sub(1))
                                + 1,
                            context,
                        });
                    }
                }
            }
            Event::InlineHtml(_) => candidate = None,
            _ => {}
        }
    }
    result
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
fn position(item: &Item, block: &Block, hash: &str) -> BlockPosition {
    BlockPosition {
        item_id: item.id.clone(),
        start_byte: block.range.start,
        end_byte: block.range.end,
        start_line: block.line,
        end_line: block.end_line,
        block_hash: hash.into(),
    }
}
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
    let canonical = fs::canonicalize(&joined).ok()?;
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
struct Occurrence<'a> {
    item: &'a Item,
    position: BlockPosition,
    context: Arc<HeadingContext>,
}
struct ExactGroup<'a> {
    bytes: String,
    occurrences: Vec<Occurrence<'a>>,
}
fn exact_bucket<'a>(buckets: &mut Vec<ExactGroup<'a>>, bytes: &str) -> usize {
    buckets
        .iter()
        .position(|g| g.bytes == bytes)
        .unwrap_or_else(|| {
            buckets.push(ExactGroup {
                bytes: bytes.into(),
                occurrences: vec![],
            });
            buckets.len() - 1
        })
}
fn duplicate_finding(
    occurrences: &[&Occurrence<'_>],
    declaration: Option<&RelationIdentity>,
) -> Finding {
    let mut versions = BTreeMap::new();
    for o in occurrences {
        versions.insert(&o.item.id, version(o.item));
    }
    Finding {
        rule: "exactInstructionBlocks".into(),
        status: "needsReview".into(),
        observed: Some(occurrences.len() as u64),
        threshold: None,
        evidence_codes: vec!["fullRawBlockEqual".into(), "actualInjectionUnknown".into()],
        basis: Some("staticExactBlocks".into()),
        evidence: Some(StaticEvidence {
            method: "pulldown-cmark-0.13.4/raw-utf8-v1".into(),
            applicability: if declaration.is_some() {
                "declaredJointApplicability"
            } else {
                "sameFileSameHeading"
            }
            .into(),
            declaration_hash: declaration.map(|v| v.declaration_hash.clone()),
            relation_id: declaration.map(|v| v.relation_id.clone()),
            direction: None,
            transform: None,
            versions: versions.into_values().collect(),
            positions: occurrences.iter().map(|o| o.position.clone()).collect(),
            relation: declaration.cloned(),
        }),
    }
}
pub(super) fn analyze(items: &[Item], projects: &[String]) -> Analysis {
    let mut out = Analysis::default();
    let mut used = 0;
    let mut count = 0;
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
        if !fs::canonicalize(&manifest).is_ok_and(|p| p.starts_with(root)) {
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
                            method: "raw-utf8/identity-v1".into(),
                            applicability: "userDeclaredCopy".into(),
                            declaration_hash: Some(hash.clone()),
                            relation_id: Some(copy.id.clone()),
                            direction: Some("sourceToCopy".into()),
                            transform: Some(copy.transform.clone()),
                            versions: vec![version(source), version(target)],
                            positions: vec![],
                            relation: Some(relation),
                        }),
                    },
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn files(root: &Path, contents: &[(&str, &str)]) -> Vec<Item> {
        let source = crate::adapters::contract::SourceInstance {
            id: "synthetic".into(),
            agent_kind: "codex".into(),
            root: root.to_string_lossy().into(),
        };
        for (path, text) in contents {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        super::super::scan::scan(&[source], &[root.to_string_lossy().into()], "now").items
    }
    fn declaration(root: &Path, value: &str) {
        fs::create_dir_all(root.join(".wombat")).unwrap();
        fs::write(root.join(".wombat/analysis.json"), value).unwrap();
    }
    #[test]
    fn exact_full_units_preserve_chinese_punctuation_case_and_original_positions() {
        let text = "# 要求\r\n\r\n先验证中文，保留 A。\r\n\r\n先验证中文，保留 A。\r\n\r\n先验证中文,保留 a。\r\n";
        let units = blocks(text);
        assert_eq!(units.len(), 3);
        assert_eq!(&text[units[0].range.clone()], &text[units[1].range.clone()]);
        assert_ne!(&text[units[1].range.clone()], &text[units[2].range.clone()]);
        assert_eq!(units[0].line, 3);
        assert_eq!(units[1].line, 5);
        assert_eq!(units[0].end_line, 3);
        assert_eq!(
            blocks("- 完整列表\n  - 子项\n\n- 完整列表\n  - 子项\n").len(),
            1
        );
        assert_eq!(
            blocks("> 示例\n\n```text\n示例\n```\n\n- 列表例子\n  ```text\n  示例\n  ```\n").len(),
            0
        );
    }
    #[test]
    fn no_directory_inference_declared_chains_remain_distinct_from_actual_injection() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let projects = vec![root.to_string_lossy().into()];
        let items = files(
            &root,
            &[
                ("AGENTS.md", "相同完整中文指令。\n"),
                ("child/AGENTS.md", "相同完整中文指令。\n"),
            ],
        );
        assert!(analyze(&items, &projects).findings.is_empty());
        declaration(
            &root,
            r#"{"version":1,"chains":[{"id":"explicit","files":["AGENTS.md","child/AGENTS.md"]}]}"#,
        );
        let result = analyze(&items, &projects);
        assert_eq!(result.findings.len(), 2);
        for finding in result.findings.values().flatten() {
            let e = finding.evidence.as_ref().unwrap();
            assert_eq!(e.applicability, "declaredJointApplicability");
            assert_eq!(e.positions.len(), 2);
            assert_eq!(e.versions.len(), 2);
            assert!(
                finding
                    .evidence_codes
                    .contains(&"actualInjectionUnknown".into())
            );
        }
        let changed = files(
            &root,
            &[("child/AGENTS.md", "# 仅在删除时\n\n相同完整中文指令。\n")],
        );
        let result = analyze(&changed, &projects);
        assert!(result.findings.is_empty());
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "blockApplicabilityUnknown")
        );
    }
    fn review(result: &Analysis, items: &[Item]) -> Suggestion {
        let (id, findings) = result.findings.iter().next().unwrap();
        Suggestion {
            id: "review".into(),
            scope_project: None,
            item: items.iter().find(|i| &i.id == id).unwrap().clone(),
            category: Category::Trim,
            status: "awaitingRecheck".into(),
            findings: findings.clone(),
            checked_at: "now".into(),
            rule_version: RuleParameters::default().version,
            rule_parameters: None,
            recheck_rule_parameters: None,
            review_baseline: None,
            record_id: None,
            recorded_at: None,
        }
    }
    #[test]
    fn recheck_requires_complete_owner_scoped_relation_and_all_members() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let other = root.join("other");
        fs::create_dir(&other).unwrap();
        let manifest =
            r#"{"version":1,"chains":[{"id":"joint","files":["AGENTS.md","child/AGENTS.md"]}]}"#;
        declaration(&root, manifest);
        declaration(&other, manifest);
        let items = files(
            &root,
            &[
                ("AGENTS.md", "# A\n\n相同完整指令。\n"),
                ("child/AGENTS.md", "# A\n\n相同完整指令。\n"),
            ],
        );
        let projects = vec![root.to_string_lossy().into()];
        let initial = analyze(&items, &projects);
        let review = review(&initial, &items);
        assert!(initial.complete_for(&review));
        let changed = files(&root, &[("child/AGENTS.md", "# B\n\n相同完整指令。\n")]);
        let unknown = analyze(&changed, &projects);
        assert!(
            unknown
                .issues
                .iter()
                .any(|i| i.code == "blockApplicabilityUnknown")
        );
        assert!(!unknown.complete_for(&review));
        fs::remove_file(root.join(".wombat/analysis.json")).unwrap();
        let mut all = items.clone();
        all.extend(files(
            &other,
            &[
                ("AGENTS.md", "独立指令一。\n"),
                ("child/AGENTS.md", "独立指令二。\n"),
            ],
        ));
        assert!(
            !analyze(
                &all,
                &[
                    root.to_string_lossy().into(),
                    other.to_string_lossy().into()
                ]
            )
            .complete_for(&review)
        );
        declaration(&root, manifest);
        let restored = files(&root, &[("child/AGENTS.md", "# A\n\n相同完整指令。\n")]);
        assert!(analyze(&restored, &projects).complete_for(&review));
        let mut legacy = review.clone();
        legacy.findings[0].evidence.as_mut().unwrap().relation = None;
        assert!(!initial.complete_for(&legacy));
        let mut incomplete = initial;
        let relation = review.findings[0]
            .evidence
            .as_ref()
            .unwrap()
            .relation
            .as_ref()
            .unwrap();
        let missing = match incomplete.relations.get(relation).unwrap() {
            RelationAssessment::Complete(ids) => ids.iter().last().unwrap().clone(),
            _ => unreachable!(),
        };
        incomplete.assessed.remove(&missing);
        assert!(!incomplete.complete_for(&review));
    }
    #[test]
    fn declared_copies_require_explicit_direction_and_supported_transform() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let projects = vec![root.to_string_lossy().into()];
        let items = files(
            &root,
            &[("AGENTS.md", "原件\n"), ("copy/AGENTS.md", "副本\n")],
        );
        assert!(analyze(&items, &projects).findings.is_empty());
        declaration(
            &root,
            r#"{"version":1,"copies":[{"id":"copy","source":"AGENTS.md","copy":"copy/AGENTS.md","transform":"identity-v1"}]}"#,
        );
        let result = analyze(&items, &projects);
        assert_eq!(result.findings.len(), 1);
        let f = result.findings.values().next().unwrap().first().unwrap();
        assert_eq!(f.rule, "declaredCopyDrift");
        let e = f.evidence.as_ref().unwrap();
        assert_eq!(e.direction.as_deref(), Some("sourceToCopy"));
        assert_eq!(e.versions.len(), 2);
        let revised = files(&root, &[("AGENTS.md", "另一原件\n")]);
        let latest = analyze(&revised, &projects);
        assert_ne!(
            serde_json::to_vec(&result.findings).unwrap(),
            serde_json::to_vec(&latest.findings).unwrap()
        );
        declaration(
            &root,
            r#"{"version":1,"copies":[{"id":"copy","source":"AGENTS.md","copy":"copy/AGENTS.md","transform":"unknown"}]}"#,
        );
        let result = analyze(&revised, &projects);
        assert!(result.findings.is_empty());
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "copyTransformUnsupported")
        );
    }
    #[test]
    fn short_repetitions_and_nested_list_overlap_do_not_replace_full_blocks() {
        let units = blocks(
            "保留原句。 后面不同一。\n\n保留原句。 后面不同二。\n\n- 顶层\n  - 中文子项\n  - 中文子项\n",
        );
        assert_eq!(units.len(), 3);
        assert_ne!(
            &"保留原句。 后面不同一。\n\n保留原句。 后面不同二。\n\n- 顶层\n  - 中文子项\n  - 中文子项\n"
                [units[0].range.clone()],
            &"保留原句。 后面不同一。\n\n保留原句。 后面不同二。\n\n- 顶层\n  - 中文子项\n  - 中文子项\n"
                [units[1].range.clone()]
        );
    }
    #[test]
    fn heading_format_and_conditions_are_not_normalized_into_equivalence() {
        let units = blocks("# **删除** 时\n\n原文\n\n# **构建** 时\n\n原文\n");
        assert_eq!(units.len(), 2);
        assert_ne!(units[0].context.headings, units[1].context.headings);
    }
}

#[cfg(test)]
mod boundary_tests {
    use super::*;
    #[test]
    fn forced_hash_bucket_collisions_still_compare_raw_bytes() {
        let mut buckets = vec![];
        assert_eq!(exact_bucket(&mut buckets, "中文 A。\r\n"), 0);
        assert_eq!(exact_bucket(&mut buckets, "中文 a。\r\n"), 1);
        assert_eq!(exact_bucket(&mut buckets, "中文 A。\n"), 2);
        assert_eq!(exact_bucket(&mut buckets, "中文 A。\r\n"), 0);
        assert_eq!(buckets.len(), 3);
    }
    #[test]
    fn skill_body_positions_exclude_yaml_and_preserve_source_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let path = root.join("skills/check/SKILL.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text = "---\nname: check\ndescription: Synthetic description\n---\n\n保留完整正文。\n\n保留完整正文。\n";
        fs::write(&path, text).unwrap();
        let source = crate::adapters::contract::SourceInstance {
            id: "synthetic".into(),
            agent_kind: "codex".into(),
            root: root.to_string_lossy().into(),
        };
        let inventory = super::super::scan::scan(&[source], &[], "now");
        let result = analyze(&inventory.items, &[]);
        assert_eq!(result.findings.len(), 1);
        let e = result.findings.values().next().unwrap()[0]
            .evidence
            .as_ref()
            .unwrap();
        assert_eq!(e.positions[0].start_line, 6);
        for p in &e.positions {
            assert_eq!(&text[p.start_byte..p.end_byte], "保留完整正文。\n");
        }
    }
    #[test]
    fn long_headings_are_shared_and_truncated_groups_are_not_complete() {
        let text = format!(
            "# {}\n\n{}",
            "标".repeat(100_000),
            "完整段落。\n\n".repeat(5000)
        );
        let parsed = blocks(&text);
        assert_eq!(parsed.len(), 5000);
        assert!(Arc::ptr_eq(&parsed[0].context, &parsed[4999].context));
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let items = super::tests::files(&root, &[("AGENTS.md", &text)]);
        let result = analyze(&items, &[root.to_string_lossy().into()]);
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "staticAnalysisResourceLimited")
        );
        assert!(
            !result
                .assessed
                .contains(&items.iter().find(|i| i.kind == Kind::Rule).unwrap().id)
        );
    }
    #[test]
    #[ignore = "release resource benchmark; run explicitly with fixed synthetic corpus"]
    fn fixed_corpus_resource_probe() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let path = root.join("AGENTS.md");
        let mut text = String::new();
        for n in 0..4000 {
            text.push_str(&format!("完整合成指令组 {}。保留中文与 A。\n\n", n % 100));
        }
        fs::write(&path, &text).unwrap();
        let source = crate::adapters::contract::SourceInstance {
            id: "synthetic".into(),
            agent_kind: "codex".into(),
            root: root.to_string_lossy().into(),
        };
        let started = std::time::Instant::now();
        let inventory = super::super::scan::scan(&[source], &[], "now");
        let inventory_ms = started.elapsed().as_secs_f64() * 1000.;
        let start = std::time::Instant::now();
        let analysis = analyze(&inventory.items, &[]);
        let analysis_ms = start.elapsed().as_secs_f64() * 1000.;
        let findings = analysis.findings.values().flatten().collect::<Vec<_>>();
        assert_eq!(findings.len(), 100);
        assert_eq!(
            findings
                .iter()
                .map(|f| f.evidence.as_ref().unwrap().positions.len())
                .sum::<usize>(),
            4000
        );
        assert!(analysis.issues.is_empty());
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
        println!(
            "{{\"corpusBytes\":{},\"blocks\":4000,\"groups\":100,\"inventoryMs\":{},\"analysisMs\":{},\"metadataBytes\":{},\"sourceWrites\":0}}",
            text.len(),
            inventory_ms,
            analysis_ms,
            serde_json::to_vec(&analysis.findings).unwrap().len()
        );
    }
}
