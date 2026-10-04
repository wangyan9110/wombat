pub mod codex;
pub mod contract;
pub(crate) mod shared_strings;

use contract::*;
use sha2::{Digest, Sha256};

pub fn stable_id(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

pub fn registry() -> Vec<Box<dyn AgentAdapter>> {
    vec![Box::new(codex::CodexAdapter)]
}

pub fn collect(request: &DiscoveryRequest, context: &RunContext) -> Collected {
    collect_with(&registry(), request, context)
}

/// No adapter-specific branch: unsupported detail levels remain absent facts.
pub fn collect_with(
    adapters: &[Box<dyn AgentAdapter>],
    request: &DiscoveryRequest,
    context: &RunContext,
) -> Collected {
    let mut result = Collected::default();
    for adapter in adapters {
        let discovered = adapter.discover(request);
        result.issues.extend(discovered.issues);
        for source in discovered.sources {
            let report = adapter.collect(&source, &ReadPlan, context, &mut result);
            result.issues.extend(report.issues.iter().cloned());
            result.sources.push(report);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct DailyOnly;
    impl AgentAdapter for DailyOnly {
        fn descriptor(&self) -> AdapterDescriptor {
            AdapterDescriptor {
                agent_kind: "test-daily".into(),
                adapter_version: "1".into(),
                capabilities: Capabilities {
                    usage: true,
                    measurement_grain: vec!["day".into()],
                    ..Capabilities::default()
                },
            }
        }
        fn discover(&self, _: &DiscoveryRequest) -> DiscoveryReport {
            DiscoveryReport {
                sources: vec![SourceInstance {
                    id: "fixture-source".into(),
                    agent_kind: "test-daily".into(),
                    root: "synthetic".into(),
                }],
                issues: vec![],
            }
        }
        fn collect(
            &self,
            source: &SourceInstance,
            _: &ReadPlan,
            _: &RunContext,
            sink: &mut dyn FactSink,
        ) -> SourceReport {
            sink.push(Fact::Measurement(
                Measurement {
                    id: stable_id(&[&source.agent_kind, &source.id, "same-upstream"]),
                    agent_kind: source.agent_kind.as_str().into(),
                    source_instance_id: source.id.as_str().into(),
                    thread_id: None,
                    turn_id: None,
                    response_id: None,
                    timestamp: Some("2026-09-29T00:00:00Z".into()),
                    interval_end: Some("2026-09-30T00:00:00Z".into()),
                    grain: "day".into(),
                    time_precision: "day".into(),
                    model: ModelRef {
                        raw: Some("synthetic-model".into()),
                        provider: Some("unknown-provider".into()),
                        ..ModelRef::default()
                    },
                    reasoning_effort: None,
                    tokens: TokenUsage {
                        input: Some(20),
                        cache_read: Some(80),
                        cache_create: Some(0),
                        output: Some(10),
                        reasoning: None,
                        total: Some(110),
                        raw_input: Some(100),
                    },
                    request_scoped: false,
                    reported_cost: Some("1.234".into()),
                    service_tier: None,
                    sequence: 1,
                    evidence: vec![],
                }
                .into(),
            ));
            let descriptor = self.descriptor();
            SourceReport {
                source: source.clone(),
                adapter_version: descriptor.adapter_version,
                source_versions: vec![],
                capabilities: descriptor.capabilities,
                status: "complete".into(),
                files_read: 1,
                bytes_read: 0,
                issues: vec![],
            }
        }
    }
    #[test]
    fn heterogeneous_source_requires_no_fake_thread_or_provider_inference() {
        let result = collect_with(
            &[Box::new(DailyOnly)],
            &DiscoveryRequest::default(),
            &RunContext::default(),
        );
        assert_eq!(result.measurements.len(), 1);
        assert!(result.threads.is_empty());
        assert!(result.turns.is_empty());
        let measurement = &result.measurements[0];
        assert_eq!(measurement.tokens.total, Some(110));
        assert_eq!(
            measurement.model.provider.as_deref(),
            Some("unknown-provider")
        );
        assert!(measurement.reasoning_effort.is_none());
        assert!(!result.sources[0].capabilities.turns);
        assert_ne!(
            measurement.id,
            stable_id(&["codex", "fixture-source", "same-upstream"])
        );
    }
}
