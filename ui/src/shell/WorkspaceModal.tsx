import type { UsageClient, UsageResult, UsageSummary } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { Basis, Modal } from '../components.js';
import type { Route } from '../state.js';
import type { WorkspaceData } from '../workspace.js';
import { Sources } from './Sources.js';
import { Filters } from './Filters.js';

export type WorkspaceModalSelection =
  'dates' | 'filters' | 'scope' | 'sources' | 'help' | UsageSummary;
export function WorkspaceModal({
  selection,
  route,
  client,
  data,
  result,
  onClose,
  onPrices,
  onChanged,
  retry,
  apply,
}: {
  selection: WorkspaceModalSelection;
  route: Route;
  client: UsageClient;
  data?: WorkspaceData;
  result?: UsageResult;
  onClose: () => void;
  onPrices: () => void;
  onChanged: () => void;
  retry: () => void;
  apply: (patch: Partial<Route>) => void;
}) {
  const helpPage = route.page === 'sources' || route.page === 'prices' ? 'usage' : route.page;
  return (
    <Modal
      title={
        typeof selection === 'object'
          ? t('webui.basis')
          : selection === 'scope'
            ? t('webui.scope')
            : t(`webui.${selection}`)
      }
      onClose={onClose}
    >
      {typeof selection === 'object' ? (
        <Basis summary={selection} onPrices={onPrices} />
      ) : selection === 'sources' ? (
        <Sources
          onChanged={onChanged}
          client={client}
          compact
          data={data}
          result={result}
          retry={retry}
        />
      ) : selection === 'help' ? (
        <p>{t(`help.${helpPage}`)}</p>
      ) : selection === 'scope' ? (
        <>
          <p>{t('webui.scopeNote')}</p>
          {route.project && <code>{route.project}</code>}
        </>
      ) : (
        <Filters kind={selection} route={route} data={data} apply={apply} />
      )}
    </Modal>
  );
}
