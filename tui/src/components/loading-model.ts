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
  constructor() { super('读取已取消'); this.name = 'OperationCancelled'; }
}
export function loadingContent({ spec, stage, cancelling }: LoadingState) {
  const opening = spec.kind === 'open', first = spec.kind === 'first', query = spec.kind === 'query';
  const destination = spec.activeTab === 'threads' ? '对话' : '用量';
  const stages = [query ? spec.message ?? '正在读取…' : spec.kind === 'refresh' ? '同步记录并保存用量' : first ? '整理本机记录' : '核对本机记录'];
  return {
    context: first ? '首次整理' : opening ? '核对记录' : query ? '读取中' : '更新用量',
    heading: cancelling ? '正在取消…' : query ? spec.message ?? '正在读取…' : first ? '正在整理本机记录' : spec.kind === 'refresh' ? '正在更新用量' : `正在读取最新${destination}`,
    description: query ? '' : first ? '首次整理可能需要稍等，完成后进入用量。' : spec.kind === 'refresh' ? '完成同步后保存本次用量。' : '核对新记录后打开页面。',
    assurance: query ? '' : '只读 Codex 原始记录，离线完成。',
    destination: `完成后进入${destination}`,
    cancel: spec.kind === 'refresh' ? '取消更新' : '取消读取',
    stages: stages.map(name => ({ name, status: 'active' as const })),
    detail: stage && !stages.includes(stage) ? stage : undefined,
  };
}
