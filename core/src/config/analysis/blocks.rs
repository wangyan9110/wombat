//! Whole Markdown units with raw UTF-8 offsets, heading context and collision-safe equality.
use super::{BLOCK_LIMIT, version};
use crate::{config_dto::Item, optimize_dto::*};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use std::{collections::BTreeMap, ops::Range, sync::Arc};
#[derive(Debug, Default)]
pub(super) struct HeadingContext {
    pub(super) headings: [Option<Arc<str>>; 6],
    pub(super) fingerprint: String,
}
#[derive(Debug)]
pub(super) struct Block {
    pub(super) range: Range<usize>,
    pub(super) line: usize,
    pub(super) end_line: usize,
    pub(super) context: Arc<HeadingContext>,
}
pub(super) fn blocks(text: &str) -> Vec<Block> {
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
pub(super) fn position(item: &Item, block: &Block, hash: &str) -> BlockPosition {
    BlockPosition {
        item_id: item.id.clone(),
        start_byte: block.range.start,
        end_byte: block.range.end,
        start_line: block.line,
        end_line: block.end_line,
        block_hash: hash.into(),
    }
}
pub(super) struct Occurrence<'a> {
    pub(super) item: &'a Item,
    pub(super) position: BlockPosition,
    pub(super) context: Arc<HeadingContext>,
}
pub(super) struct ExactGroup<'a> {
    pub(super) bytes: String,
    pub(super) occurrences: Vec<Occurrence<'a>>,
}
pub(super) fn exact_bucket<'a>(buckets: &mut Vec<ExactGroup<'a>>, bytes: &str) -> usize {
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
pub(super) fn duplicate_finding(
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
            hook: None,
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
            references: vec![],
        }),
    }
}
