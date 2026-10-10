import {
  allowanceStatus,
  type HandoffRequest,
  type HandoffResult,
  type UsageClient,
} from '@wombat/client';
import { locale, reviewFindingLabel, t } from '@wombat/client/locale';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components.js';
import { QueryError } from '../Feedback.js';
import type { Route } from '../state.js';
import '../account.css';
import { HandoffAllowance, useAllowanceClock } from './Allowance.js';
interface Props {
  client: UsageClient;
  route: Route;
  suggestionId?: string;
  disabled?: boolean;
}
export function HandoffButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button disabled={props.disabled || !props.client.handoff} onClick={() => setOpen(true)}>
        {t(props.suggestionId ? 'handoff.title' : 'handoff.all')}
      </button>
      {open && (
        <HandoffDialog
          key={`${props.route.project}:${props.route.source}`}
          {...props}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function HandoffDialog({ client, route, suggestionId, onClose }: Props & { onClose: () => void }) {
  const [data, setData] = useState<HandoffResult>(),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [stage, setStage] = useState<'choose' | 'review' | 'sent'>('choose');
  const [skillPaths, setSkillPaths] = useState<Record<string, string>>({}),
    [withoutSkill, setWithoutSkill] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<{ message: string; code?: string }>();
  const [operation, setOperation] = useState<HandoffRequest['action']>('preview');
  const pending = useRef<AbortController | undefined>(undefined),
    sending = useRef(false);
  const catalog = useRef<HandoffResult | undefined>(undefined);
  const base: HandoffRequest = {
    project: route.project,
    sourceInstanceId: route.source,
    readView: route.optimizeView,
    decisionRevision: route.decisionRevision,
    ruleOverrides: {
      agentsBytes: route.agentsBytes,
      descriptionCharacters: route.descriptionCharacters,
    },
    language: locale.getSnapshot().locale,
  };
  const run = async (
    request: HandoffRequest,
    nextStage: typeof stage,
    preserveSelection = false,
  ) => {
    if (sending.current) return;
    sending.current = true;
    const c = new AbortController();
    pending.current = c;
    setOperation(request.action ?? 'preview');
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.handoff!(request, { signal: c.signal });
      if (!c.signal.aborted) {
        setData(result);
        setStage(nextStage);
        setSkillPaths((old) =>
          Object.fromEntries(
            result.projects.map((p) => [
              p.id,
              old[p.id] ??
                result.skillChecks?.find((c) => c.projectId === p.id)?.selected?.path ??
                '',
            ]),
          ),
        );
        if (nextStage === 'choose') {
          catalog.current = result;
          setSelected(
            (old) =>
              new Set(
                result.projects.flatMap((p) =>
                  p.targets
                    .filter((target) => !preserveSelection || old.has(target.itemId))
                    .map((target) => target.itemId),
                ),
              ),
          );
        }
      }
    } catch (e) {
      if (!c.signal.aborted) {
        const err = e as Error & { code?: string };
        setError({ message: err.message, code: err.code });
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
      sending.current = false;
    }
  };
  useEffect(() => {
    void run(
      { ...base, action: 'preview', suggestionIds: suggestionId ? [suggestionId] : undefined },
      'choose',
    );
    return () => pending.current?.abort();
  }, [client]);
  const ids =
    data?.projects.flatMap((p) =>
      p.targets
        .filter((target) => selected.has(target.itemId))
        .flatMap((target) => target.suggestionIds),
    ) ?? [];
  const skillSelections = Object.entries(skillPaths)
    .filter(
      ([projectId, selectedPath]) =>
        selectedPath &&
        data?.projects.some(
          (p) => p.id === projectId && p.targets.some((target) => selected.has(target.itemId)),
        ),
    )
    .map(([projectId, path]) => ({ projectId, path }));
  const skillRequest = { withoutSkill, skillSelections };
  const skillReady =
    withoutSkill ||
    (!!data &&
      data.projects
        .filter((p) => p.targets.some((target) => selected.has(target.itemId)))
        .every((p) => {
          const check = data.skillChecks?.find((c) => c.projectId === p.id);
          return (
            check?.discovery.status !== 'unavailable' &&
            check?.discovery.instances.some((i) => i.enabled && i.path === skillPaths[p.id])
          );
        }));
  const review = () =>
    void run(
      {
        ...base,
        ...skillRequest,
        action: 'preview',
        readView: data?.readView,
        decisionRevision: data?.decisionRevision,
        suggestionIds: ids,
      },
      'review',
    );
  const send = () =>
    void run(
      {
        ...base,
        ...skillRequest,
        action: 'send',
        readView: data?.readView,
        decisionRevision: data?.decisionRevision,
        suggestionIds: ids,
        selectionVersion: data?.selectionVersion,
      },
      'sent',
    );
  const now = useAllowanceClock(data);
  const selectedProjects =
    data?.projects.filter((p) => p.targets.some((target) => selected.has(target.itemId))) ?? [];
  const allBlocked =
    selectedProjects.length > 0 &&
    selectedProjects.every((p) => {
      const check = data?.allowanceChecks.find((c) => c.projectId === p.id);
      return check && allowanceStatus(check.assessment, now) === 'blocked';
    });
  const refreshAllowance = () =>
    void run(
      {
        ...base,
        action: 'preview',
        readView: data?.readView,
        decisionRevision: data?.decisionRevision,
        suggestionIds: stage === 'choose' ? (suggestionId ? [suggestionId] : undefined) : ids,
      },
      stage === 'sent' ? 'review' : stage,
      true,
    );
  const retryAllowed = data?.deliveries.some((d) => d.status !== 'accepted');
  return (
    <Modal title={t('handoff.title')} onClose={onClose}>
      <p>{t('handoff.note')}</p>
      <p className="note">{t('handoff.closeNote')}</p>
      {busy && <p role="status">{t(operation === 'send' ? 'handoff.sending' : 'webui.loading')}</p>}
      {error && (
        <QueryError
          operation={operation === 'send' ? 'send' : 'read'}
          error={error.message}
          code={error.code}
          retry={() =>
            data
              ? review()
              : void run(
                  {
                    ...base,
                    action: 'preview',
                    suggestionIds: suggestionId ? [suggestionId] : undefined,
                  },
                  'choose',
                )
          }
        />
      )}
      {data && (
        <>
          <button disabled={busy} onClick={refreshAllowance}>
            {t('account.refreshAllowance')}
          </button>
          {stage === 'choose' && (
            <button
              disabled={busy}
              onClick={() =>
                setSelected(
                  new Set(data.projects.flatMap((p) => p.targets.map((target) => target.itemId))),
                )
              }
            >
              {t('handoff.selectAll')}
            </button>
          )}
          {!data.projects.length && <p>{t('handoff.none')}</p>}
          {data.projects.map((p) => (
            <section className="handoff-project" key={p.id}>
              <code>{p.cwd}</code>
              {stage !== 'sent' && (
                <>
                  <p>{t('handoff.skillLabel')}</p>
                  <select
                    aria-label={t('handoff.skillLabel')}
                    disabled={busy || withoutSkill}
                    value={skillPaths[p.id] ?? ''}
                    onChange={(e) => setSkillPaths((old) => ({ ...old, [p.id]: e.target.value }))}
                  >
                    <option value="">{t('handoff.skillChoose')}</option>
                    {data.skillChecks
                      ?.find((c) => c.projectId === p.id)
                      ?.discovery.instances.filter((i) => i.enabled)
                      .map((i) => (
                        <option key={i.path} value={i.path}>
                          {i.path}
                        </option>
                      ))}
                  </select>
                  {data.skillChecks?.find((c) => c.projectId === p.id)?.discovery.status ===
                    'unavailable' && <p>{t('handoff.skillUnavailable')}</p>}
                </>
              )}
              <HandoffAllowance
                assessment={data.allowanceChecks.find((c) => c.projectId === p.id)?.assessment}
                now={now}
              />
              {p.targets.map((target) => (
                <article className="handoff-target" key={target.itemId}>
                  <label>
                    {stage === 'choose' && (
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={selected.has(target.itemId)}
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (e.target.checked) next.add(target.itemId);
                            else next.delete(target.itemId);
                            return next;
                          })
                        }
                      />
                    )}
                    <code>{target.path}</code>
                  </label>
                  <p className="note">
                    {target.findings.map((f) => reviewFindingLabel(f.rule)).join(' · ')}
                  </p>
                  {target.sharedProjects.length > 1 && (
                    <p className="note">
                      {t('handoff.shared', { projects: target.sharedProjects.join(' · ') })}
                    </p>
                  )}
                  {!target.expectedExists && <p className="note">{t('handoff.missing')}</p>}
                </article>
              ))}
            </section>
          ))}
          {stage !== 'sent' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={withoutSkill}
                  disabled={busy}
                  onChange={(e) => setWithoutSkill(e.target.checked)}
                />
                {t('handoff.withoutSkill')}
              </label>
              {!skillReady && <p role="status">{t('handoff.skillRequired')}</p>}
            </>
          )}
          {stage !== 'sent' && (
            <div className="controls handoff-actions">
              <span>{t('handoff.count', { count: selected.size })}</span>
              {stage === 'choose' ? (
                <button disabled={busy || !selected.size} onClick={review}>
                  {t('handoff.review')}
                </button>
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setData(
                        catalog.current
                          ? { ...catalog.current, allowanceChecks: data.allowanceChecks }
                          : undefined,
                      );
                      setStage('choose');
                    }}
                  >
                    {t('webui.back')}
                  </button>
                  <button
                    disabled={busy || !selected.size || allBlocked || !skillReady}
                    onClick={send}
                  >
                    {t('handoff.confirm')}
                  </button>
                </>
              )}
            </div>
          )}
          {data.deliveries.map((d) => (
            <section className="handoff-delivery" key={d.projectId}>
              <p>
                {t(
                  d.errorCode === 'ALLOWANCE_EXHAUSTED'
                    ? 'account.blockedNote'
                    : d.status === 'accepted'
                      ? 'handoff.accepted'
                      : d.status === 'unknown'
                        ? 'handoff.unknown'
                        : 'handoff.failed',
                )}
              </p>
              <code>{data.projects.find((p) => p.id === d.projectId)?.cwd}</code>
              {d.status === 'failed' && d.errorCode === 'CODEX_UNAVAILABLE' && (
                <p>{t('handoff.unavailableRecovery')}</p>
              )}
              {d.errorCode && <code>{d.errorCode}</code>}
              {d.skillPath && <p>{t('handoff.skillBound', { path: d.skillPath })}</p>}
              {d.threadId && (
                <>
                  <p>{t('handoff.inspect')}</p>
                  <code>codex resume {d.threadId}</code>
                </>
              )}
            </section>
          ))}
          {stage === 'sent' && retryAllowed && (
            <button disabled={busy} onClick={review}>
              {t('handoff.reviewAgain')}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
