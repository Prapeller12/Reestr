import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { DocFilters } from '../../hooks/useDocFilters';
import type { KindMode } from '../../lib/docFilters';
import FilterDropdown from '../registry/FilterDropdown';
import SegmentedControl from './SegmentedControl';
import type { SegmentedOption } from './SegmentedControl';
import Icon from './Icon';

interface Props {
  docFilters: DocFilters;
  /** Микс с блоком-владельцем: карточка реестра или элемент панели окна тем. */
  className?: string;
  /** Поиск на всю первую строку (окно тем). */
  searchWide?: boolean;
  /** Дополнительные быстрые переключатели (реестр: «Скрыть завершённые»). */
  extra?: ReactNode;
  /** Счётчик справа (реестр: «Показано N из M»). */
  summary?: ReactNode;
}

const KINDS: SegmentedOption<KindMode>[] = [
  { value: 'all', label: 'Все' },
  { value: 'outgoing', label: 'Исходящие' },
  { value: 'incoming', label: 'Входящие' },
];

// Общая секция фильтров (QA-3 пп.4, 5, 10): «Реестр» и окно тем. Порядок: поиск, тип письма,
// Статус, Тема, Подписант, Адресаты, extra, «Сбросить», счётчик. Зона фильтров
// (toolbar__filters, flex 1 1 0%) стоит в строке поиска и переносится только внутри себя.
// «Сбросить» рендерится всегда (место зарезервировано): появление кнопки не переносит строку.
function DocFilterBar({ docFilters: f, className, searchWide = false, extra, summary }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  // После сброса кнопка скрывается (disabled) — фокус ушёл бы на body; переводим его в поиск.
  const handleReset = (): void => {
    f.reset();
    searchRef.current?.focus();
  };

  return (
    <section
      className={`filter-bar${className ? ` ${className}` : ''}`}
      aria-label="Поиск и фильтры"
    >
      <div className={`toolbar__search${searchWide ? ' toolbar__search_wide' : ''}`}>
        <Icon name="search" size={20} className="toolbar__glyph" />
        <input
          ref={searchRef}
          className="toolbar__input"
          value={f.query}
          onChange={(e) => f.setQuery(e.target.value)}
          placeholder="Поиск по заголовку или рег. номеру"
        />
        {f.query ? (
          <button type="button" className="toolbar__clear" onClick={() => f.setQuery('')}>
            <Icon name="clear" />
          </button>
        ) : null}
      </div>

      <div className="toolbar__filters">
        <SegmentedControl label="Тип письма" options={KINDS} value={f.kind} onChange={f.setKind} />

        {f.models.map((m) => (
          <FilterDropdown
            key={m.key}
            label={m.label}
            valueLabel={m.valueLabel}
            active={m.active}
            open={f.openMenu === m.key}
            options={m.options}
            onToggle={() => f.toggleMenu(m.key)}
            onPick={(value) => f.pick(m.key, value)}
          />
        ))}

        {extra}

        <button
          type="button"
          className={`btn btn_danger-ghost toolbar__reset${f.anyFilter ? '' : ' toolbar__reset_hidden'}`}
          disabled={!f.anyFilter}
          aria-hidden={f.anyFilter ? undefined : true}
          tabIndex={f.anyFilter ? undefined : -1}
          onClick={handleReset}
        >
          Сбросить
        </button>
      </div>

      {summary ? <div className="toolbar__shown">{summary}</div> : null}
    </section>
  );
}

export default DocFilterBar;
