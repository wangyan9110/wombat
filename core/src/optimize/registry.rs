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
