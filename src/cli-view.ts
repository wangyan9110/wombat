import path from 'node:path';
import type { CodexEvent, Finding, ModuleResult, Resource, ScanSnapshot, Session, UsageRow } from './contracts.js';

const count = (value: number | null | undefined) => value == null ? '未知' : new Intl.NumberFormat('zh-CN').format(value);
const short = (value: string, length = 42) => value.length > length ? `…${value.slice(-length + 1)}` : value;
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN') : '未知';
const stateName: Record<ModuleResult['state'], string> = {
  success: '完成', partial: '部分完成', empty: '无数据', unsupported: '未支持',
  permission_denied: '无权限', failed: '失败', cancelled: '已取消',
};
const kindName: Record<Resource['kind'], string> = { rule: '规则', skill: 'Skill', mcp: 'MCP', config: '配置' };
const severityName: Record<Finding['severity'], string> = { actionable: '建议处理', review: '建议审查', info: '信息' };
const confidenceName: Record<Finding['confidence'], string> = { fact: '确定事实', indication: '较强迹象', needs_review: '待人工判断' };

export function snapshotHeader(snapshot: ScanSnapshot): string {
  return `工作空间  ${snapshot.scope.workspace}\n扫描时间  ${date(snapshot.createdAt)}\n观察范围  ${snapshot.scope.since} 至 ${snapshot.scope.until}（不含） · ${snapshot.scope.timezone}`;
}

export function statusSummary(snapshot: ScanSnapshot) {
  const daily = snapshot.usage?.sections.daily;
  const totals = daily?.totals;
  const unpriced = Array.isArray(totals?.unpricedModels) && totals.unpricedModels.length > 0;
  return {
    totalTokens: typeof totals?.totalTokens === 'number' ? totals.totalTokens : null,
    pricedCostUSD: typeof totals?.totalCost === 'number' ? totals.totalCost : null,
    hasUnpricedModels: unpriced,
    resources: snapshot.resources.length,
    sessions: snapshot.sessions.length,
    findings: snapshot.findings.length,
    sourceIssues: snapshot.modules.filter(item => !['success', 'empty'].includes(item.state)).length,
  };
}

export function renderStatus(snapshot: ScanSnapshot): string {
  const summary = statusSummary(snapshot);
  const lines = [`Wombat · Agent 环境概览`, snapshotHeader(snapshot), '',
    `用量       ${count(summary.totalTokens)} Token · 已计价 ${summary.pricedCostUSD == null ? '未知' : `$${summary.pricedCostUSD.toFixed(2)}`}${summary.hasUnpricedModels ? '，另有未计价模型' : ''}`,
    `环境       ${summary.resources} 项配置 · Codex 会话 ${summary.sessions} 个`,
    `发现       ${summary.findings} 项${summary.findings ? '（下列最多 3 项）' : ''}`];
  if (snapshot.findings.length) for (const finding of snapshot.findings.slice(0, 3)) lines.push(`  ${severityName[finding.severity]} · ${finding.title} · ${evidence(finding)}`);
  lines.push('', '来源状态');
  for (const module of snapshot.modules) lines.push(`  ${stateName[module.state].padEnd(4)}  ${short(module.source, 64)}${module.detail ? ` · ${short(module.detail, 80)}` : ''}`);
  if (snapshot.warnings.length) lines.push('', `覆盖提示  ${snapshot.warnings.length} 项，运行 wombat doctor 查看相关发现与状态。`);
  lines.push('', '继续查看  wombat usage · wombat env · wombat doctor · wombat sessions');
  return lines.join('\n') + '\n';
}

export function renderUsage(rows: UsageRow[], title: string, scope: string): string {
  const lines = [`Wombat · ${title}`, scope, '', '周期 / 会话                     Agent       Token             已计价费用'];
  for (const row of rows) {
    const cost = row.pricing === 'hidden' ? '已隐藏' : row.pricing === 'unpriced' ? `${row.costUSD == null ? '未知' : `$${row.costUSD.toFixed(2)}`} + 未计价` : row.costUSD == null ? '未知' : `$${row.costUSD.toFixed(2)}`;
    lines.push(`${short(row.period, 30).padEnd(31)} ${row.agent.padEnd(11)} ${count(row.totalTokens).padEnd(17)} ${cost}`);
    if (row.models.length) lines.push(`  模型 ${row.models.join(', ')}`);
  }
  if (!rows.length) lines.push('当前范围没有可用记录。');
  lines.push('', 'Token 总量采用上游口径；缓存与推理子项不重复相加。费用为估算，未计价部分不计作零。');
  return lines.join('\n') + '\n';
}

export function renderEnvironment(snapshot: ScanSnapshot, resources: Resource[], total: number): string {
  const lines = ['Wombat · 环境清单', snapshotHeader(snapshot), '', `匹配 ${total} 项 · 显示 ${resources.length} 项`, ''];
  for (const resource of resources) {
    lines.push(`${kindName[resource.kind].padEnd(5)} ${resource.agent.padEnd(7)} ${resource.scope === 'user' ? '用户' : '项目'}  ${resource.name}`);
    lines.push(`  ${resource.path}`);
    lines.push(`  已配置 · 载入${resource.loaded === 'observed' ? '已观察' : '未验证'} · 使用${resource.used === 'observed' ? '已观察' : '未验证'}${resource.sizeBytes == null ? '' : ` · ${count(resource.sizeBytes)} B`}`);
  }
  if (!total) lines.push('没有匹配的资源。');
  if (resources.length < total) lines.push('', '还有更多结果，使用 --all 或 --limit N 查看。');
  return lines.join('\n') + '\n';
}

function evidence(finding: Finding): string {
  const first = finding.evidence[0];
  return first ? `${first.file}:${first.line}` : '无定位';
}

export function renderDoctor(snapshot: ScanSnapshot, findings: Finding[], total: number): string {
  const lines = ['Wombat · 检查建议', snapshotHeader(snapshot), '', `匹配 ${total} 项 · 显示 ${findings.length} 项 · 只读，不修改配置`, ''];
  for (const [index, finding] of findings.entries()) {
    lines.push(`${index + 1}. [${severityName[finding.severity]} · ${confidenceName[finding.confidence]}] ${finding.title}`);
    lines.push(`   事实  ${finding.fact}`);
    if (finding.hypothesis) lines.push(`   可能  ${finding.hypothesis}`);
    if (finding.recommendation) lines.push(`   建议  ${finding.recommendation}`);
    lines.push(`   证据  ${finding.evidence.map(item => `${item.file}:${item.line}`).join('、') || '无定位'}`);
    if (finding.diff) lines.push(`   预览\n${finding.diff.split('\n').map(line => `     ${line}`).join('\n')}`);
    lines.push('');
  }
  if (!total) lines.push('当前没有可证实的发现。\n');
  if (findings.length < total) lines.push('还有更多发现，使用 --all 或 --limit N 查看。\n');
  if (snapshot.modules.some(item => !['success', 'empty'].includes(item.state))) lines.push('部分来源未完成；无发现不代表全部来源没有问题。\n');
  return lines.join('\n');
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
}

export function renderSessions(snapshot: ScanSnapshot, sessions: Session[], total: number): string {
  const lines = ['Wombat · Codex 会话', snapshotHeader(snapshot), '', `匹配 ${total} 个 · 显示 ${sessions.length} 个`, ''];
  for (const session of sessions) {
    lines.push(`${date(session.lastActivityAt)}  ${path.basename(session.workspace ?? '未知工作空间')}  ${session.eventCount} 事件`);
    lines.push(`  ${session.id}`);
  }
  if (!total) lines.push('当前范围没有匹配的会话。');
  if (sessions.length < total) lines.push('', '还有更多会话，使用 --all 或 --limit N 查看。');
  lines.push('', '查看证据  wombat sessions --session codex:会话ID');
  return lines.join('\n') + '\n';
}

export function renderSessionDetail(session: Session, events: CodexEvent[]): string {
  const lines = ['Wombat · 会话证据', `${session.id} · ${session.workspace ?? '未知工作空间'}`, `${date(session.startedAt)} 至 ${date(session.lastActivityAt)}`, `源文件 ${session.sourceFile}`, ''];
  for (const event of events) lines.push(`${date(event.timestamp)}  ${event.type} ${event.tool ?? ''}${event.target ? ` · ${event.target}` : ''}${event.bytes == null ? '' : ` · ${count(event.bytes)} B`}\n  ${event.evidence.file}:${event.evidence.line}`);
  if (!events.length) lines.push('此会话没有可展示的工具或压缩事件。');
  lines.push('', '这里只显示元数据与定位，不复制工具输出正文。');
  return lines.join('\n') + '\n';
}
