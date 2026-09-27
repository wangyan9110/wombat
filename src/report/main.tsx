import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Finding, ScanSnapshot, UsageSection } from '../contracts.js';
import './style.css';

declare global { interface Window { __WOMBAT_SNAPSHOT__?: ScanSnapshot } }

const snapshot = window.__WOMBAT_SNAPSHOT__;

function humanNumber(value: number | null | undefined) {
  if (value == null) return '未知';
  return new Intl.NumberFormat('zh-CN', { notation: value >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
function money(value: number | null | undefined) { return value == null ? '未知' : `$${value.toFixed(2)}`; }
function basename(value: string) { return value.split('/').filter(Boolean).at(-1) || value; }
function dateTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString('zh-CN') : '未知'; }
function evidenceLabel(finding: Finding) { const ref = finding.evidence[0]; return ref ? `${ref.file}:${ref.line}` : '无定位'; }
function downloadJson(data: ScanSnapshot) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `wombat-${data.snapshotId}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App({ data }: { data: ScanSnapshot }) {
  const [page, setPage] = useState<'overview' | 'usage' | 'environment' | 'sessions' | 'findings'>('overview');
  const [agent, setAgent] = useState('all');
  const [query, setQuery] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [usageKind, setUsageKind] = useState<UsageSection['kind']>('daily');
  const agents = useMemo(() => [...new Set([...data.resources.map(item => item.agent), ...data.sessions.map(item => item.agent), ...Object.values(data.usage?.sections ?? {}).flatMap(section => section?.rows.map(row => row.agent) ?? [])])].sort(), [data]);
  const matches = (value: { agent: string }, searchable: string) => (agent === 'all' || value.agent === agent) && searchable.toLowerCase().includes(query.toLowerCase());
  const resources = data.resources.filter(item => matches(item, `${item.name} ${item.kind} ${item.path}`));
  const sessions = data.sessions.filter(item => matches(item, `${item.id} ${item.workspace ?? ''} ${item.sourceFile}`));
  const findings = data.findings.filter(item => matches(item, `${item.title} ${item.fact} ${item.sessionId ?? ''}`));
  const usageSection = data.usage?.sections[usageKind];
  const usageRows = (usageSection?.rows ?? []).filter(item => matches(item, `${item.period} ${item.models.join(' ')}`));
  const allUsage = Object.values(data.usage?.sections ?? {}).flatMap(section => section?.rows ?? []);
  const totalTokens = data.usage?.sections.daily?.totals?.totalTokens;
  const totalCost = data.usage?.sections.daily?.totals?.totalCost;
  const hasUnpriced = Array.isArray(data.usage?.sections.daily?.totals?.unpricedModels) && data.usage!.sections.daily!.totals!.unpricedModels.length > 0;
  const selectedSession = data.sessions.find(item => item.id === sessionId);
  const selectedEvents = data.events.filter(item => item.sessionId === sessionId);
  const labels = { overview: '概览', usage: '用量', environment: '环境', sessions: '会话', findings: '发现' };
  const moduleIssues = data.modules.filter(item => !['success', 'empty'].includes(item.state));

  function showSession(id: string) { setSessionId(id); setPage('sessions'); window.scrollTo(0, 0); }
  function showFindings() { setPage('findings'); window.scrollTo(0, 0); }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">W</div><div><strong>Wombat</strong><small>Agent 环境管家</small></div></div>
      <div className="side-caption">工作台</div>
      <nav aria-label="报告导航">{(Object.keys(labels) as Array<keyof typeof labels>).map(key => <button key={key} className={page === key ? 'nav-item active' : 'nav-item'} onClick={() => setPage(key)}><span className="nav-dot" />{labels[key]}<span className="nav-count">{key === 'findings' ? data.findings.length : key === 'sessions' ? data.sessions.length : ''}</span></button>)}</nav>
      <div className="side-bottom"><span className="live-dot" />本地只读报告<br /><small>快照 {data.snapshotId.slice(0, 8)}</small></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">Wombat <span>/</span> {labels[page]}</div><button className="export-button" onClick={() => downloadJson(data)}>导出 JSON ↗</button></header>
      <div className="content">
        <div className="page-head"><div><div className="eyebrow">LOCAL AGENT OBSERVABILITY</div><h1>{page === 'overview' ? '你的 Agent 环境，一目了然。' : labels[page]}</h1><p>{page === 'overview' ? '从本机证据出发，检查用量、配置和会话行为。' : `扫描工作空间 ${data.scope.workspace}`}</p></div><div className="scan-time">扫描于 {dateTime(data.createdAt)}<br /><span>{data.scope.since} — {data.scope.until}（不含） · {data.scope.timezone}</span></div></div>
        {moduleIssues.length > 0 && <div className="notice"><strong>部分来源需要留意</strong><span>{moduleIssues.map(item => `${item.source}: ${item.state}${item.detail ? `（${item.detail}）` : ''}`).join('；')}</span></div>}
        {(page === 'environment' || page === 'sessions' || page === 'findings' || page === 'usage') && <div className="filters"><select aria-label="筛选 Agent" value={agent} onChange={event => setAgent(event.target.value)}><option value="all">全部 Agent</option>{agents.map(item => <option key={item}>{item}</option>)}</select><input aria-label="搜索" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、路径或会话…" /></div>}
        {page === 'overview' && <>
          <div className="metric-grid"><Metric label="总 Token" value={typeof totalTokens === 'number' ? humanNumber(totalTokens) : '未知'} hint="ccusage 日报口径" /><Metric label="已计价费用" value={typeof totalCost === 'number' ? money(totalCost) : '未知'} hint={hasUnpriced ? '另有未计价模型，非总账单' : 'ccusage 估算'} /><Metric label="环境资源" value={humanNumber(data.resources.length)} hint="Rules · Skills · MCP" /><Metric label="Codex 会话" value={humanNumber(data.sessions.length)} hint={`${data.events.length} 条可定位事件`} /></div>
          <div className="two-cols"><section className="card"><div className="section-head"><div><span className="eyebrow">PRIORITY</span><h2>优先发现</h2></div><button className="text-link" onClick={showFindings}>查看全部 →</button></div>{data.findings.slice(0, 3).length ? data.findings.slice(0, 3).map(f => <FindingCard key={f.id} item={f} compact onSession={showSession} />) : <Empty text="当前没有可证实的优先发现。" />}</section><section className="card"><div className="section-head"><div><span className="eyebrow">COVERAGE</span><h2>数据来源</h2></div></div><div className="source-list">{data.modules.map((item, index) => <div className="source-row" key={`${item.source}-${index}`}><span>{item.source}</span><span className={`status ${item.state}`}>{stateLabel(item.state)}</span></div>)}</div></section></div>
          <section className="card"><div className="section-head"><div><span className="eyebrow">RECENT SESSIONS</span><h2>最近会话</h2></div><button className="text-link" onClick={() => setPage('sessions')}>查看全部 →</button></div>{data.sessions.slice(0, 5).length ? <div className="simple-list">{data.sessions.slice(0, 5).map(s => <button key={s.id} className="list-row" onClick={() => showSession(s.id)}><span><strong>{basename(s.workspace ?? '未知工作空间')}</strong><small>{s.id}</small></span><span>{dateTime(s.lastActivityAt)} →</span></button>)}</div> : <Empty text="所选时间内没有 Codex 会话。" />}</section>
        </>}
        {page === 'usage' && <><div className="metric-grid"><Metric label="当前记录" value={humanNumber(usageRows.length)} hint="按筛选范围" /><Metric label="本期 Token" value={typeof usageSection?.totals?.totalTokens === 'number' ? humanNumber(usageSection.totals.totalTokens) : '未知'} hint="不与缓存子集重复相加" /><Metric label="会话记录" value={humanNumber(data.usage?.sections.session?.rows.length)} hint="来自 ccusage" /><Metric label="上游版本" value={data.usage?.version ?? '不可用'} hint="ccusage" /></div><section className="card"><div className="section-head"><div><span className="eyebrow">USAGE LEDGER</span><h2>精细用量</h2></div><span className="muted">费用为上游估算，缺价模型另行标注</span></div><div className="tabs">{([['daily', '日'], ['weekly', '周'], ['monthly', '月'], ['session', '会话']] as const).map(([kind, label]) => <button key={kind} className={usageKind === kind ? 'active' : ''} onClick={() => setUsageKind(kind)}>{label}</button>)}</div>{usageRows.length ? <div className="table-wrap"><table><thead><tr><th>周期 / 会话</th><th>Agent</th><th>模型</th><th>输入</th><th>输出</th><th>缓存读</th><th>缓存写</th><th>总 Token</th><th>费用</th></tr></thead><tbody>{usageRows.map((r, i) => <tr key={`${r.period}-${r.agent}-${i}`}><td>{r.period}</td><td>{r.agent}</td><td>{r.models.join(', ') || '未知'}</td><td>{humanNumber(r.inputTokens)}</td><td>{humanNumber(r.outputTokens)}</td><td>{humanNumber(r.cacheReadTokens)}</td><td>{humanNumber(r.cacheCreationTokens)}</td><td>{humanNumber(r.totalTokens)}</td><td>{r.pricing === 'unpriced' ? `${money(r.costUSD)} 已计价，另有未计价` : r.pricing === 'hidden' ? '已隐藏' : money(r.costUSD)}</td></tr>)}</tbody></table></div> : <Empty text="当前范围没有用量记录，或用量来源未完成。" />}</section><div className="footnote">下载 JSON 可查看 {allUsage.length} 条完整维度记录及来源原字段。</div></>}
        {page === 'environment' && <section className="card"><div className="section-head"><div><span className="eyebrow">INVENTORY</span><h2>本地环境清单</h2></div><span className="muted">{resources.length} 项资源</span></div>{resources.length ? <div className="table-wrap"><table><thead><tr><th>名称</th><th>Agent</th><th>类型</th><th>作用域</th><th>路径</th><th>大小</th><th>载入 / 使用</th></tr></thead><tbody>{resources.map(r => <tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.agent}</td><td>{r.kind}</td><td>{r.scope === 'user' ? '用户' : '项目'}</td><td className="path-cell" title={r.path}>{r.path}</td><td>{r.sizeBytes == null ? '未知' : humanNumber(r.sizeBytes) + ' B'}</td><td>{r.loaded === 'observed' ? '已观察' : '未验证'} / {r.used === 'observed' ? '已观察' : '未验证'}</td></tr>)}</tbody></table></div> : <Empty text="没有发现匹配的资源。检查来源目录或筛选条件。" />}</section>}
        {page === 'sessions' && <div className="two-cols sessions-layout"><section className="card"><div className="section-head"><div><span className="eyebrow">CODEX SESSIONS</span><h2>会话列表</h2></div><span className="muted">{sessions.length} 个</span></div>{sessions.length ? <div className="simple-list">{sessions.map(s => <button key={s.id} className={`list-row ${s.id === sessionId ? 'selected' : ''}`} onClick={() => setSessionId(s.id)}><span><strong>{basename(s.workspace ?? '未知工作空间')}</strong><small>{s.id}</small></span><span>{s.eventCount} 事件 →</span></button>)}</div> : <Empty text="所选时间内没有匹配的会话。" />}</section><section className="card"><div className="section-head"><div><span className="eyebrow">EVIDENCE</span><h2>{selectedSession ? '会话时间线' : '选择一个会话'}</h2></div></div>{selectedSession ? <><div className="session-meta">{selectedSession.sourceFile}<br />{dateTime(selectedSession.startedAt)} — {dateTime(selectedSession.lastActivityAt)}</div><div className="timeline">{selectedEvents.map(e => <div key={e.id} className="timeline-row"><span className="timeline-node" /><div><strong>{eventLabel(e.type)} {e.tool || ''}</strong><p>{e.target || (e.bytes != null ? `${humanNumber(e.bytes)} B` : '')}</p><small>{dateTime(e.timestamp)} · {e.evidence.file}:{e.evidence.line}</small></div></div>)}</div>{selectedEvents.length === 0 && <Empty text="此会话没有可展示的工具或压缩事件。" />}</> : <Empty text="从左侧选择会话后查看事件和源日志行号。" />}</section></div>}
        {page === 'findings' && <section className="card"><div className="section-head"><div><span className="eyebrow">REVIEW BEFORE ACTION</span><h2>发现与建议预览</h2></div><span className="muted">只读 · 不会修改配置</span></div>{findings.length ? <div className="finding-grid">{findings.map(f => <FindingCard key={f.id} item={f} onSession={showSession} />)}</div> : <Empty text="当前没有匹配的发现。" />}</section>}
        <footer>Wombat · 袋熊 · 本地报告 · 依据扫描时可获取的证据生成。路径可能包含个人信息，分享前请检查。</footer>
      </div>
    </main>
  </div>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="metric"><div>{label}</div><strong>{value}</strong><small>{hint}</small></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function stateLabel(state: string) { return ({ success: '完成', partial: '部分完成', empty: '无数据', unsupported: '未支持', permission_denied: '无权限', failed: '失败', cancelled: '已取消' } as Record<string, string>)[state] ?? state; }
function eventLabel(type: string) { return ({ tool_call: '工具调用', tool_output: '工具输出', compaction: '上下文压缩', error: '错误' } as Record<string, string>)[type] ?? type; }
function FindingCard({ item, compact, onSession }: { item: Finding; compact?: boolean; onSession: (id: string) => void }) { return <article className={`finding ${compact ? 'compact' : ''}`}><div className="finding-top"><span className={`severity ${item.severity}`}>{item.severity === 'actionable' ? '建议处理' : item.severity === 'review' ? '建议审查' : '信息'}</span><span>{item.agent}</span></div><h3>{item.title}</h3><p>{item.fact}</p>{!compact && <>{item.hypothesis && <div className="finding-detail"><b>可能原因</b>{item.hypothesis}</div>}{item.recommendation && <div className="finding-detail"><b>建议</b>{item.recommendation}</div>}{item.diff && <pre>{item.diff}</pre>}</>}<div className="finding-bottom"><span>{item.confidence === 'fact' ? '确定事实' : item.confidence === 'indication' ? '较强迹象' : '待人工判断'} · {evidenceLabel(item)}</span>{item.sessionId && <button className="text-link" onClick={() => onSession(item.sessionId!)}>查看会话 →</button>}</div></article>; }

createRoot(document.getElementById('root')!).render(snapshot ? <App data={snapshot} /> : <div className="missing">缺少扫描快照。请使用 wombat scan 或 wombat report 生成完整报告。</div>);
