import type { DocKind, DocumentView } from '../../api/types';
import type { DocFilters } from '../../hooks/useDocFilters';
import { docKey } from '../../lib/format';
import TypeChip from '../registry/TypeChip';
import DocFilterBar from '../common/DocFilterBar';
import Icon from '../common/Icon';

interface Props {
  /** Видимые письма (после фильтров окна). */
  docs: DocumentView[];
  totalCount: number;
  docFilters: DocFilters;
  // Ключ выбора — пара (вид, рег.номер) через docKey (§5.6): исх./вх. делят рег.номер.
  selected: Record<string, boolean>;
  onToggle: (kind: DocKind, regNumber: string) => void;
  onToggleAll: () => void;
  selCount: number;
}

// Левая панель окна тем (QA-3 п.5): заголовок + счётчик, общий фильтр (как в «Реестре», без
// «Скрыть завершённые»), список писем с чекбоксами. Выбор всегда ⊆ видимого (подрезает ThemesModal).
function ThemesDocsPanel({
  docs,
  totalCount,
  docFilters,
  selected,
  onToggle,
  onToggleAll,
  selCount,
}: Props) {
  const empty = docs.length === 0;
  const allOn = !empty && docs.every((d) => selected[docKey(d.kind, d.regNumber)]);
  const someOn = docs.some((d) => selected[docKey(d.kind, d.regNumber)]);
  const allMark = allOn ? (
    <Icon name="check" size={14} />
  ) : someOn ? (
    <Icon name="minus" size={14} />
  ) : null;

  return (
    <div className="card themes-docs">
      <div className="card__toolbar">
        <div className="card__title">Письма</div>
        <div className="page__spacer" />
        <div className="themes-docs__sel">
          {`Показано ${docs.length} из ${totalCount}. `}
          {selCount ? `Выбрано: ${selCount}` : 'Письма не выбраны'}
        </div>
      </div>

      <DocFilterBar docFilters={docFilters} className="themes-docs__filters" searchWide />

      <div className="themes-docs__head">
        <button
          type="button"
          className={`themes-docs__box${someOn ? ' themes-docs__box_on' : ''}`}
          disabled={empty}
          aria-label="Отметить все видимые"
          onClick={onToggleAll}
        >
          {allMark}
        </button>
        <div className="themes-docs__th">Заголовок</div>
        <div className="themes-docs__th">Рег. номер</div>
        <div className="themes-docs__th">Тема</div>
      </div>

      <div className="themes-docs__list">
        {empty ? (
          <div className="themes-docs__empty">Ничего не найдено. Измените условия поиска.</div>
        ) : (
          docs.map((d) => {
            const on = !!selected[docKey(d.kind, d.regNumber)];
            return (
              <button
                key={docKey(d.kind, d.regNumber)}
                type="button"
                className={`themes-docs__row${on ? ' themes-docs__row_on' : ''}`}
                onClick={() => onToggle(d.kind, d.regNumber)}
              >
                <span className={`themes-docs__box${on ? ' themes-docs__box_on' : ''}`}>
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
                <span className="themes-docs__title">
                  <TypeChip kind={d.kind} />
                  <span className="themes-docs__topic">{d.topic}</span>
                </span>
                <span className="themes-docs__reg">{d.regNumber}</span>
                <span>
                  <span className={`themes-docs__theme${d.theme ? ' themes-docs__theme_set' : ''}`}>
                    {d.theme ?? 'Без темы'}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ThemesDocsPanel;
