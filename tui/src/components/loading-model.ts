import { t, progressText } from '@wombat/client/locale';
export interface LoadingSpec {
  kind: 'open' | 'first' | 'refresh' | 'query';
  message?: string;
  activeTab?: 'usage' | 'threads';
}
export interface LoadingState {
  spec: LoadingSpec;
  stage?: string;
  cancelling: boolean;
  expanded?: boolean;
}
export class OperationCancelled extends Error {
  constructor() { super(t("common.loading_cancelled")); this.name = 'OperationCancelled'; }
}
export function loadingContent({ spec, stage, cancelling }: LoadingState) {
  stage = stage === undefined ? undefined : progressText(stage);
  const opening = spec.kind === 'open', first = spec.kind === 'first', query = spec.kind === 'query';
  const destination = spec.activeTab === 'threads' ? t("common.threads") : t("cli.format.usage");
  const stages = [query ? spec.message ?? t("common.loading") : spec.kind === 'refresh' ? t("tui.loading.sync_and_save") : first ? t("tui.loading.organize_local_records") : t("tui.loading.check_local_records")];
  return {
    context: first ? t("tui.components.loading-model.initial_scan") : opening ? t("tui.loading.check_records") : query ? t("tui.components.loading-model.loading") : t("tui.components.loading-model.refresh_usage"),
    heading: cancelling ? t("tui.components.loading-model.cancelling") : query ? spec.message ?? t("common.loading") : first ? t("tui.loading.organizing_local_records") : spec.kind === 'refresh' ? t("tui.loading.updating_usage") : t("tui.loading.read_latest", { destination }),
    description: query ? '' : first ? t("tui.loading.initial_wait") : spec.kind === 'refresh' ? t("tui.loading.save_after_sync") : t("tui.loading.open_after_check"),
    assurance: query ? '' : t("tui.components.loading-model.read_codex_records_without_modifying_them"),
    destination: t("tui.loading.open_destination", { destination }),
    cancel: spec.kind === 'refresh' ? t("tui.components.loading-model.cancel_refresh") : t("tui.components.loading-model.cancel_loading"),
    stages: stages.map(name => ({ name, status: 'active' as const })),
    detail: stage && !stages.includes(stage) ? stage : undefined,
  };
}
