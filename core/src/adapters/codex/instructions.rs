//! Native Codex instruction injection evidence without retaining instruction bodies.
use super::*;
use std::borrow::Cow;

const AGENTS_KIND: &str = "agents_md.instructions";
const HEADER: &str = "# AGENTS.md instructions for ";
const MAX_INSTRUCTION_FILES_PER_MESSAGE: usize = 64;

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

pub(super) struct InstructionLoads {
    pub(super) turn_id: Option<String>,
    pub(super) paths: Vec<String>,
    pub(super) content_hashes: BTreeMap<String, String>,
}

/// The native content-item kind distinguishes Codex injection from user-authored text.
pub(super) fn loads(payload: &Payload<'_>) -> Option<InstructionLoads> {
    if payload.kind.as_deref() != Some("message") || payload.role.as_deref() != Some("user") {
        return None;
    }
    let metadata: MessageMetadata =
        serde_json::from_str(payload.internal_chat_message_metadata_passthrough?.get()).ok()?;
    if !metadata
        .content_item_kinds
        .iter()
        .any(|kind| kind == AGENTS_KIND)
    {
        return None;
    }
    let content: Vec<MessageContent<'_>> = serde_json::from_str(payload.content?.get()).ok()?;
    let mut paths = Vec::new();
    let mut content_hashes = BTreeMap::new();
    let mut conflicting_hashes = BTreeSet::new();
    for (index, kind) in metadata.content_item_kinds.iter().enumerate() {
        if kind != AGENTS_KIND {
            continue;
        }
        let Some(text) = content.get(index).and_then(|item| item.text.as_deref()) else {
            continue;
        };
        let mut message_paths = Vec::new();
        for line in text.lines() {
            let Some(root) = line.strip_prefix(HEADER).map(str::trim) else {
                continue;
            };
            let root = Path::new(root);
            if !root.is_absolute() {
                continue;
            }
            let path = if root.file_name().is_some_and(|name| name == "AGENTS.md") {
                root.to_path_buf()
            } else {
                root.join("AGENTS.md")
            };
            let path = path.to_string_lossy().into_owned();
            message_paths.push(path.clone());
            if !paths.contains(&path) {
                paths.push(path);
            }
            if paths.len() == MAX_INSTRUCTION_FILES_PER_MESSAGE {
                break;
            }
        }
        // Only one native document with an unambiguous wrapper can bind a body to a path.
        // Retain its hash, never the body. Ordinary user content never reaches this branch.
        if text.starts_with(HEADER)
            && message_paths.len() == 1
            && text.matches("<INSTRUCTIONS>").count() == 1
            && text.matches("</INSTRUCTIONS>").count() == 1
            && let Some((_, tail)) = text.split_once("<INSTRUCTIONS>")
            && let Some((body, suffix)) = tail.split_once("</INSTRUCTIONS>")
            && suffix.trim().is_empty()
        {
            let body = body.strip_prefix('\n').unwrap_or(body);
            let path = &message_paths[0];
            let hash = crate::hash(body);
            if content_hashes
                .get(path)
                .is_some_and(|previous| previous != &hash)
            {
                content_hashes.remove(path);
                conflicting_hashes.insert(path.clone());
            } else if !conflicting_hashes.contains(path) {
                content_hashes.insert(path.clone(), hash);
            }
        }
    }
    (!paths.is_empty()).then_some(InstructionLoads {
        turn_id: metadata.turn_id,
        paths,
        content_hashes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn repeated_native_paths_never_choose_one_conflicting_body() {
        let project = test_absolute("conflict");
        let value = json!({"type":"message","role":"user","content":[
            {"type":"input_text","text":format!("{HEADER}{project}\n\n<INSTRUCTIONS>\nfirst\n</INSTRUCTIONS>")},
            {"type":"input_text","text":format!("{HEADER}{project}\n\n<INSTRUCTIONS>\nsecond\n</INSTRUCTIONS>")},
            {"type":"input_text","text":format!("{HEADER}{project}\n\n<INSTRUCTIONS>\nfirst\n</INSTRUCTIONS>")}
        ],"internal_chat_message_metadata_passthrough":{"content_item_kinds":[AGENTS_KIND,AGENTS_KIND,AGENTS_KIND]}});
        let encoded = value.to_string();
        let payload = serde_json::from_str(&encoded).unwrap();
        let found = loads(&payload).unwrap();
        assert_eq!(found.paths.len(), 1);
        assert!(found.content_hashes.is_empty());
    }
    #[test]
    fn native_metadata_selects_only_instruction_content_and_absolute_paths() {
        let project = test_absolute("project");
        let value = json!({"type":"message","role":"user","content":[
            {"type":"input_text","text":format!("# AGENTS.md instructions for {project}\n\n<INSTRUCTIONS>\nprivate\n</INSTRUCTIONS>")},
            {"type":"input_text","text":"# AGENTS.md instructions for /not-environment"}
        ],"internal_chat_message_metadata_passthrough":{"turn_id":"turn","content_item_kinds":["agents_md.instructions","environments.environment_context"]}});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(payload.kind.as_deref(), Some("message"));
        assert_eq!(payload.role.as_deref(), Some("user"));
        let metadata: MessageMetadata = serde_json::from_str(
            payload
                .internal_chat_message_metadata_passthrough
                .unwrap()
                .get(),
        )
        .unwrap();
        assert_eq!(metadata.content_item_kinds[0], AGENTS_KIND);
        let content: Vec<MessageContent<'_>> =
            serde_json::from_str(payload.content.unwrap().get()).unwrap();
        assert!(content[0].text.as_deref().unwrap().starts_with(HEADER));
        let found = loads(&payload).unwrap();
        assert_eq!(found.turn_id.as_deref(), Some("turn"));
        assert_eq!(
            found.paths,
            [Path::new(&project).join("AGENTS.md").to_string_lossy()]
        );
    }

    #[test]
    fn ordinary_user_text_cannot_claim_an_instruction_load() {
        let value = json!({"type":"message","role":"user","content":[
            {"type":"input_text","text":"# AGENTS.md instructions for /project"}
        ],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["user_prompt"]}});
        let encoded = value.to_string();
        let payload: Payload<'_> = serde_json::from_str(&encoded).unwrap();
        assert!(loads(&payload).is_none());
    }
}
