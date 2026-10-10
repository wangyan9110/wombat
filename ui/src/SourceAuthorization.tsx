import { useEffect, useState } from 'react';
import type { UsageClient, ConfigResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { QueryError } from './Feedback.js';

type CopyStatus = 'optimize.copied' | 'optimize.copyFailed';
/** Read startup authorization even when the first source scan has failed. */
export function SourceAuthorization({ client }: { client: UsageClient }) {
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{ result?: ConfigResult; error?: string; code?: string }>({}),
    [copy, setCopy] = useState<CopyStatus>();
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    void client.config?.({ action: 'capabilities' }, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setState({ result });
      },
      (error) => {
        if (!controller.signal.aborted) setState({ error: error.message, code: error.code });
      },
    );
    return () => controller.abort();
  }, [client, attempt]);
  if (state.error)
    return (
      <QueryError error={state.error} code={state.code} retry={() => setAttempt((n) => n + 1)} />
    );
  if (!state.result) return <p>{t(client.config ? 'webui.loading' : 'webui.unknown')}</p>;
  const result = state.result;
  return (
    <section className="source-card">
      <h3>{t('webui.startupScope')}</h3>
      <p>{t('webui.authorizationNote')}</p>
      <h4>{t('webui.logRoots')}</h4>
      {result.authorizedSourceRoots?.length ? (
        result.authorizedSourceRoots.map((root) => (
          <p key={root}>
            <code>{root}</code>
          </p>
        ))
      ) : (
        <p>{t('webui.unknown')}</p>
      )}
      <h4>{t('webui.configRoots')}</h4>
      {result.authorizedProjects.map((root) => (
        <p key={root}>
          <code>{root}</code>
        </p>
      ))}
      <p>{t('webui.sourceRecovery')}</p>
      {result.hostRestartCommand && (
        <details>
          <summary>{t('webui.restartHost')}</summary>
          <p>{t('webui.restartNote')}</p>
          <code>{result.hostRestartCommand}</code>
          <p>
            <button
              onClick={() => {
                void (
                  navigator.clipboard
                    ? navigator.clipboard.writeText(result.hostRestartCommand!)
                    : Promise.reject(new Error())
                ).then(
                  () => setCopy('optimize.copied'),
                  () => setCopy('optimize.copyFailed'),
                );
              }}
            >
              {t('webui.copyRestart')}
            </button>
          </p>
          <p role="status">{copy ? t(copy) : ''}</p>
        </details>
      )}
    </section>
  );
}
