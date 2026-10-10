import type {ConfigRequest, ConfigResult, UsageClient} from '@wombat/client';
import {t} from '@wombat/client/locale';

export const inventoryPending = (result: ConfigResult) => result.coverage.historyStatus === 'syncing';

function wait(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
  });
}

/** Follow only an unfinished initial inventory; each pagination pass stays version-pinned. */
export async function followInventory(client: UsageClient, request: ConfigRequest, allPages: boolean,
  signal: AbortSignal, publish: (result: ConfigResult) => void, interval = 3000) {
  if (!client.config) throw new Error(t('webui.unsupported'));
  let current = request;
  let recovered = false;
  for (;;) {
    signal.throwIfAborted();
    let first: ConfigResult;
    try {
      first = await client.config({...current, offset: allPages ? 0 : current.offset, limit: allPages ? 200 : current.limit}, {signal});
    } catch (error) {
      if (!recovered && current.readView && (error as {code?: string}).code === 'VIEW_EXPIRED') {
        recovered = true;
        current = {...request, readView: undefined, snapshotId: undefined};
        continue;
      }
      throw error;
    }
    signal.throwIfAborted();
    if (allPages) {
      const items = [...first.items];
      const activityItems=[...(first.extensionActivity?.items??[])];
      let offset = first.page.nextOffset;
      while (offset != null) {
        if (items.length >= 20_000) throw new Error(t('webui.partial'));
        const next = await client.config({...current, readView: first.readView, snapshotId: undefined, offset, limit: 200}, {signal});
        signal.throwIfAborted();
        items.push(...next.items);
        activityItems.push(...(next.extensionActivity?.items??[]));
        if (next.page.nextOffset != null && next.page.nextOffset <= offset) throw new Error(t('webui.failed'));
        offset = next.page.nextOffset;
      }
      first = {...first, items, ...(first.extensionActivity?{extensionActivity:{...first.extensionActivity,items:activityItems}}:{}), page: {...first.page, offset: 0, total: items.length, limit: items.length, nextOffset: null}};
    }
    publish(first);
    // An old URL may pin a view captured before history was available. Try a new
    // view once, but do not keep retrying an actual persistent source failure.
    const unavailablePin = !recovered && !!current.readView && first.coverage.historyStatus === 'unavailable';
    if (!inventoryPending(first) && !unavailablePin) return;
    recovered = true;
    await wait(signal, interval);
    current = {...request, readView: undefined, snapshotId: undefined};
  }
}
