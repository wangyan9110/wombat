//! A fixed reference encoding measures current content, never historical consumption.
use super::super::config_dto::{ContentEstimate, SkillMetadata};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};

pub(super) const METHOD: &str = "tiktoken-rs-0.12.0/o200k_base/ordinary-v1";
pub(super) const ESTIMATE_FILE_LIMIT: usize = 1024 * 1024;
pub(super) const ESTIMATE_ROUND_LIMIT: usize = 8 * 1024 * 1024;
const CACHE_ENTRIES: usize = 2048;
type Cache = (HashMap<String, u64>, VecDeque<String>);

pub(super) fn estimate(text: &str, hash: &str) -> Option<ContentEstimate> {
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
    let invalid = |code: &str| SkillMetadata {
        status: "invalid".into(),
        description_characters: None,
        issues: vec![code.into()],
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
                },
                None,
            );
        }
        header.push_str(line);
    }
    if !closed {
        return (invalid("frontMatterUnclosed"), None);
    }
    #[derive(serde::Deserialize)]
    struct Header {
        name: String,
        description: String,
    }
    let options = serde_saphyr::options! { with_snippet: false, reject_unsupported_tags: true, no_schema: true, budget: serde_saphyr::budget! {
        max_events: 10_000, max_aliases: 0, max_depth: 32, max_total_scalar_bytes: 64 * 1024,
    }};
    let header = match serde_saphyr::from_str_with_options::<Header>(&header, options) {
        Ok(header) => header,
        Err(serde_saphyr::Error::Budget { .. }) => {
            return (
                SkillMetadata {
                    status: "resourceLimited".into(),
                    description_characters: None,
                    issues: vec![],
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
                },
                None,
            );
        }
        Err(_) => return (invalid("frontMatterInvalid"), None),
    };
    let mut issues = vec![];
    if header.name.trim().is_empty() {
        issues.push("nameMissing".into());
    }
    if header.name.chars().count() > 64 {
        issues.push("nameTooLong".into());
    }
    if header.description.trim().is_empty() {
        issues.push("descriptionMissing".into());
    }
    let description_characters = Some(header.description.chars().count() as u64);
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
            issues,
        },
        body,
    )
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
}
