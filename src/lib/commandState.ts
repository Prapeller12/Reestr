// Переходы состояния загрузки useCommand — чистые функции (QA-3, F3, фикс QA (л)).
// Канон stale-while-revalidate: повторная загрузка того же запроса (reload) НЕ выбрасывает уже
// загруженные данные. Иначе reload после действия (назначение темы и т.п.) переводил экран в
// 'loading', App рендерил LoadingState и размонтировал открытые окна: окно тем теряло свои фильтры
// и заново отмечало стартовый предвыбор, drawer — несохранённые правки.
// Смена запроса (deps) — другое дело: данные прежнего запроса за актуальные не выдаём → 'loading'.
import type { DependencyList } from 'react';
import type { ApiError } from '../api/errors';

export type CommandState<T> =
  | { status: 'loading' }
  /** refreshing — идёт повторный запрос; refreshError — он упал, показаны прежние данные. */
  | { status: 'ok'; data: T; refreshing: boolean; refreshError: ApiError | null }
  | { status: 'error'; error: ApiError };

/**
 * Запуск запроса. Тот же запрос (reload) и есть данные — они остаются с флагом refreshing
 * (прежняя refreshError сохраняется до успеха). Данных нет или сменились deps — 'loading'.
 */
export function commandStart<T>(prev: CommandState<T>, sameQuery: boolean): CommandState<T> {
  if (sameQuery && prev.status === 'ok') return { ...prev, refreshing: true };
  return { status: 'loading' };
}

export function commandSuccess<T>(data: T): CommandState<T> {
  return { status: 'ok', data, refreshing: false, refreshError: null };
}

/** Ошибка: при первой загрузке — 'error' (экран ошибки); при повторной — данные остаются. */
export function commandFailure<T>(prev: CommandState<T>, error: ApiError): CommandState<T> {
  if (prev.status === 'ok') return { ...prev, refreshing: false, refreshError: error };
  return { status: 'error', error };
}

/** Те же ли deps (поэлементно, Object.is — как сравнивает React). null — первого запуска не было. */
export function sameDeps(prev: DependencyList | null, next: DependencyList): boolean {
  if (prev === null || prev.length !== next.length) return false;
  return prev.every((d, i) => Object.is(d, next[i]));
}
