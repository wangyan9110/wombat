import { t, progressText } from '@wombat/client/locale';
export interface LoadingSpec {
  kind: 'open' | 'snapshot' | 'first' | 'refresh' | 'query';
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
  const opening = spec.kind === 'open', saved = spec.kind === 'snapshot', first = spec.kind === 'first', query = spec.kind === 'query';
  const destination = spec.activeTab === 'threads' ? t('common.threads') : t('common.usage');
  const combinedSync = stage === t('progress.sync');
  const stages = saved ? [t('common.open_saved_results')] : opening ? [t('tui.loading.check_local_records')]
    : query ? [spec.message ?? t('common.loading')] : combinedSync ? [t('tui.loading.sync_and_save')]
    : [first ? t('tui.loading.organize_local_records') : t('tui.loading.check_local_records'), t('tui.components.loading-model.save_usage')];
  // Only an observed save phase can mark the preceding read phase complete.
  const index = Math.max(0, stages.indexOf(stage ?? ''));
  return {
    context: saved ? t('common.open_saved_results') : t('tui.components.loading-model.loading'),
    heading: cancelling ? t('tui.components.loading-model.cancelling') : saved ? t('tui.components.loading-model.opening_previous_usage') : opening ? t('tui.loading.read_latest', { destination }) : first ? t('tui.loading.organizing_local_records') : query ? spec.message ?? t('common.loading') : t('tui.loading.updating_usage'),
    description: saved ? t('tui.components.loading-model.open_usage_from_saved_results') : first ? t('tui.loading.organize_local_records') : query ? '' : t('tui.loading.check_records'),
    assurance: query ? '' : saved ? t('tui.components.loading-model.use_previous_results_without_rescanning_logs') : t('tui.components.loading-model.read_codex_records_without_modifying_them'),
    destination: t('tui.loading.open_destination', { destination }),
    cancel: saved ? t('tui.components.loading-model.cancel_opening') : t('tui.components.loading-model.cancel_loading'),
    stages: stages.map((name, i) => ({ name, status: i < index ? 'done' as const : i === index ? 'active' as const : 'waiting' as const })),
    detail: stage && !stages.includes(stage) && !combinedSync && stage !== t('tui.components.loading-model.read_codex_logs') ? stage : undefined,
  };
}
