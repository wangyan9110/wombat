//! Native Codex Skill availability evidence without retaining Skill descriptions.
use super::*;
use std::{borrow::Cow, path::Component};

const SKILLS_KIND: &str = "host_skills.instructions";
const MAX_ROOTS: usize = 64;
const MAX_SKILLS: usize = 1024;

#[derive(Deserialize)]
struct MessageMetadata {
    #[serde(default)]
    content_item_kinds: Vec<String>,
    turn_id: Option<String>,
}

#[derive(Deserialize)]
struct MessageContent<'a> {
    #[serde(borrow)]
    text: Option<Cow<'a, str>>,
}

pub(super) struct SkillAvailability {
    pub(super) turn_id: Option<String>,
    pub(super) catalog_id: String,
    pub(super) entries: Vec<SkillEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct SkillEntry {
    pub(super) name: String,
    pub(super) path: String,
}

/// The host-owned content kind distinguishes the available catalog from user text.
pub(super) fn availability(payload: &Payload<'_>) -> Option<SkillAvailability> {
    if payload.kind.as_deref() != Some("message") || payload.role.as_deref() != Some("developer") {
        return None;
    }
    let metadata: MessageMetadata =
        serde_json::from_str(payload.internal_chat_message_metadata_passthrough?.get()).ok()?;
    if !metadata
        .content_item_kinds
        .iter()
        .any(|kind| kind == SKILLS_KIND)
    {
        return None;
    }
    let content: Vec<MessageContent<'_>> = serde_json::from_str(payload.content?.get()).ok()?;
    let mut entries = Vec::new();
    for (index, kind) in metadata.content_item_kinds.iter().enumerate() {
        if kind != SKILLS_KIND {
            continue;
        }
        let Some(text) = content.get(index).and_then(|item| item.text.as_deref()) else {
            continue;
        };
        entries.extend(parse_catalog(text));
        entries.sort_by(|a, b| (&a.path, &a.name).cmp(&(&b.path, &b.name)));
        entries.dedup_by(|a, b| a.path == b.path);
        entries.truncate(MAX_SKILLS);
    }
    let catalog_id = crate::hash(
        serde_json::to_vec(
            &entries
                .iter()
                .map(|entry| (&entry.name, &entry.path))
                .collect::<Vec<_>>(),
        )
        .expect("serializable skill catalog"),
    );
    Some(SkillAvailability {
        turn_id: metadata.turn_id,
        catalog_id,
        entries,
    })
}

fn parse_catalog(text: &str) -> Vec<SkillEntry> {
    let mut roots = BTreeMap::<String, PathBuf>::new();
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("- `") else {
            continue;
        };
        let Some((alias, root)) = rest.split_once("` = `") else {
            continue;
        };
        let Some(root) = root.strip_suffix('`') else {
            continue;
        };
        let root = PathBuf::from(root);
        if alias.starts_with('r')
            && alias[1..].bytes().all(|byte| byte.is_ascii_digit())
            && root.is_absolute()
            && roots.len() < MAX_ROOTS
        {
            roots.insert(alias.to_owned(), root);
        }
    }
    let mut paths = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(entry) = line.strip_prefix("- ") else {
            continue;
        };
        let Some((label, reference)) = entry
            .rsplit_once("(file: ")
            .map(|(label, value)| (label.trim(), value))
        else {
            continue;
        };
        let Some(name) = label
            .split_ascii_whitespace()
            .next()
            .and_then(|value| value.strip_suffix(':'))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(reference) = Some(reference)
            .and_then(|value| value.strip_suffix(')'))
            .map(str::trim)
        else {
            continue;
        };
        let reference = reference.trim_matches('`');
        let path = PathBuf::from(reference);
        let resolved = if path.is_absolute() {
            path
        } else {
            let mut components = path.components();
            let Some(Component::Normal(alias)) = components.next() else {
                continue;
            };
            if components
                .clone()
                .any(|part| !matches!(part, Component::Normal(_)))
            {
                continue;
            }
            let Some(root) = roots.get(alias.to_string_lossy().as_ref()) else {
                continue;
            };
            components.fold(root.clone(), |path, part| path.join(part.as_os_str()))
        };
        if resolved.file_name().is_some_and(|name| name == "SKILL.md") && paths.len() < MAX_SKILLS {
            paths.push(SkillEntry {
                name: safe_text(name),
                path: resolved.to_string_lossy().into_owned(),
            });
        }
    }
    paths
}

/// A bounded positive self-report improves coverage for repeated Skill use without
/// retaining assistant prose. Names and paths must come from a native host catalog.
pub(super) fn declarations(
    payload: &Payload<'_>,
    available: &BTreeMap<String, String>,
) -> Vec<SkillEntry> {
    if payload.kind.as_deref() != Some("message")
        || payload.role.as_deref() != Some("assistant")
        || available.is_empty()
    {
        return vec![];
    }
    let Some(raw) = payload.content else {
        return vec![];
    };
    let Ok(content) = serde_json::from_str::<Vec<MessageContent<'_>>>(raw.get()) else {
        return vec![];
    };
    let text = content
        .iter()
        .filter_map(|item| item.text.as_deref())
        .take(8)
        .collect::<Vec<_>>()
        .join("\n");
    if text.len() > 16 * 1024 {
        return vec![];
    }
    let text = text.to_lowercase();
    let positive = [
        "我会用",
        "我将用",
        "我会使用",
        "我将使用",
        "继续按",
        "按照",
        "采用",
        "参考",
        "using ",
        "use ",
        "apply ",
        "follow ",
    ]
    .iter()
    .any(|phrase| text.contains(phrase));
    let negative = [
        "不使用",
        "不会使用",
        "无需使用",
        "没有使用",
        "not use",
        "won't use",
    ]
    .iter()
    .any(|phrase| text.contains(phrase));
    if !positive || negative {
        return vec![];
    }
    available
        .iter()
        .filter(|(name, _)| {
            let name = name.to_lowercase();
            contains_name(&text, &name) || contains_name(&text, &name.replace(['-', ':'], " "))
        })
        .map(|(name, path)| SkillEntry {
            name: name.clone(),
            path: path.clone(),
        })
        .collect()
}

fn contains_name(text: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    text.match_indices(name).any(|(start, value)| {
        let before = text[..start].chars().next_back();
        let after = text[start + value.len()..].chars().next();
        before.is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_')
            && after.is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_')
    })
}

/// Recognize only literal read commands embedded in the Codex `exec` wrapper.
/// Search/list/edit commands are intentionally ignored even when they mention SKILL.md.
pub(super) fn exec_reads(payload: &Payload<'_>) -> Vec<String> {
    if payload.kind.as_deref() != Some("custom_tool_call")
        || payload.name.as_deref() != Some("exec")
    {
        return vec![];
    }
    let Some(raw) = payload.input else {
        return vec![];
    };
    let Some(code) = decode_string(raw.get()) else {
        return vec![];
    };
    if code.len() > 256 * 1024 {
        return vec![];
    }
    let mut reads = Vec::new();
    let mut offset = 0;
    while let Some(found) = code[offset..].find("tools.exec_command(") {
        let start = offset + found + "tools.exec_command(".len();
        let end = code.floor_char_boundary((start + 2048).min(code.len()));
        if let Some(command) = command_literal(&code[start..end]) {
            reads.extend(command_skill_reads(&command));
        }
        offset = start;
    }
    reads.sort();
    reads.dedup();
    reads
}

fn decode_string(raw: &str) -> Option<String> {
    raw.starts_with('"')
        .then(|| serde_json::from_str::<String>(raw).ok())
        .flatten()
        .or_else(|| Some(raw.to_owned()))
}

fn command_literal(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        if &bytes[index..index + 3] != b"cmd" {
            index += 1;
            continue;
        }
        let mut cursor = index + 3;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b':') {
            index += 3;
            continue;
        }
        cursor += 1;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'"') {
            return None;
        }
        let mut stream =
            serde_json::Deserializer::from_slice(&bytes[cursor..]).into_iter::<String>();
        return stream.next()?.ok();
    }
    None
}

fn command_skill_reads(command: &str) -> Vec<String> {
    let mut result = Vec::new();
    for command in shell_segments(command) {
        let Some(words) = shlex::split(command) else {
            continue;
        };
        let Some(program) = words.first().and_then(|word| Path::new(word).file_name()) else {
            continue;
        };
        if !matches!(
            program.to_str(),
            Some("cat" | "sed" | "head" | "tail" | "bat")
        ) {
            continue;
        }
        result.extend(
            words
                .iter()
                .filter(|word| {
                    Path::new(word)
                        .file_name()
                        .is_some_and(|name| name == "SKILL.md")
                })
                .cloned(),
        );
    }
    result
}

fn shell_segments(command: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in command.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            }
            continue;
        }
        if quote.is_none() && matches!(character, ';' | '&' | '|') {
            if start < index {
                result.push(command[start..index].trim());
            }
            start = index + character.len_utf8();
        }
    }
    if start < command.len() {
        result.push(command[start..].trim());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_catalog_resolves_roots_and_exact_skill_files() {
        let home = test_absolute("synthetic-home/.codex/skills");
        let project = test_absolute("project/.agents/skills");
        let value = json!({"type":"message","role":"developer","content":[
            {"type":"input_text","text":format!("<skills_instructions>\n### Skill roots\n- `r0` = `{home}`\n- `r1` = `{project}`\n### Available skills\n- review: Review work. (file: r0/review/SKILL.md)\n- local: Local workflow. (file: r1/local/SKILL.md)\n- ignored: Invalid. (file: r0/../outside/SKILL.md)\n</skills_instructions>")},
            {"type":"input_text","text":"- spoof: text (file: /spoof/SKILL.md)"}
        ],"internal_chat_message_metadata_passthrough":{"turn_id":"turn","content_item_kinds":["host_skills.instructions","generic.developer_instructions"]}});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        let found = availability(&payload).unwrap();
        assert_eq!(found.turn_id.as_deref(), Some("turn"));
        assert_eq!(
            found.entries,
            [
                SkillEntry {
                    name: "local".into(),
                    path: Path::new(&project)
                        .join("local/SKILL.md")
                        .to_string_lossy()
                        .into_owned()
                },
                SkillEntry {
                    name: "review".into(),
                    path: Path::new(&home)
                        .join("review/SKILL.md")
                        .to_string_lossy()
                        .into_owned()
                }
            ]
        );
    }

    #[test]
    fn user_text_cannot_enable_a_skill() {
        let value = json!({"type":"message","role":"user","content":[
            {"type":"input_text","text":"- fake: (file: /fake/SKILL.md)"}
        ],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["user_prompt"]}});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert!(availability(&payload).is_none());
    }

    #[test]
    fn declaration_requires_a_positive_assistant_statement_and_native_name() {
        let available = BTreeMap::from([(
            "release-skills".into(),
            "/skills/release-skills/SKILL.md".into(),
        )]);
        let value = json!({"type":"message","role":"assistant","content":[
            {"type":"output_text","text":"我会参考 release-skills 的分组流程。"}
        ]});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(declarations(&payload, &available)[0].name, "release-skills");
        let value = json!({"type":"message","role":"assistant","content":[
            {"type":"output_text","text":"这里不使用 release-skills。"}
        ]});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert!(declarations(&payload, &available).is_empty());
    }

    #[test]
    fn exec_wrapper_only_extracts_literal_skill_reads() {
        let code = r#"text(await tools.exec_command({cmd:"cat /one/SKILL.md; rg SKILL.md /tmp; sed -n '1,20p' '/two path/SKILL.md'",max_output_tokens:1000}));"#;
        let value = json!({"type":"custom_tool_call","name":"exec","input":code});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(
            exec_reads(&payload),
            ["/one/SKILL.md", "/two path/SKILL.md"]
        );
    }

    #[test]
    fn exec_window_handles_every_multibyte_boundary_and_later_commands() {
        for character in ["机", "é", "🦫"] {
            for offset in 1..character.len() {
                let prefix = "{cmd:\"cat /one/SKILL.md\",note:\"";
                let padding = "a".repeat(2048 - prefix.len() - offset);
                let code = format!(
                    "tools.exec_command({prefix}{padding}{character}\"}}); tools.exec_command({{cmd:\"cat /two/SKILL.md\"}})"
                );
                let value = json!({"type":"custom_tool_call","name":"exec","input":code});
                let encoded = value.to_string();
                let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
                assert_eq!(exec_reads(&payload), ["/one/SKILL.md", "/two/SKILL.md"]);
            }
        }
    }
}
