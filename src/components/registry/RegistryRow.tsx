import type { DocKind, DocumentView } from '../../api/types';
import { formatIsoDate } from '../../lib/dates';
import { remainingFor } from '../../lib/format';
import StatusBadge from './StatusBadge';
import TypeChip from './TypeChip';

interface Props {
  num: number;
  doc: DocumentView;
  onOpen: (kind: DocKind, regNumber: string) => void;
}

// Строка реестра: 11 колонок грида (порядок — «Согласованные решения» QA-батча):
// № · Рег. номер · Тип · Заголовок · Статус · Адресаты · Подписант · Дата регистрации ·
// Срок исполнения · Исполнение · Ссылка. Все значения — факты backend.
// Тип (ИСХ/ВХ) — отдельной колонкой (п.6); персоны (адресат/подписант) — простым текстом (п.8).
// Строки фикс. высоты: длинный текст обрезается многоточием, полный — в нативном title (п.4).
function RegistryRow({ num, doc, onOpen }: Props) {
  const remaining = remainingFor(doc);
  const remainMod = remaining.tone === 'normal' ? '' : ` registry-table__remaining_${remaining.tone}`;
  return (
    <button
      type="button"
      className="registry-table__row"
      onClick={() => onOpen(doc.kind, doc.regNumber)}
    >
      <span className="registry-table__num">{num}</span>
      <span className="registry-table__reg" title={doc.regNumber}>
        {doc.regNumber}
      </span>
      <span className="registry-table__type">
        <TypeChip kind={doc.kind} />
      </span>
      <span className="registry-table__topic" title={doc.topic}>
        {doc.topic || '—'}
      </span>
      <span>
        {doc.status === null ? (
          <span className="registry-table__dash">—</span>
        ) : (
          <StatusBadge status={doc.status} label={doc.statusLabel ?? ''} />
        )}
      </span>
      <span className="registry-table__text" title={doc.addressees}>
        {doc.addressees || '—'}
      </span>
      <span className="registry-table__text" title={doc.signer}>
        {doc.signer || '—'}
      </span>
      <span className="registry-table__date">{formatIsoDate(doc.regDate)}</span>
      <span className="registry-table__date">{formatIsoDate(doc.dueDate)}</span>
      <span className={`registry-table__remaining${remainMod}`}>{remaining.text}</span>
      <span className="registry-table__link" title={doc.ref}>
        {doc.ref}
      </span>
    </button>
  );
}

export default RegistryRow;
