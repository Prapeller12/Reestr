// Фильтр писем — чистая логика без React (QA-3 пп.4, 5). Общая для раздела «Реестр» и окна тем:
// состояние (поиск + мультивыбор по ключам), предикат, модели выпадающих фильтров, вид писем
// (переключатель «Все, Исходящие, Входящие»), стартовое состояние окна тем и правила выбора
// («выбор ⊆ видимого»). Покрыто тестами (docFilters.test.ts).
import type { DocKind, DocumentView } from '../api/types';
import { docKey } from './format';

export type FilterKey = 'type' | 'status' | 'theme' | 'signer' | 'addressee';
/** Ключи выпадающих фильтров. Вид (`type`) — отдельный сегментный переключатель (п.4). */
export type DropdownKey = Exclude<FilterKey, 'type'>;
export type Filters = Record<FilterKey, string[]>;

export interface FilterOption {
  label: string;
  value: string;
  count: number;
  on: boolean;
}

export interface FilterModel {
  key: DropdownKey;
  label: string;
  valueLabel: string;
  active: boolean;
  options: FilterOption[];
}

/** Всё, что копируется из реестра в окно тем. `openMenu` и «Скрыть завершённые» сюда не входят. */
export interface DocFilterState {
  query: string;
  filters: Filters;
}

export type KindMode = 'all' | 'outgoing' | 'incoming';

export const NO_THEME = 'Без темы';

export const KIND_LABEL: Record<DocKind, string> = {
  outgoing: 'Исходящие',
  incoming: 'Входящие',
};

export const EMPTY_FILTER_STATE: DocFilterState = {
  query: '',
  filters: { type: [], status: [], theme: [], signer: [], addressee: [] },
};

const ALL_KEYS: FilterKey[] = ['type', 'status', 'theme', 'signer', 'addressee'];

const DROPDOWNS: { key: DropdownKey; label: string }[] = [
  { key: 'status', label: 'Статус:' },
  { key: 'theme', label: 'Тема:' },
  { key: 'signer', label: 'Подписант:' },
  { key: 'addressee', label: 'Адресаты:' },
];

/** Значение документа по ключу фильтра. Статус/тема — с учётом опциональности у входящих. */
export function fieldOf(doc: DocumentView, key: FilterKey): string {
  if (key === 'type') return KIND_LABEL[doc.kind];
  if (key === 'status') return doc.statusLabel ?? '';
  if (key === 'theme') return doc.theme ?? NO_THEME;
  if (key === 'signer') return doc.signer;
  return doc.addressees;
}

/** Предикат видимости: поиск по заголовку/рег.номеру; внутри ключа — ИЛИ, между ключами — И. */
export function makeMatcher(state: DocFilterState): (doc: DocumentView) => boolean {
  const q = state.query.trim().toLowerCase();
  const { filters } = state;
  return (doc) => {
    if (q && !(doc.topic.toLowerCase().includes(q) || doc.regNumber.toLowerCase().includes(q))) {
      return false;
    }
    for (const key of ALL_KEYS) {
      const picked = filters[key];
      if (picked.length && !picked.includes(fieldOf(doc, key))) return false;
    }
    return true;
  };
}

/**
 * Модели выпадающих фильтров (Статус, Тема, Подписант, Адресат — без вида, п.4).
 * Счётчики — по нефильтрованному списку, значения — в порядке первого появления.
 * Отмеченное значение, которого нет в данных, остаётся в меню со счётчиком 0 — чтобы его можно было снять.
 */
export function buildFilterModels(docs: DocumentView[], filters: Filters): FilterModel[] {
  return DROPDOWNS.map(({ key, label }) => {
    const picked = filters[key];
    const counts = new Map<string, number>();
    docs.forEach((d) => {
      const v = fieldOf(d, key);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    });
    picked.forEach((v) => {
      if (!counts.has(v)) counts.set(v, 0);
    });
    const active = picked.length > 0;
    const options: FilterOption[] = [{ label: 'Все', value: '', count: docs.length, on: !active }];
    counts.forEach((count, v) => {
      options.push({ label: v, value: v, count, on: picked.includes(v) });
    });
    return {
      key,
      label,
      valueLabel: !active ? 'Все' : picked.length === 1 ? picked[0]! : `Выбрано: ${picked.length}`,
      active,
      options,
    };
  });
}

/** Выбор пункта мультиселекта: '' («все») сбрасывает ключ, иначе значение добавляется/снимается. */
export function togglePick(filters: Filters, key: FilterKey, value: string): Filters {
  const cur = filters[key];
  const next =
    value === '' ? [] : cur.includes(value) ? cur.filter((v) => v !== value) : cur.concat([value]);
  return { ...filters, [key]: next };
}

/** Снять значение с ключа (удалённая тема, QA-3 п.9). Нет такого значения — тот же объект. */
export function withoutValue(filters: Filters, key: FilterKey, value: string): Filters {
  const cur = filters[key];
  if (!cur.includes(value)) return filters;
  return { ...filters, [key]: cur.filter((v) => v !== value) };
}

/** Есть ли активный фильтр (включая вид). Поиск не учитывается — у него своя кнопка очистки. */
export function hasActiveFilters(filters: Filters): boolean {
  return ALL_KEYS.some((key) => filters[key].length > 0);
}

/** Положение переключателя вида по состоянию фильтра `type`. Пусто или оба вида — «Все». */
export function kindOf(filters: Filters): KindMode {
  const t = filters.type;
  const out = t.includes(KIND_LABEL.outgoing);
  const inc = t.includes(KIND_LABEL.incoming);
  if (out && !inc) return 'outgoing';
  if (inc && !out) return 'incoming';
  return 'all';
}

export function withKind(filters: Filters, mode: KindMode): Filters {
  return { ...filters, type: mode === 'all' ? [] : [KIND_LABEL[mode]] };
}

/** Глубокая копия: состояния реестра и окна тем независимы. */
export function copyFilterState(s: DocFilterState): DocFilterState {
  return {
    query: s.query,
    filters: {
      type: s.filters.type.slice(),
      status: s.filters.status.slice(),
      theme: s.filters.theme.slice(),
      signer: s.filters.signer.slice(),
      addressee: s.filters.addressee.slice(),
    },
  };
}

/** Стартовое состояние окна тем: копия фильтров реестра + предвыбранные письма. */
export interface ThemesStart {
  initial: DocFilterState;
  preselect: Record<string, boolean>;
}

/**
 * Открытие окна тем с шестерёнки группы реестра (QA-3 п.5, решения пользователя).
 * «Без темы» — копия фильтров реестра с Темой = «Без темы» (заменяет выбранные темы), без предвыбора.
 * Именованная тема — точная копия; предвыбраны письма темы, видимые в группе реестра: проходят
 * фильтры и не скрыты тумблером реестра (`hiddenInRegistry` — «Скрыть завершённые», null — выключен).
 */
export function themesStartFor(
  groupName: string,
  state: DocFilterState,
  docs: DocumentView[],
  hiddenInRegistry: ((doc: DocumentView) => boolean) | null,
): ThemesStart {
  const initial = copyFilterState(state);
  if (groupName === NO_THEME) {
    initial.filters.theme = [NO_THEME];
    return { initial, preselect: {} };
  }
  const match = makeMatcher(state);
  const preselect: Record<string, boolean> = {};
  docs.forEach((d) => {
    if (d.theme !== groupName || !match(d)) return;
    if (hiddenInRegistry && hiddenInRegistry(d)) return;
    preselect[docKey(d.kind, d.regNumber)] = true;
  });
  return { initial, preselect };
}

/** Выбор ⊆ видимого: снимает отметки со скрытых. Без изменений возвращает тот же объект. */
export function pruneSelection(
  selected: Record<string, boolean>,
  visible: DocumentView[],
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  let kept = 0;
  visible.forEach((d) => {
    const key = docKey(d.kind, d.regNumber);
    if (selected[key]) {
      next[key] = true;
      kept += 1;
    }
  });
  const before = Object.keys(selected).length;
  return kept === before ? selected : next;
}

/** «Выбрать всё» по видимым: все отмечены — снять видимые, иначе отметить все видимые. */
export function toggleAllVisible(
  selected: Record<string, boolean>,
  visible: DocumentView[],
): Record<string, boolean> {
  const allOn = visible.length > 0 && visible.every((d) => selected[docKey(d.kind, d.regNumber)]);
  const next = { ...selected };
  visible.forEach((d) => {
    const key = docKey(d.kind, d.regNumber);
    if (allOn) delete next[key];
    else next[key] = true;
  });
  return next;
}
