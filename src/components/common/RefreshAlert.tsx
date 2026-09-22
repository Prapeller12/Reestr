import { useState } from 'react';
import type { ApiError } from '../../api/errors';
import Icon from './Icon';

interface Props {
  /** Ошибки повторной загрузки по запросам (null — запрос обновился успешно). */
  errors: (ApiError | null)[];
  /** Идёт повторная загрузка — «Повторить» неактивна. */
  busy: boolean;
  onRetry: () => void;
}

// Плашка «Не удалось обновить реестр» (фикс QA F3 (л), ревью). Повторная загрузка упала, но
// прежние данные остались на экране (stale-while-revalidate в useCommand) — сообщаем об этом,
// а не теряем ошибку молча. Скрывается крестиком до следующей новой ошибки; исчезает сама,
// когда все запросы обновились успешно.
function RefreshAlert({ errors, busy, onRetry }: Props) {
  // Снимок ошибок на момент «скрыть»: новая ошибка (другой объект) показывает плашку снова.
  const [dismissed, setDismissed] = useState<(ApiError | null)[] | null>(null);
  const hasError = errors.some((e) => e !== null);
  const isDismissed =
    dismissed !== null &&
    dismissed.length === errors.length &&
    errors.every((e, i) => e === dismissed[i]);
  if (!hasError || isDismissed) return null;

  const first = errors.find((e): e is ApiError => e !== null);

  return (
    <div className="refresh-alert print-hide" role="alert">
      <div className="refresh-alert__text">
        <span className="refresh-alert__title">Не удалось обновить реестр</span>
        {first ? <span className="refresh-alert__detail">{first.message}</span> : null}
      </div>
      <button type="button" className="btn btn_secondary" disabled={busy} onClick={onRetry}>
        Повторить
      </button>
      <button
        type="button"
        className="btn btn_icon"
        aria-label="Скрыть"
        onClick={() => setDismissed(errors)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

export default RefreshAlert;
