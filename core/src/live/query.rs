//! Route typed usage and configuration queries against selected immutable revisions.
use super::*;
pub(super) fn query(
    request: Request,
    shared: &Shared,
    jobs: &mpsc::SyncSender<Job>,
    configs: &Mutex<crate::config::Store>,
) -> Result<Response> {
    let (snapshot, freshness) = select_view(&request, shared, jobs).or_else(|error| {
        if error
            .downcast_ref::<crate::dto::OperationError>()
            .is_some_and(|e| e.code == "VIEW_EXPIRED")
            && let Some(id) = &request.query.snapshot_id
            && let Some((snapshot, checked_at)) = configs.lock().unwrap().snapshot(id)
        {
            let initial_scan = preview::is_initial(&snapshot);
            return Ok((
                snapshot,
                Freshness {
                    initial_scan,
                    status: "fixed".into(),
                    checked_at: Some(checked_at),
                    revision: id.clone(),
                    error: None,
                    error_code: None,
                },
            ));
        }
        Err(error)
    })?;
    let mut query = request.query;
    query.roots = None;
    query.snapshot_id = None;
    let mut result = if query.action == usage_app_dto::Action::Refresh {
        // Export only on an explicit refresh. Automatic updates never create snapshots.
        let _lock = crate::usage_store::RefreshLock::acquire()?;
        let saved = snapshot.export_live()?;
        query.action = usage_app_dto::Action::Usage;
        let mut result = crate::usage_app::execute_snapshot(query, &saved)?;
        result.summary = crate::usage_app::summarize(&saved.ledger()?.iter().collect::<Vec<_>>())?;
        result.scope = usage_app_dto::Scope::default();
        result.action = usage_app_dto::Action::Refresh;
        result.items.clear();
        result.page.total = 0;
        result.page.next_offset = None;
        result
    } else {
        crate::usage_app::execute_snapshot(query, &snapshot)?
    };
    result.freshness = Some(freshness.clone());
    Ok(Response {
        output_version: 1,
        result,
        freshness,
    })
}
pub(super) fn config_query(
    request: crate::config_dto::Request,
    native: Option<&crate::config::hooks::Capture>,
    shared: &Shared,
    jobs: &mpsc::SyncSender<Job>,
    configs: &Mutex<crate::config::Store>,
) -> Result<crate::config_dto::Response> {
    crate::config::validate(&request)?;
    if request.action == crate::config_dto::Action::Capabilities {
        return Ok(crate::config::capabilities());
    }
    let (id, view) = if let Some(id) = &request.read_view {
        let view = configs.lock().unwrap().get(id)?;
        if request.roots.as_deref().unwrap_or_default() != view.roots
            || request.project_roots.as_deref().unwrap_or_default() != view.project_roots
        {
            return Err(operation_error("INVALID_ARGUMENT", "来源范围不匹配"));
        }
        (id.clone(), view)
    } else {
        let query = serde_json::from_value(
            json!({"action":"usage","roots":request.roots,"snapshotId":request.snapshot_id}),
        )?;
        let selected = select_view(
            &Request {
                query,
                mode: Mode::Auto,
                verify: false,
            },
            shared,
            jobs,
        );
        let (snapshot, status) = match selected {
            Ok((snapshot, freshness)) => (Some(snapshot), freshness.status),
            Err(error) if request.snapshot_id.is_some() => return Err(error),
            Err(_) => (None, "unavailable".into()),
        };
        let view = crate::config::prepare_observed(&request, snapshot, status, native)?;
        configs.lock().unwrap().insert(view)
    };
    crate::config::execute(request, id, &view)
}
