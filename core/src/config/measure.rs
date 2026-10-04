//! A fixed reference encoding measures current content, never historical consumption.
use super::super::config_dto::{ContentEstimate, SkillMetadata};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use unicode_normalization::UnicodeNormalization;

pub(super) const METHOD: &str = "tiktoken-rs-0.12.0/o200k_base/ordinary-v1";
pub(super) const ESTIMATE_FILE_LIMIT: usize = 1024 * 1024;
pub(super) const ESTIMATE_ROUND_LIMIT: usize = 8 * 1024 * 1024;
const CACHE_ENTRIES: usize = 2048;
type Cache = (HashMap<String, u64>, VecDeque<String>);

pub(crate) fn estimate(text: &str, hash: &str) -> Option<ContentEstimate> {
    if text.len() > ESTIMATE_FILE_LIMIT {
        return None;
    }
    static BPE: OnceLock<Result<tiktoken_rs::CoreBPE, String>> = OnceLock::new();
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new((HashMap::new(), VecDeque::new())));
    let key = format!("{METHOD}:{hash}");
    let cached = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .0
        .get(&key)
        .copied();
    let count = match cached {
        Some(count) => count,
        None => {
            let bpe = BPE
                .get_or_init(|| tiktoken_rs::o200k_base().map_err(|e| e.to_string()))
                .as_ref()
                .ok()?;
            // An empty special-token set treats token-looking content as ordinary text.
            let count = bpe.encode(text, &HashSet::new()).ok()?.0.len() as u64;
            let mut state = cache.lock().unwrap_or_else(|e| e.into_inner());
            if !state.0.contains_key(&key) {
                while state.0.len() >= CACHE_ENTRIES {
                    if let Some(old) = state.1.pop_front() {
                        state.0.remove(&old);
                    }
                }
                state.0.insert(key.clone(), count);
                state.1.push_back(key);
            }
            count
        }
    };
    Some(ContentEstimate {
        tokens: count,
        encoding: "o200k_base".into(),
        method: METHOD.into(),
        payload: "completeUtf8File".into(),
        content_hash: hash.into(),
        applicability: "referenceEncodingOnly".into(),
        tokenizer_version: Some("tiktoken-rs-0.12.0".into()),
    })
}

pub(super) fn skill_with_body(text: &str) -> (SkillMetadata, Option<&str>) {
    skill_in_directory(text, None)
}

/// Validate the measured entry, without retaining metadata values or treating host extensions
/// as standard fields. Directory comparison is omitted when entry identity is unverified.
pub(super) fn skill_in_directory<'a>(
    text: &'a str,
    directory: Option<&str>,
) -> (SkillMetadata, Option<&'a str>) {
    let diagnostic = |code: &str| skill_diagnostic(text, code);
    let invalid = |code: &str| SkillMetadata {
        status: "invalid".into(),
        description_characters: None,
        issues: vec![code.into()],
        diagnostics: vec![diagnostic(code)],
    };
    let mut lines = text.split_inclusive('\n');
    if lines.next().map(str::trim_end) != Some("---") {
        return (invalid("frontMatterMissing"), None);
    }
    let mut header = String::new();
    let mut closed = false;
    let mut body_start = text.split_inclusive('\n').next().unwrap().len();
    for line in lines {
        body_start += line.len();
        if line.trim_end() == "---" {
            closed = true;
            break;
        }
        if header.len() + line.len() > 64 * 1024 {
            return (
                SkillMetadata {
                    status: "resourceLimited".into(),
                    description_characters: None,
                    issues: vec![],
                    diagnostics: vec![],
                },
                None,
            );
        }
        header.push_str(line);
    }
    if !closed {
        return (invalid("frontMatterUnclosed"), None);
    }
    let options = serde_saphyr::options! { with_snippet: false, reject_unsupported_tags: true,
        duplicate_keys: serde_saphyr::DuplicateKeyPolicy::Error,
        budget: serde_saphyr::budget! {
        max_events: 10_000, max_aliases: 0, max_depth: 32, max_total_scalar_bytes: 64 * 1024,
    }};
    let header = match serde_saphyr::from_str_with_options::<
        std::collections::BTreeMap<String, serde_json::Value>,
    >(&header, options)
    {
        Ok(header) => header,
        Err(serde_saphyr::Error::Budget { .. }) => {
            return (
                SkillMetadata {
                    status: "resourceLimited".into(),
                    description_characters: None,
                    issues: vec![],
                    diagnostics: vec![],
                },
                None,
            );
        }
        Err(serde_saphyr::Error::UnsupportedTag { .. }) => {
            return (
                SkillMetadata {
                    status: "unsupported".into(),
                    description_characters: None,
                    issues: vec![],
                    diagnostics: vec![],
                },
                None,
            );
        }
        Err(_) => return (invalid("frontMatterInvalid"), None),
    };
    let mut issues = vec![];
    match header.get("name") {
        None => issues.push("nameMissing".into()),
        Some(serde_json::Value::String(name)) if !name.trim().is_empty() => {
            // Bound to the official Agent Skills reference name validator: trim, NFKC,
            // Unicode code points, Unicode lowercase/alphanumeric, and directory match.
            let name: String = name.trim().nfkc().collect();
            if name.chars().count() > 64 {
                issues.push("nameTooLong".into());
            }
            if name != name.to_lowercase()
                || name.starts_with('-')
                || name.ends_with('-')
                || name.contains("--")
                || !name.chars().all(|c| c.is_alphanumeric() || c == '-')
            {
                issues.push("nameInvalid".into());
            }
            if directory.is_some_and(|dir| dir.nfkc().collect::<String>() != name) {
                issues.push("nameDirectoryMismatch".into());
            }
        }
        Some(serde_json::Value::String(_)) => issues.push("nameMissing".into()),
        Some(_) => issues.push("nameTypeInvalid".into()),
    }
    let description_characters = match header.get("description") {
        None => {
            issues.push("descriptionMissing".into());
            None
        }
        Some(serde_json::Value::String(value)) => {
            if value.trim().is_empty() {
                issues.push("descriptionMissing".into());
            }
            Some(value.chars().count() as u64)
        }
        Some(_) => {
            issues.push("descriptionTypeInvalid".into());
            None
        }
    };
    // Overlong description remains a separate, exclusive standard branch in optimize.
    for field in ["license", "allowed-tools", "compatibility"] {
        if let Some(value) = header.get(field) {
            if !value.is_string() {
                issues.push(format!("{field}TypeInvalid"));
            } else if field == "compatibility" && value.as_str().unwrap().chars().count() > 500 {
                issues.push("compatibilityTooLong".into());
            }
        }
    }
    if let Some(value) = header.get("metadata")
        && !value
            .as_object()
            .is_some_and(|fields| fields.values().all(|v| v.is_string()))
    {
        issues.push("metadataTypeInvalid".into());
    }
    let body = issues.is_empty().then_some(&text[body_start..]);
    (
        SkillMetadata {
            status: if issues.is_empty() {
                "parsed"
            } else {
                "invalid"
            }
            .into(),
            description_characters,
            diagnostics: issues.iter().map(|code| diagnostic(code)).collect(),
            issues,
        },
        body,
    )
}

fn skill_diagnostic(text: &str, code: &str) -> crate::config_dto::SkillDiagnostic {
    let field = match code {
        value if value.starts_with("name") => Some("name"),
        value if value.starts_with("description") => Some("description"),
        value if value.starts_with("license") => Some("license"),
        value if value.starts_with("allowed-tools") => Some("allowed-tools"),
        value if value.starts_with("compatibility") => Some("compatibility"),
        value if value.starts_with("metadata") => Some("metadata"),
        _ => None,
    };
    let mut located = field.and_then(|field| {
        text.lines().enumerate().find_map(|(index, line)| {
            let trimmed = line.trim_start();
            (trimmed.starts_with(&format!("{field}:"))
                || trimmed.starts_with(&format!("{field}：")))
            .then(|| (index + 1, line))
        })
    });
    if code == "frontMatterInvalid" && located.is_none() {
        located = text.lines().enumerate().find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.contains('：')
                || (!trimmed.is_empty() && trimmed != "---" && !trimmed.contains(':')))
            .then(|| (index + 1, line))
        });
    }
    if code == "frontMatterMissing" {
        located = text.lines().next().map(|line| (1, line));
    }
    let structural_line = |value: &str| {
        value.find([':', '：']).and_then(|column| {
            value[column..]
                .chars()
                .next()
                .map(|delimiter| format!("{}{} <value>", &value[..column], delimiter))
        })
    };
    let current = located.and_then(|(_, line)| structural_line(line));
    let reported_field = field.map(str::to_owned).or_else(|| {
        located.and_then(|(_, line)| {
            line.find([':', '：'])
                .map(|column| line[..column].trim())
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
    });
    let expected = match code {
        "frontMatterMissing" => Some("---".into()),
        "frontMatterUnclosed" => Some("--- (closing delimiter)".into()),
        "frontMatterInvalid" => reported_field
            .as_deref()
            .map(|field| format!("{field}: <value>"))
            .or_else(|| Some("field: <value>".into())),
        "nameMissing" => Some("name: skill-name".into()),
        "nameTypeInvalid" | "nameInvalid" | "nameTooLong" | "nameDirectoryMismatch" => {
            Some("name: lowercase-skill-name".into())
        }
        "descriptionMissing" | "descriptionTypeInvalid" => {
            Some("description: A concise description".into())
        }
        "licenseTypeInvalid" => Some("license: MIT".into()),
        "allowed-toolsTypeInvalid" => Some("allowed-tools: Read Bash".into()),
        "compatibilityTypeInvalid" | "compatibilityTooLong" => Some("compatibility: local".into()),
        "metadataTypeInvalid" => Some("metadata:\n  key: 'value'".into()),
        _ => None,
    };
    crate::config_dto::SkillDiagnostic {
        code: code.into(),
        field: reported_field,
        line: located.map(|(line, _)| line),
        column: located.and_then(|(_, line)| line.find([':', '：']).map(|column| column + 1)),
        current,
        expected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn skill(text: &str) -> SkillMetadata {
        skill_with_body(text).0
    }
    #[test]
    fn matches_official_tiktoken_013_ordinary_vectors() {
        // Generated from upstream 0.13.0 using synthetic text, not this implementation.
        for (text, expected) in [
            ("", 0),
            ("hello world", 2),
            ("你好，世界！", 4),
            ("e\u{301}😀\r\n", 4),
            ("<|endoftext|>", 7),
            ("const value = 42; // 合成\n", 10),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 4),
            (
                "---\nname: sample\ndescription: Synthetic skill\n---\n# Instructions\nUse exact evidence.\n",
                18,
            ),
        ] {
            let result = estimate(text, &crate::hash(text)).unwrap();
            assert_eq!(result.tokens, expected, "{text:?}");
        }
    }
    #[test]
    fn metadata_is_parsed_without_saving_fields_or_following_includes() {
        let m = skill("---\nname: synth\ndescription: |\n  你好😀\n  line\n---\nbody");
        assert_eq!(m.status, "parsed");
        assert_eq!(m.description_characters, Some(9));
        assert_eq!(
            skill("---\nname: one\nname: two\ndescription: text\n---\n").status,
            "invalid"
        );
        assert_eq!(
            skill("---\nname: synth\ndescription: !include secret.yaml\n---\n").status,
            "unsupported"
        );
        assert_eq!(
            skill("---\nname: synth\ndescription: &x value\nother: *x\n---\n").status,
            "resourceLimited"
        );
        assert_eq!(skill("no header").issues, ["frontMatterMissing"]);
        let mut metadata = skill("---\nname: synth\ndescription： wrong\n---\n");
        let diagnostic = metadata.diagnostics.remove(0);
        assert_eq!(diagnostic.line, Some(3));
        assert_eq!(diagnostic.field.as_deref(), Some("description"));
        assert_eq!(diagnostic.current.as_deref(), Some("description： <value>"));
        assert_eq!(diagnostic.expected.as_deref(), Some("description: <value>"));
        assert!(
            skill("---\nname: synth\ndescription: [wrong]\n---\n")
                .description_characters
                .is_none()
        );
    }
    #[test]
    fn content_change_and_limit_are_explicit() {
        assert_ne!(
            estimate("hello", &crate::hash("hello"))
                .unwrap()
                .content_hash,
            estimate("hello\n", &crate::hash("hello\n"))
                .unwrap()
                .content_hash
        );
        assert!(estimate(&"a".repeat(ESTIMATE_FILE_LIMIT + 1), "large").is_none());
    }
    #[test]
    fn body_is_an_exact_independently_encoded_slice() {
        let body = "\n  hello world\r\n\n";
        let text = format!(
            "---\r\nname: sample\r\ndescription: {}\r\n---\r\n{body}",
            "字".repeat(501)
        );
        let (metadata, parsed) = skill_with_body(&text);
        assert_eq!(metadata.status, "parsed");
        assert_eq!(parsed, Some(body));
        // Official tiktoken 0.13.0 ordinary encoding, independently generated.
        assert_eq!(
            estimate(parsed.unwrap(), &crate::hash(body))
                .unwrap()
                .tokens,
            5
        );
        assert_eq!(
            skill_with_body("---\nname: sample\ndescription: valid\n---").1,
            Some("")
        );
        for text in [
            "invalid",
            "---\nname: []\ndescription: valid\n---\nbody",
            "---\nname: sample\ndescription: !include file\n---\nbody",
        ] {
            assert!(skill_with_body(text).1.is_none());
        }
        for n in [4999, 5000] {
            let body = format!("{}x", "x ".repeat(n - 1));
            assert_eq!(
                estimate(&body, &crate::hash(&body)).unwrap().tokens,
                n as u64
            );
        }
    }
    #[test]
    fn names_follow_reference_unicode_normalization_and_entry_identity() {
        for (name, directory) in [
            ("中文技能", "中文技能"),
            ("ｆｏｏ-２", "foo-2"),
            ("a\u{301}", "á"),
            (" sample ", "sample"),
            ("²", "2"),
        ] {
            let text = format!("---\nname: '{name}'\ndescription: Synthetic\n---\nbody");
            assert_eq!(
                skill_in_directory(&text, Some(directory)).0.status,
                "parsed",
                "{name}"
            );
        }
        for name in [
            "Upper",
            "-edge",
            "edge-",
            "two--parts",
            "with space",
            "emoji😀",
        ] {
            let text = format!("---\nname: '{name}'\ndescription: Synthetic\n---\nbody");
            assert!(
                skill(&text).issues.contains(&"nameInvalid".into()),
                "{name}"
            );
        }
        let text = "---\nname: sample\ndescription: Synthetic\n---\nbody";
        assert_eq!(
            skill_in_directory(text, Some("different")).0.issues,
            ["nameDirectoryMismatch"]
        );
        assert_eq!(skill_in_directory(text, None).0.status, "parsed");
        for (n, status) in [(64, "parsed"), (65, "invalid")] {
            let text = format!(
                "---\nname: {}\ndescription: Synthetic\n---\n",
                "字".repeat(n)
            );
            assert_eq!(skill(&text).status, status);
        }
    }
    #[test]
    fn optional_fields_are_typed_without_rejecting_unknown_host_extensions() {
        let prefix = "---\nname: sample\ndescription: Synthetic\n";
        let valid = format!(
            "{prefix}license: MIT\nallowed-tools: Read Bash\ncompatibility: local\nmetadata:\n  label: 'true'\nhost-extension:\n  enabled: true\n---\nbody"
        );
        assert_eq!(skill(&valid).status, "parsed");
        for (fields, issue) in [
            ("license: [MIT]\n", "licenseTypeInvalid"),
            ("allowed-tools: [Read]\n", "allowed-toolsTypeInvalid"),
            ("compatibility: true\n", "compatibilityTypeInvalid"),
            ("metadata:\n  label: 123\n", "metadataTypeInvalid"),
            ("metadata: []\n", "metadataTypeInvalid"),
        ] {
            let text = format!("{prefix}{fields}---\nbody");
            assert_eq!(skill(&text).issues, [issue]);
            assert!(skill_with_body(&text).1.is_none());
        }
        let too_long = format!("{prefix}compatibility: {}\n---\n", "字".repeat(501));
        assert_eq!(skill(&too_long).issues, ["compatibilityTooLong"]);
        for fields in [
            "name: true\ndescription: text\n",
            "name: sample\ndescription: 12\n",
            "name: sample\ndescription: text\nmetadata:\n  label: a\n  label: b\n",
        ] {
            let text = format!("---\n{fields}---\nbody");
            assert_eq!(skill(&text).status, "invalid");
        }
        let long_description = format!(
            "---\nname: sample\ndescription: {}\n---\n",
            "😀".repeat(1025)
        );
        let metadata = skill(&long_description);
        assert_eq!(metadata.status, "parsed");
        assert_eq!(metadata.description_characters, Some(1025));
    }
}
