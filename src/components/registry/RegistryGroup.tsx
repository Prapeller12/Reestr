import type { DocKind, DocumentView } from '../../api/types';
import { lettersLabel } from '../../lib/texts';
import RegistryRow from './RegistryRow';
import Icon from '../common/Icon';

export interface GroupRow {
  num: number;
  doc: DocumentView;
}

interface Props {
  name: string;
  rows: GroupRow[];
  open: boolean;
  onToggle: (name: string) => void;
  onConfigure: (name: string) => void;
  onOpenDoc: (kind: DocKind, regNumber: string) => void;
}

// Подписи колонок (без № — под него в шапке пустая ячейка). Порядок — «Согласованные решения».
const COLUMNS = [
  'Рег. номер',
  'Тип',
  'Заголовок',
  'Статус',
  'Адресаты',
  'Подписант',
  'Дата регистрации',
  'Срок исполнения',
  'Исполнение',
  'Ссылка',
];

// Группа темы: сворачиваемая шапка (шеврон вниз/вправо) + кнопка «настроить тему» + шапка колонок + строки.
function RegistryGroup({ name, rows, open, onToggle, onConfigure, onOpenDoc }: Props) {
  const countLabel = lettersLabel(rows.length);
  return (
    <div className="registry-table__group">
      <div className="registry-table__group-header">
        {/* Левый кластер прилипает к левому краю при горизонтальном скролле (п.1):
            имя темы и гайка видны всегда, без прокрутки вправо. */}
        <div className="registry-table__group-lead">
          <button
            type="button"
            className="registry-table__group-toggle"
            onClick={() => onToggle(name)}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} className="registry-table__caret" />
            <span className="registry-table__group-name">{name}</span>
            <span className="registry-table__group-count">{countLabel}</span>
          </button>
          <button
            type="button"
            className="registry-table__group-config print-hide"
            title="Распределить письма по темам"
            onClick={(e) => {
              e.stopPropagation();
              onConfigure(name);
            }}
          >
          <Icon name="settings" size={20} className="btn__ico" />
        </button>
        </div>
      </div>

      {open ? (
        <div>
          <div className="registry-table__head">
            <div />
            {COLUMNS.map((c, i) => (
              <div
                key={c}
                className={`registry-table__th${i === 0 ? ' registry-table__th_first' : ''}`}
              >
                {c}
              </div>
            ))}
          </div>
          {rows.map((r) => (
            <RegistryRow key={r.doc.regNumber} num={r.num} doc={r.doc} onOpen={onOpenDoc} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default RegistryGroup;
