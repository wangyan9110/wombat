//! Bounded dependency fingerprints over related collected facts, never bodies or global revisions.
use super::*;

impl Analysis {
    /// Scoped safe dependencies, including declared peers of a successful empty check.
    /// Oversized metadata disables reuse; it never becomes a successful empty analysis.
    pub(crate) fn rule_dependency_revision(
        &self,
        rule: &str,
        item: &Item,
        items: &[Item],
        projects: &[&str],
        limit: usize,
    ) -> Option<String> {
        const MAX_ROWS: usize = 1024;
        const MAX_CANDIDATES: usize = 4096;
        let limit = limit.min(128 * 1024);
        if projects.len() > MAX_ROWS
            || item.source_contexts.len() > MAX_ROWS
            || item.authorized_projects.len() > MAX_ROWS
        {
            return None;
        }
        let kind = match rule {
            "exactInstructionBlocks" => Some(RelationKind::Chain),
            "declaredCopyDrift" => Some(RelationKind::Copy),
            _ => None,
        };
        if kind.is_some() && self.relations.len() > MAX_CANDIDATES {
            return None;
        }
        let sources: BTreeSet<_> = item.source_ids().collect();
        let global = if item.source_contexts.is_empty() {
            item.project.is_none()
        } else {
            item.source_contexts.iter().any(|context| context.global)
        };
        let authorized: BTreeSet<_> = item
            .authorized_projects
            .iter()
            .map(String::as_str)
            .chain(item.project.as_deref())
            .collect();
        let selected: BTreeSet<_> = projects.iter().copied().collect();
        let relations: Vec<_> = self
            .relations
            .iter()
            .filter(|(key, state)| {
                kind.as_ref() == Some(&key.kind)
                    && match state {
                        RelationAssessment::Complete(members) => members.contains(&item.id),
                        RelationAssessment::Unknown => {
                            sources.contains(key.source_instance_id.as_str())
                                && (global || authorized.contains(key.project.as_str()))
                                && (selected.is_empty() || selected.contains(key.project.as_str()))
                        }
                    }
            })
            .take(if kind.is_some() { MAX_ROWS + 1 } else { 0 })
            .collect();
        if relations.len() > MAX_ROWS {
            return None;
        }
        let object_findings = self.findings.get(&item.id).map_or(&[][..], Vec::as_slice);
        if object_findings.len() > MAX_ROWS {
            return None;
        }
        let findings: Vec<_> = object_findings
            .iter()
            .filter(|finding| {
                finding.rule == rule
                    && finding
                        .evidence
                        .as_ref()
                        .and_then(|e| e.hook.as_ref())
                        .is_none_or(|hook| projects.contains(&hook.project.as_str()))
            })
            .take(MAX_ROWS + 1)
            .collect();
        if findings.len() > MAX_ROWS {
            return None;
        }
        let mut members = BTreeSet::from([item.id.as_str()]);
        for (_, state) in &relations {
            if let RelationAssessment::Complete(ids) = state {
                if ids.len() > MAX_ROWS {
                    return None;
                }
                for id in ids {
                    members.insert(id.as_str());
                    if members.len() > MAX_ROWS {
                        return None;
                    }
                }
            }
        }
        for finding in &findings {
            if let Some(evidence) = &finding.evidence {
                if evidence.versions.len() > MAX_ROWS {
                    return None;
                }
                for version in &evidence.versions {
                    members.insert(version.item_id.as_str());
                    if members.len() > MAX_ROWS {
                        return None;
                    }
                }
            }
        }
        // One capped inventory pass for referenced peers, never one full pass per peer.
        let mut peer_index = BTreeMap::from([(item.id.as_str(), item)]);
        if members.len() > 1 {
            for peer in items.iter().take(MAX_CANDIDATES) {
                if members.contains(peer.id.as_str()) {
                    peer_index.insert(peer.id.as_str(), peer);
                }
                if peer_index.len() == members.len() {
                    break;
                }
            }
            if peer_index.len() != members.len() && items.len() > MAX_CANDIDATES {
                return None;
            }
        }
        let peers: Vec<_> = members
            .into_iter()
            .map(|id| {
                let peer = peer_index.get(id);
                (
                    id,
                    self.assessed.contains(id),
                    peer.map(|peer| {
                        (
                            &peer.path,
                            &peer.content_hash,
                            &peer.measurement_status,
                            peer.current,
                            peer.stale,
                        )
                    }),
                )
            })
            .collect();
        let reference = (rule == "localReference")
            .then(|| self.reference_checks.get(&item.id))
            .flatten()
            .map(|assessment| {
                (
                    assessment.complete,
                    &assessment.findings,
                    &assessment.reasons,
                )
            });
        let hooks: Vec<_> = if rule == "hookTarget" {
            projects
                .iter()
                .map(|project| {
                    (
                        project,
                        self.hook_checks.get(&(item.id.clone(), (*project).into())),
                    )
                })
                .collect()
        } else {
            vec![]
        };
        let mut writer = DependencyWriter {
            bytes: 0,
            limit,
            hash: sha2::Sha256::default(),
        };
        serde_json::to_writer(
            &mut writer,
            &(
                "rule-analysis-dependencies-v1",
                rule,
                relations,
                findings,
                peers,
                reference,
                hooks,
            ),
        )
        .ok()?;
        use sha2::Digest;
        Some(format!("{:x}", writer.hash.finalize()))
    }
}
struct DependencyWriter {
    bytes: usize,
    limit: usize,
    hash: sha2::Sha256,
}
impl std::io::Write for DependencyWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes) {
            return Err(std::io::Error::other(
                "analysis dependency encoding budget exceeded",
            ));
        }
        self.bytes += bytes.len();
        use sha2::Digest;
        self.hash.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
