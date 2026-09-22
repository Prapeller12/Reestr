import { formatIsoDate } from '../../lib/dates';
import { remainingFor } from '../../lib/format';
import StatusBadge from './StatusBadge';
import TypeChip from './TypeChip';
import type { RegistryGroupModel } from './RegistryView';

interface Props {
  groups: RegistryGroupModel[];
}

// Печатное представление реестра: НА КАЖДУЮ тему-группу — отдельная <table> со своим <thead>.
// Браузер повторяет <thead> на КАЖДОМ листе группы (display:table-header-group, print.css),
// а сам <thead> содержит ДВЕ строки: (1) название темы во всю ширину, (2) заголовки колонок.
// Поэтому на любом листе, который занимает группа, видно И тему, И шапку колонок; заголовок
// темы больше не «сиротеет» внизу предыдущего листа — он часть <thead> и всегда печатается
// вместе со своими строками. Экранный CSS-грид (batch 1) не трогаем — эти таблицы видны
// только на печати (см. print.css). Ширины колонок заданы через <colgroup> (надёжно для
// table-layout:fixed при colspan-строке темы в шапке). Колонки — как на экране, минус
// «Ссылка» (на бумаге не нужна, как и раньше).
const COLUMNS = [
  '№',
  'Рег. номер',
  'Тип',
  'Заголовок',
  'Статус',
  'Адресаты',
  'Подписант',
  'Дата регистрации',
  'Срок исполнения',
  'Исполнение',
];

function RegistryPrintTable({ groups }: Props) {
  if (groups.length === 0) return null;
  return (
    <div className="print-tables">
      {groups.map((g) => (
        <PrintGroupTable key={g.name} group={g} />
      ))}
    </div>
  );
}

function PrintGroupTable({ group }: { group: RegistryGroupModel }) {
  return (
    <table className="print-table">
      <colgroup>
        {COLUMNS.map((c) => (
          <col key={c} className="print-table__col" />
        ))}
      </colgroup>
      <thead>
        <tr className="print-table__group">
          <th className="print-table__group-cell" colSpan={COLUMNS.length}>
            {group.name} · {group.rows.length}
          </th>
        </tr>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c} className="print-table__th">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {group.rows.map(({ num, doc }) => {
          const remaining = remainingFor(doc);
          const remainMod =
            remaining.tone === 'normal' ? '' : ` print-table__remaining_${remaining.tone}`;
          return (
            <tr key={`${doc.kind}:${doc.regNumber}`} className="print-table__row">
              <td className="print-table__num">{num}</td>
              <td className="print-table__reg">{doc.regNumber}</td>
              <td>
                <TypeChip kind={doc.kind} />
              </td>
              <td className="print-table__topic">{doc.topic || '—'}</td>
              <td>
                {doc.status === null ? (
                  '—'
                ) : (
                  <StatusBadge status={doc.status} label={doc.statusLabel ?? ''} />
                )}
              </td>
              <td>{doc.addressees || '—'}</td>
              <td>{doc.signer || '—'}</td>
              <td className="print-table__date">{formatIsoDate(doc.regDate)}</td>
              <td className="print-table__date">{formatIsoDate(doc.dueDate)}</td>
              <td className={`print-table__remaining${remainMod}`}>{remaining.text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default RegistryPrintTable;
