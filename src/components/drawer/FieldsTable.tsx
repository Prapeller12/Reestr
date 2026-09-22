import { Fragment, useState } from 'react';
import { clearDeadline, setDeadline } from '../../api/commands';
import { toApiError } from '../../api/errors';
import type { DocumentView } from '../../api/types';
import { formatIsoDate, isoToEpochDay } from '../../lib/dates';
import { docKey } from '../../lib/format';
import DatePicker from '../common/DatePicker';
import EditableField from './EditableField';

interface Props {
  doc: DocumentView;
  todayEpoch: number | null;
  onChanged: () => void;
}

type Editing = 'signer' | 'addressees' | 'deadline' | null;

// Поля письма — «Поле / Значение». Набор зависит от вида (§6.1):
// исходящий — Получатель/Подписант/Срок; входящий — Корреспондент (без статуса/подписанта/срока).
// У ИСХОДЯЩИХ Подписант/Адресаты редактируются инлайн (§3), Срок исполнения ставится календарём (§4)
// с даты регистрации письма (QA-3 п.1: прошлые даты разрешены, раньше regDate — нельзя).
function FieldsTable({ doc, todayEpoch, onChanged }: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dash = (v: string): string => (v ? v : '—');

  const applyDeadline = async (iso: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDeadline(doc.regNumber, iso);
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const resetDeadline = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearDeadline(doc.regNumber);
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (doc.kind === 'incoming') {
    const fields: { k: string; v: string }[] = [
      { k: 'Регистрационный номер', v: dash(doc.regNumber) },
      { k: 'Дата регистрации', v: formatIsoDate(doc.regDate) },
      { k: 'Корреспондент', v: dash(doc.counterparty) },
      { k: 'Заголовок', v: dash(doc.topic) },
      { k: 'Адресаты', v: dash(doc.addressees) },
      { k: 'Ссылка', v: dash(doc.ref) },
    ];
    return (
      <div className="doc-fields">
        <div className="doc-fields__head">Поле</div>
        <div className="doc-fields__head">Значение</div>
        <div className="doc-fields__head" />
        {fields.map((f) => (
          <Fragment key={f.k}>
            <div className="doc-fields__key">{f.k}</div>
            <div className="doc-fields__value">{f.v}</div>
            <div className="doc-fields__action" />
          </Fragment>
        ))}
      </div>
    );
  }

  // Исходящий: перемежаем обычные строки с редактируемыми.
  const deadlineEpoch = isoToEpochDay(doc.dueDate ?? '');
  const regEpoch = isoToEpochDay(doc.regDate); // нижняя граница календаря; null — без границы
  // «Сегодня» нужно календарю не для границы, а для маркера и запасного стартового месяца.
  const canEditDeadline = todayEpoch !== null;

  const plainRow = (k: string, v: string) => (
    <Fragment key={k}>
      <div className="doc-fields__key">{k}</div>
      <div className="doc-fields__value">{v}</div>
      <div className="doc-fields__action" />
    </Fragment>
  );

  return (
    <div className="doc-fields">
      <div className="doc-fields__head">Поле</div>
      <div className="doc-fields__head">Значение</div>
      <div className="doc-fields__head" />

      {plainRow('Регистрационный номер', dash(doc.regNumber))}
      {plainRow('Дата регистрации', formatIsoDate(doc.regDate))}

      <div className="doc-fields__key">Срок исполнения</div>
      <div className="doc-fields__value">
        {canEditDeadline ? (
          <div className="field-edit">
            <span className="field-edit__text">{formatIsoDate(doc.dueDate)}</span>
          </div>
        ) : (
          formatIsoDate(doc.dueDate)
        )}
      </div>
      <div className="doc-fields__action">
        {canEditDeadline ? (
          <button
            type="button"
            className="field-edit__btn"
            onClick={() => setEditing(editing === 'deadline' ? null : 'deadline')}
          >
            {editing === 'deadline' ? 'Отмена' : 'Изменить'}
          </button>
        ) : null}
      </div>

      {/* Календарь — отдельной строкой во всю ширину таблицы: в узкой колонке значения
          (карточка фиксирована 560px) он был раздавлен — сетка месяца ломалась. */}
      {canEditDeadline && editing === 'deadline' && todayEpoch !== null ? (
        <div className="doc-fields__expand">
          <DatePicker
            key={docKey(doc.kind, doc.regNumber)}
            valueEpoch={deadlineEpoch}
            minEpoch={regEpoch}
            todayEpoch={todayEpoch}
            onPick={(iso) => void applyDeadline(iso)}
            onReset={() => void resetDeadline()}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : null}
      {canEditDeadline && error && editing === 'deadline' ? (
        <div className="doc-fields__expand">
          <div className="field-edit__error">{error}</div>
        </div>
      ) : null}

      {plainRow('Получатель', dash(doc.counterparty))}
      {plainRow('Заголовок', dash(doc.topic))}

      <div className="doc-fields__key">Подписант</div>
      <EditableField
        regNumber={doc.regNumber}
        field="signer"
        role="signer"
        value={doc.signer}
        edited={doc.signerEdited}
        editing={editing === 'signer'}
        onStartEdit={() => setEditing('signer')}
        onStopEdit={() => setEditing(null)}
        onChanged={onChanged}
      />

      <div className="doc-fields__key">Адресаты</div>
      <EditableField
        regNumber={doc.regNumber}
        field="addressees"
        role="addressee"
        value={doc.addressees}
        edited={doc.addresseesEdited}
        editing={editing === 'addressees'}
        onStartEdit={() => setEditing('addressees')}
        onStopEdit={() => setEditing(null)}
        onChanged={onChanged}
      />

      {plainRow('Ссылка', dash(doc.ref))}
    </div>
  );
}

export default FieldsTable;
