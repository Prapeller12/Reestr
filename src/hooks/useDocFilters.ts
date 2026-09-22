// Состояние фильтра писем (QA-3 пп.4, 5): поиск, вид, выпадающие фильтры, открытое меню.
// Каждый вызов — независимое состояние: один экземпляр у «Реестра» (App), свой — у окна тем.
// Вся логика — чистые функции lib/docFilters.ts (под тестами), здесь только склейка с React.
import { useCallback, useMemo, useState } from 'react';
import type { DocumentView } from '../api/types';
import {
  EMPTY_FILTER_STATE,
  buildFilterModels,
  copyFilterState,
  hasActiveFilters,
  kindOf,
  makeMatcher,
  togglePick,
  withKind,
  withoutValue,
} from '../lib/docFilters';
import type {
  DocFilterState,
  DropdownKey,
  FilterKey,
  FilterModel,
  KindMode,
} from '../lib/docFilters';
import { useDismissOnOutside } from './useClickOutside';

export interface DocFiltersOptions {
  /** Стартовое состояние (копия фильтров реестра для окна тем). Читается только при монтировании. */
  initial?: DocFilterState;
  /** Закрывать открытое меню прокруткой колесом вне меню (окно тем, QA-3 п.5). */
  closeOnWheel?: boolean;
}

export interface DocFilters {
  /** Снимок для копии (иммутабельный объект; меняется только при правке фильтров). */
  state: DocFilterState;
  query: string;
  setQuery: (value: string) => void;
  kind: KindMode;
  setKind: (mode: KindMode) => void;
  /** Выпадающие Статус / Тема / Подписант / Адресат. */
  models: FilterModel[];
  openMenu: DropdownKey | null;
  toggleMenu: (key: DropdownKey) => void;
  closeMenu: () => void;
  pick: (key: DropdownKey, value: string) => void;
  /** Снять значение с ключа, если отмечено (удалённая тема, QA-3 п.9). */
  dropValue: (key: FilterKey, value: string) => void;
  anyFilter: boolean;
  /** Сброс всех фильтров и поиска; вид → «Все». */
  reset: () => void;
  matches: (doc: DocumentView) => boolean;
}

// Меню фильтра — порталом в body (QA-3 п.10), в DOM вне .filter: учитываем и его.
const DISMISS_SELECTOR = '.filter, .filter__menu';

export function useDocFilters(docs: DocumentView[], options: DocFiltersOptions = {}): DocFilters {
  const { initial, closeOnWheel = false } = options;
  // initial — только при монтировании: окно тем монтируется заново при каждом открытии.
  const [state, setState] = useState<DocFilterState>(() =>
    initial ? copyFilterState(initial) : EMPTY_FILTER_STATE,
  );
  // openMenu — отдельно от state: открытие меню не должно менять matches/видимый список.
  const [openMenu, setOpenMenu] = useState<DropdownKey | null>(null);

  const setQuery = useCallback((value: string) => {
    setState((s) => ({ ...s, query: value }));
  }, []);
  const setKind = useCallback((mode: KindMode) => {
    // Уже активное положение — прежнее состояние (без нового matches и подрезки выбора).
    setState((s) => (kindOf(s.filters) === mode ? s : { ...s, filters: withKind(s.filters, mode) }));
  }, []);
  const pick = useCallback((key: DropdownKey, value: string) => {
    setState((s) => ({ ...s, filters: togglePick(s.filters, key, value) }));
  }, []);
  const dropValue = useCallback((key: FilterKey, value: string) => {
    setState((s) => {
      const filters = withoutValue(s.filters, key, value);
      return filters === s.filters ? s : { ...s, filters };
    });
  }, []);
  const toggleMenu = useCallback((key: DropdownKey) => {
    setOpenMenu((cur) => (cur === key ? null : key));
  }, []);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const reset = useCallback(() => {
    setState(EMPTY_FILTER_STATE);
    setOpenMenu(null);
  }, []);

  useDismissOnOutside(
    openMenu !== null,
    DISMISS_SELECTOR,
    closeMenu,
    closeOnWheel ? '.filter__menu' : null,
  );

  const matches = useMemo(() => makeMatcher(state), [state]);
  const models = useMemo(() => buildFilterModels(docs, state.filters), [docs, state.filters]);

  return {
    state,
    query: state.query,
    setQuery,
    kind: kindOf(state.filters),
    setKind,
    models,
    openMenu,
    toggleMenu,
    closeMenu,
    pick,
    dropValue,
    anyFilter: hasActiveFilters(state.filters),
    reset,
    matches,
  };
}

export default useDocFilters;
