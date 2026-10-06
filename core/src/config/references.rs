//! Markdown resources: bounded existence checks, never resource execution or content reads.
use crate::{config_dto::Item, optimize_dto::*};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Default)]
pub(crate) struct Assessment {
    pub complete: bool,
    pub findings: Vec<Finding>,
    pub reasons: Vec<String>,
}
pub(super) struct Budget {
    remaining: usize,
    cache: BTreeMap<(PathBuf, Option<&'static str>), &'static str>,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            remaining: 4096,
            cache: BTreeMap::new(),
        }
    }
}
fn authorized(path: &Path, roots: &[String]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}
pub(super) fn target_status(
    base: &Path,
    target: &str,
    expected: Option<&str>,
    roots: &[String],
) -> &'static str {
    let path = Path::new(target);
    let mut current;
    let relative;
    if path.is_absolute() {
        let Some(root) = roots
            .iter()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| Path::new(root).components().count())
        else {
            return "referenceOutsideScope";
        };
        current = PathBuf::from(root);
        relative = path.strip_prefix(root).unwrap();
    } else {
        current = base.to_path_buf();
        relative = path;
    }
    if !authorized(&current, roots) {
        return "referenceOutsideScope";
    }
    // Resolve components in filesystem order: lexical normalization would change
    // symlink/../ semantics. A missing parent is not permission to traverse elsewhere.
    let components = relative.components().count();
    if components > 128 {
        return "referenceResourceLimited";
    }
    let mut missing = false;
    for (index, component) in relative.components().enumerate() {
        match component {
            Component::CurDir => (),
            Component::ParentDir => {
                current.pop();
            }
            Component::Normal(name) => {
                current.push(name);
                if missing {
                    if !authorized(&current, roots) {
                        return "referenceOutsideScope";
                    }
                    continue;
                }
                match fs::symlink_metadata(&current) {
                    Ok(_) => match dunce::canonicalize(&current) {
                        Ok(path) => current = path,
                        Err(_) => return "referenceTargetUnreadable",
                    },
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => missing = true,
                    Err(e) if e.kind() == std::io::ErrorKind::NotADirectory => {
                        return "referenceTargetTypeMismatch";
                    }
                    Err(_) => return "referenceTargetUnreadable",
                }
            }
            _ => return "referenceUnsupportedPath",
        }
        if !authorized(&current, roots) {
            return "referenceOutsideScope";
        }
        if !missing && index + 1 < components {
            match fs::metadata(&current) {
                Ok(metadata) if !metadata.is_dir() => return "referenceTargetTypeMismatch",
                Err(_) => return "referenceTargetUnreadable",
                _ => (),
            }
        }
    }
    if missing {
        return "referenceTargetMissing";
    }
    // Path::components removes trailing / and /.; the OS still requires a directory there.
    let directory_syntax = target.ends_with('/')
        || target.ends_with("/.")
        || (cfg!(windows) && (target.ends_with('\\') || target.ends_with("\\.")));
    match fs::metadata(&current) {
        Ok(metadata) if directory_syntax && !metadata.is_dir() => "referenceTargetTypeMismatch",
        Ok(metadata)
            if (expected == Some("file") && !metadata.is_file())
                || (expected == Some("directory") && !metadata.is_dir()) =>
        {
            "referenceTargetTypeMismatch"
        }
        Ok(metadata) if metadata.is_file() && fs::File::open(&current).is_err() => {
            "referenceTargetUnreadable"
        }
        Ok(metadata) if metadata.is_dir() && fs::read_dir(&current).is_err() => {
            "referenceTargetUnreadable"
        }
        Ok(_) => "present",
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "referenceTargetMissing",
        Err(e) if e.kind() == std::io::ErrorKind::NotADirectory => "referenceTargetTypeMismatch",
        Err(_) => "referenceTargetUnreadable",
    }
}
fn external(target: &str) -> bool {
    if target.starts_with("//") {
        return true;
    }
    target.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty()
            && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
            && !(scheme.len() == 1
                && target
                    .as_bytes()
                    .get(2)
                    .is_some_and(|b| matches!(b, b'/' | b'\\')))
    })
}
pub(super) fn check(
    item: &Item,
    body: &str,
    offset: usize,
    full: &str,
    roots: &[String],
    budget: &mut Budget,
) -> Assessment {
    let mut result = Assessment {
        complete: true,
        ..Default::default()
    };
    let Some(base) = Path::new(&item.path).parent() else {
        result.complete = false;
        return result;
    };
    let newlines: Vec<_> = full
        .bytes()
        .enumerate()
        .filter_map(|(i, b)| (b == b'\n').then_some(i))
        .collect();
    let mut excluded = 0usize;
    let mut failures = vec![];
    for (event, range) in Parser::new(body).into_offset_iter() {
        match event {
            Event::Start(Tag::BlockQuote(_) | Tag::CodeBlock(_) | Tag::HtmlBlock) => {
                excluded += 1;
                continue;
            }
            Event::End(TagEnd::BlockQuote(_) | TagEnd::CodeBlock | TagEnd::HtmlBlock) => {
                excluded = excluded.saturating_sub(1);
                continue;
            }
            _ => (),
        }
        let (destination, image) = match event {
            Event::Start(Tag::Link { dest_url, .. }) => (dest_url, false),
            Event::Start(Tag::Image { dest_url, .. }) => (dest_url, true),
            _ => continue,
        };
        if excluded > 0 || external(&destination) {
            continue;
        }
        let target = destination.split(['#', '?']).next().unwrap_or("");
        if target.is_empty() {
            continue;
        } // Anchors have no resource existence claim.
        let decoded = match percent_encoding::percent_decode_str(target).decode_utf8() {
            Ok(value) => value,
            Err(_) => {
                result.complete = false;
                if !result
                    .reasons
                    .iter()
                    .any(|r| r == "referenceUnsupportedEncoding")
                {
                    result.reasons.push("referenceUnsupportedEncoding".into());
                }
                continue;
            }
        };
        if decoded.len() > 4096
            || decoded
                .chars()
                .any(|c| c.is_control() || matches!(c, '$' | '{' | '}' | '~' | '*' | '`'))
        {
            result.complete = false;
            if !result
                .reasons
                .iter()
                .any(|r| r == "referenceDynamicOrUnsupported")
            {
                result.reasons.push("referenceDynamicOrUnsupported".into());
            }
            continue;
        }
        let expected = if image || Path::new(decoded.as_ref()).extension().is_some() {
            Some("file")
        } else if decoded.ends_with('/') {
            Some("directory")
        } else {
            None
        };
        let key = (base.join(decoded.as_ref()), expected);
        let status = if let Some(status) = budget.cache.get(&key) {
            *status
        } else if budget.remaining == 0 {
            "referenceResourceLimited"
        } else {
            budget.remaining -= 1;
            let status = target_status(base, &decoded, expected, roots);
            budget.cache.insert(key, status);
            status
        };
        if status == "present" {
            continue;
        }
        if !matches!(
            status,
            "referenceTargetMissing" | "referenceTargetTypeMismatch"
        ) {
            result.complete = false;
            if !result.reasons.iter().any(|r| r == status) {
                result.reasons.push(status.into());
            }
            continue;
        }
        if failures.len() >= 256 {
            result.complete = false;
            result.reasons.push("referenceResourceLimited".into());
            break;
        }
        let start = offset + range.start;
        let end = offset + range.end;
        failures.push(ReferenceEvidence {
            target: decoded.into_owned(),
            base_directory: base.to_string_lossy().into(),
            expected_type: expected.map(str::to_owned),
            status: status.into(),
            start_byte: start,
            end_byte: end,
            start_line: newlines.partition_point(|i| *i < start) + 1,
            end_line: newlines.partition_point(|i| *i < end.saturating_sub(1)) + 1,
        });
    }
    if !failures.is_empty() {
        let codes = failures
            .iter()
            .map(|r| r.status.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        result.findings.push(Finding {
            identity: Default::default(),
            rule: "localReference".into(),
            status: "failed".into(),
            observed: Some(failures.len() as u64),
            threshold: None,
            evidence_codes: codes,
            basis: Some("authorizedMarkdownResources".into()),
            evidence: Some(StaticEvidence {
                hook: None,
                method: "pulldown-cmark-0.13.4/markdown-resources-v1".into(),
                applicability: "authorizedCurrentConfigurationOnly".into(),
                declaration_hash: None,
                relation_id: None,
                direction: None,
                transform: None,
                relation: None,
                versions: vec![FileVersion {
                    item_id: item.id.clone(),
                    path: item.path.clone(),
                    content_hash: item.content_hash.clone(),
                }],
                positions: vec![],
                references: failures,
            }),
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(root: &Path, relative: &str, text: &str) -> Item {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        let path = dunce::canonicalize(path).unwrap();
        let source = crate::adapters::contract::SourceInstance {
            id: "synthetic".into(),
            agent_kind: "codex".into(),
            root: root.to_string_lossy().into(),
        };
        super::super::scan::scan(&[source], &[root.to_string_lossy().into()], "now")
            .items
            .into_iter()
            .find(|i| i.path == path.to_string_lossy())
            .unwrap()
    }
    fn assess(root: &Path, text: &str) -> Assessment {
        let row = item(root, "child/AGENTS.md", text);
        check(
            &row,
            text,
            0,
            text,
            &[root.to_string_lossy().into()],
            &mut Budget::default(),
        )
    }
    #[test]
    fn explicit_links_keep_offsets_and_decode_paths_without_reading_examples() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        fs::write(root.join("文件 space.md"), "Synthetic resource").unwrap();
        fs::create_dir(root.join("references")).unwrap();
        let text = "[存在](../%E6%96%87%E4%BB%B6%20space.md#anchor)\n\n[目录](../references/)\n\n[缺失](missing.md#anchor)\n\n![错误类型](../references/)\n\n[外部](https://example.invalid/missing.md) [片段](#missing)\n\n`[代码](missing-code.md)`\n\n```md\n[示例](example.md)\n```\n\n> [引用示例](quote.md)\n";
        let result = assess(&root, text);
        assert!(result.complete);
        let finding = &result.findings[0];
        assert_eq!(finding.observed, Some(2));
        assert_eq!(
            finding.evidence_codes,
            ["referenceTargetMissing", "referenceTargetTypeMismatch"]
        );
        let references = &finding.evidence.as_ref().unwrap().references;
        assert_eq!(references[0].target, "missing.md");
        assert_eq!(references[0].start_line, 5);
        assert!(text[references[0].start_byte..references[0].end_byte].starts_with("[缺失]"));
        assert_eq!(references[1].expected_type.as_deref(), Some("file"));
    }
    #[test]
    fn dynamic_outside_and_budget_gaps_never_become_missing_or_passed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let text = "[动态]($ROOT/file.md)\n\n[范围外](../../outside.md)\n";
        let result = assess(&root, text);
        assert!(!result.complete);
        assert!(result.findings.is_empty());
        assert_eq!(
            result.reasons,
            ["referenceDynamicOrUnsupported", "referenceOutsideScope"]
        );
        let row = item(&root, "AGENTS.md", "[资源](a.md)\n\n[另一资源](b.md)\n");
        let body = fs::read_to_string(&row.path).unwrap();
        let mut budget = Budget {
            remaining: 1,
            cache: BTreeMap::new(),
        };
        let first = check(
            &row,
            &body,
            0,
            &body,
            &[root.to_string_lossy().into()],
            &mut budget,
        );
        assert!(!first.complete);
        assert_eq!(first.findings[0].observed, Some(1));
        assert_eq!(first.reasons, ["referenceResourceLimited"]);
        // The same target reuses one existence observation and cannot consume unbounded I/O.
        let repeated = check(
            &row,
            "[一](a.md)\n\n[二](a.md)\n",
            0,
            "[一](a.md)\n\n[二](a.md)\n",
            &[root.to_string_lossy().into()],
            &mut budget,
        );
        assert!(repeated.complete);
        assert_eq!(repeated.findings[0].observed, Some(2));
    }
    #[cfg(unix)]
    #[test]
    fn symlink_boundaries_and_parent_components_follow_real_filesystem_semantics() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("inside.md"), "Synthetic").unwrap();
        symlink(root.join("nested"), root.join("alias")).unwrap();
        symlink(outside.path(), root.join("escape")).unwrap();
        assert_eq!(
            target_status(
                &root,
                "alias/../inside.md",
                Some("file"),
                &[root.to_string_lossy().into()]
            ),
            "present"
        );
        assert_eq!(
            target_status(
                &root,
                "escape/missing.md",
                Some("file"),
                &[root.to_string_lossy().into()]
            ),
            "referenceOutsideScope"
        );
        symlink(root.join("missing.md"), root.join("dangling.md")).unwrap();
        assert_eq!(
            target_status(
                &root,
                "dangling.md",
                Some("file"),
                &[root.to_string_lossy().into()]
            ),
            "referenceTargetUnreadable"
        );
    }
    #[test]
    fn a_missing_parent_is_not_lexically_erased_into_a_present_resource() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        fs::write(root.join("inside.md"), "Synthetic").unwrap();
        assert_eq!(
            target_status(
                &root,
                "missing/../inside.md",
                Some("file"),
                &[root.to_string_lossy().into()]
            ),
            "referenceTargetMissing"
        );
        assert_eq!(
            target_status(
                &root,
                "inside.md/child.md",
                Some("file"),
                &[root.to_string_lossy().into()]
            ),
            "referenceTargetTypeMismatch"
        );
    }
}
