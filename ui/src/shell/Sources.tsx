import type { UsageClient } from '@wombat/client';
import { t, sourceReadLabel } from '@wombat/client/locale';
import { Heading } from '../components.js';
import { DirectoryAuthorization } from '../DirectoryAuthorization.js';
import { SourceAuthorization } from '../SourceAuthorization.js';
import type { WorkspaceData } from '../useWorkspace.js';
export function Sources({
  client,
  onChanged,
  data,
  result = data?.overview,
  retry,
  compact = false,
}: {
  client: UsageClient;
  onChanged: () => void;
  data?: WorkspaceData;
  result?: import('@wombat/client').UsageResult;
  retry: () => void;
  compact?: boolean;
}) {
  return (
    <>
      {compact ? (
        <p>{t('webui.sourceLocal')}</p>
      ) : (
        <Heading title={t('webui.sources')} sub={t('webui.sourceLocal')}>
          <button onClick={retry}>{t('webui.retry')}</button>
        </Heading>
      )}
      <DirectoryAuthorization client={client} onChanged={onChanged} />
      <SourceAuthorization client={client} />
      {result?.quality.sources.map((s) => (
        <section className="source-card" key={s.source.id}>
          <strong>{s.source.agentKind}</strong>
          {s.status !== 'complete' && <p>{t('webui.sourceRecovery')}</p>}
          <span className="tag">{sourceReadLabel(s)}</span>
          <p>
            <code>{s.source.id}</code>
          </p>
          <p>
            <code>{s.source.root}</code>
          </p>
          <dl className="facts">
            <dt>{t('webui.sourceVersions')}</dt>
            <dd>{s.sourceVersions?.join(', ') || t('webui.unknown')}</dd>
            <dt>{t('webui.capabilities')}</dt>
            <dd>
              {Object.entries(s.capabilities)
                .filter(([, v]) => v === true)
                .map(([k]) => k)
                .join(' · ')}
            </dd>
          </dl>
          {s.issues.map((issue, i) => (
            <p key={i}>
              {issue.code}: {issue.message}
            </p>
          ))}
        </section>
      ))}
      {result?.quality.issues.map((issue, i) => (
        <p key={i}>
          {issue.code}: {issue.message}
        </p>
      ))}
    </>
  );
}
