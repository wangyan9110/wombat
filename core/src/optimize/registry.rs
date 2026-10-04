//! Stable rule directory; evaluation belongs to the fixed-input evaluator.
use crate::{config_dto::Kind, optimize_dto::*};
pub(super) fn catalog() -> Vec<RuleDefinition> {
    Rule::ALL
        .into_iter()
        .map(|rule| RuleDefinition {
            rule: rule.id().into(),
            version: RuleParameters::default().version,
            kinds: rule.kinds().to_vec(),
            basis: rule.basis().into(),
        })
        .collect()
}

#[derive(Clone, Copy)]
pub(super) enum Rule {
    MissingInstruction,
    FileSize,
    InstructionSelection,
    SkillFormat,
    DescriptionStandard,
    DescriptionSize,
    BodyTokens,
    LocalReference,
    ExactInstructionBlocks,
    DeclaredCopyDrift,
    SkillDependency,
    HookTarget,
    RuntimeDuplicateInjection,
    SkillInactivity,
    McpInactivity,
    McpFault,
}
impl Rule {
    /// Independent algorithm declarations; runtime rules remain unsupported.
    pub(super) fn dependencies(self) -> Dependencies {
        let (evidence, method) = match self {
            Self::MissingInstruction => (Evidence::Existence, "authorized-existence-v1"),
            Self::FileSize => (Evidence::FileMeasurement, "file-bytes-v1"),
            Self::SkillFormat | Self::DescriptionStandard | Self::DescriptionSize => {
                (Evidence::SkillMetadata, "skill-frontmatter-v1")
            }
            Self::BodyTokens => (
                Evidence::BodyMeasurement,
                "tiktoken-rs-0.12.0/o200k_base/ordinary-v1",
            ),
            Self::LocalReference => (Evidence::References, "authorized-local-reference-v1"),
            Self::ExactInstructionBlocks => (Evidence::Blocks, "exact-instruction-block-v1"),
            Self::DeclaredCopyDrift => (Evidence::Relations, "raw-utf8/identity-v1"),
            Self::HookTarget => (Evidence::HostTargets, "trusted-enabled-hook-target-v1"),
            _ => (Evidence::Unsupported, "unavailable-v1"),
        };
        Dependencies {
            semantics_version: 1,
            evidence,
            method,
            max_key_bytes: super::cache::MAX_ENTRY_BYTES,
            max_dependency_rows: 1024,
            max_candidate_rows: 4096,
        }
    }
    pub(super) const ALL: [Self; 16] = [
        Self::MissingInstruction,
        Self::FileSize,
        Self::InstructionSelection,
        Self::SkillFormat,
        Self::DescriptionStandard,
        Self::DescriptionSize,
        Self::BodyTokens,
        Self::LocalReference,
        Self::ExactInstructionBlocks,
        Self::DeclaredCopyDrift,
        Self::SkillDependency,
        Self::HookTarget,
        Self::RuntimeDuplicateInjection,
        Self::SkillInactivity,
        Self::McpInactivity,
        Self::McpFault,
    ];
    pub(super) fn id(self) -> &'static str {
        match self {
            Self::MissingInstruction => "missingInstruction",
            Self::FileSize => "fileSize",
            Self::InstructionSelection => "instructionSelection",
            Self::SkillFormat => "skillFormat",
            Self::DescriptionStandard => "descriptionStandard",
            Self::DescriptionSize => "descriptionSize",
            Self::BodyTokens => "bodyTokens",
            Self::LocalReference => "localReference",
            Self::ExactInstructionBlocks => "exactInstructionBlocks",
            Self::DeclaredCopyDrift => "declaredCopyDrift",
            Self::SkillDependency => "skillDependency",
            Self::HookTarget => "hookTarget",
            Self::RuntimeDuplicateInjection => "runtimeDuplicateInjection",
            Self::SkillInactivity => "skillInactivity",
            Self::McpInactivity => "mcpInactivity",
            Self::McpFault => "mcpFault",
        }
    }
    fn kinds(self) -> &'static [Kind] {
        match self {
            Self::MissingInstruction | Self::FileSize | Self::InstructionSelection => &[Kind::Rule],
            Self::SkillFormat
            | Self::DescriptionStandard
            | Self::DescriptionSize
            | Self::BodyTokens
            | Self::SkillDependency
            | Self::SkillInactivity => &[Kind::Skill],
            Self::LocalReference
            | Self::ExactInstructionBlocks
            | Self::DeclaredCopyDrift
            | Self::RuntimeDuplicateInjection => &[Kind::Rule, Kind::Skill],
            Self::HookTarget => &[Kind::Hook],
            Self::McpInactivity | Self::McpFault => &[Kind::Mcp],
        }
    }
    fn basis(self) -> &'static str {
        match self {
            Self::MissingInstruction => "authorizedExistenceCheck",
            Self::FileSize | Self::DescriptionSize => "productReminder",
            Self::InstructionSelection => "effectiveHostConfiguration",
            Self::SkillFormat | Self::DescriptionStandard => "agentSkillsSpecification",
            Self::BodyTokens => "referenceEncodingOnly",
            Self::LocalReference => "authorizedMarkdownResources",
            Self::ExactInstructionBlocks => "staticExactBlocks",
            Self::DeclaredCopyDrift => "explicitSourceCopyRelation",
            Self::SkillDependency => "effectiveHostDependencyResolution",
            Self::HookTarget => "effectiveTrustedEnabledHookRegistry",
            Self::RuntimeDuplicateInjection => "requestContextGenerationPositions",
            Self::SkillInactivity | Self::McpInactivity => "continuousEnabledCoverage30Days",
            Self::McpFault => "verifiedRuntimeConnection",
        }
    }
    pub(super) fn applies(self, kind: &Kind) -> bool {
        self.kinds().contains(kind)
    }
}

#[derive(Clone, Copy, serde::Serialize)]
pub(super) enum Evidence {
    Existence,
    FileMeasurement,
    SkillMetadata,
    BodyMeasurement,
    References,
    Blocks,
    Relations,
    HostTargets,
    Unsupported,
}
#[derive(serde::Serialize)]
pub(super) struct Dependencies {
    pub semantics_version: u32,
    pub evidence: Evidence,
    pub method: &'static str,
    /// Reuse work is bounded separately from the collector's analysis budgets.
    pub max_key_bytes: usize,
    pub max_dependency_rows: usize,
    pub max_candidate_rows: usize,
}
