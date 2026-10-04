use super::*;
use serde_json::{Value, json};

fn meta(id: &str) -> Value {
    json!({"type":"session_meta","timestamp":"2026-09-28T23:59:00Z","payload":{"id":id,"cwd":"/synthetic/project"}})
}
fn context(turn: &str, model: &str, effort: &str) -> Value {
    json!({"type":"turn_context","timestamp":"2026-09-28T23:59:01Z","payload":{"turn_id":turn,"model":model,"effort":effort}})
}
fn counts(input: u64, cache: u64, output: u64) -> Value {
    json!({"input_tokens":input,"cached_input_tokens":cache,"cache_write_input_tokens":0,"output_tokens":output,"reasoning_output_tokens":2,"total_tokens":input+output})
}
fn direct(
    thread: &str,
    turn: &str,
    response: &str,
    at: &str,
    input: u64,
    cache: u64,
    output: u64,
) -> Value {
    json!({"type":"event_msg","timestamp":at,"payload":{"type":"token_usage_record","thread_id":thread,"turn_id":turn,"response_id":response,"usage":counts(input,cache,output)}})
}
fn legacy(total: Value, last: Option<Value>, at: &str) -> Value {
    json!({"type":"event_msg","timestamp":at,"payload":{"type":"token_count","info":{"total_token_usage":total,"last_token_usage":last}}})
}
fn write(root: &Path, name: &str, rows: &[Value]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        rows.iter()
            .map(|v| v.to_string() + "\n")
            .collect::<String>(),
    )
    .unwrap();
    path
}
fn collect(root: &Path) -> Collected {
    super::super::collect(
        &DiscoveryRequest {
            roots: vec![root.into()],
        },
        &RunContext::default(),
    )
}

mod accounting;
mod boundaries;
mod identity;
mod incremental_projection;
mod incremental_storage;

mod mcp;

mod fork_graph;
mod operations;

mod timing;
