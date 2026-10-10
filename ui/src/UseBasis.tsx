import type { ConfigItem } from '@wombat/client';
import { t, useBasisPresentation } from '@wombat/client/locale';
/** Display only: scope, coverage and count availability come from the core. */
export function UseBasis({ basis }: { basis: ConfigItem['useBasis'] }) {
  const text = useBasisPresentation(basis);
  return (
    <section className="use-basis">
      <h4>{t('useBasis.title')}</h4>
      <p>{text.summary}</p>
      {text.notes.map((note) => (
        <p className="note" key={note}>
          {note}
        </p>
      ))}
      {!!text.details.length && (
        <details className="provenance">
          <summary>{t('useBasis.scope')}</summary>
          {text.details.map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
        </details>
      )}
    </section>
  );
}
