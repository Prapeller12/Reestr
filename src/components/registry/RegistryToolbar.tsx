import DocFilterBar from '../common/DocFilterBar';
import type { DocFilters } from '../../hooks/useDocFilters';

interface Props {
  docFilters: DocFilters;
  shownLabel: string;
  hideClosed: boolean;
  onToggleHideClosed: () => void;
}

// Секция фильтров реестра (QA-3 пп.4, 5, 10): общий DocFilterBar (поиск, вид, фильтры, «Сбросить»)
// + «Скрыть завершённые» + счётчик. Самостоятельная карточка над таблицей — не скроллится с ней.
// Кнопка импорта — в шапке (PageHeader), чтобы не скакать при переносе фильтров (п.2/п.7).
function RegistryToolbar({ docFilters, shownLabel, hideClosed, onToggleHideClosed }: Props) {
  return (
    <DocFilterBar
      docFilters={docFilters}
      className="card card_shadow print-hide"
      extra={
        <button
          type="button"
          className={`pill${hideClosed ? ' pill_active' : ''}`}
          aria-pressed={hideClosed}
          onClick={onToggleHideClosed}
        >
          Скрыть завершённые
        </button>
      }
      summary={shownLabel}
    />
  );
}

export default RegistryToolbar;
