import { describe, expect, it } from 'vitest';
import type { ApiError } from '../api/errors';
import { commandFailure, commandStart, commandSuccess, sameDeps } from './commandState';
import type { CommandState } from './commandState';

const err: ApiError = { code: 'DB_ERROR', message: 'сбой' };

describe('commandState (stale-while-revalidate)', () => {
  it('первая загрузка: loading → ok', () => {
    expect(commandStart<number>({ status: 'loading' }, false)).toEqual({ status: 'loading' });
    expect(commandSuccess(5)).toEqual({ status: 'ok', data: 5, refreshing: false, refreshError: null });
  });

  it('первая загрузка с ошибкой → error (экран ошибки), «Повторить» → loading', () => {
    expect(commandFailure<number>({ status: 'loading' }, err)).toEqual({ status: 'error', error: err });
    expect(commandStart<number>({ status: 'error', error: err }, true)).toEqual({ status: 'loading' });
  });

  it('reload того же запроса держит прежние данные с флагом refreshing', () => {
    const ok: CommandState<number> = commandSuccess(1);
    expect(commandStart(ok, true)).toEqual({ status: 'ok', data: 1, refreshing: true, refreshError: null });
  });

  it('смена deps сбрасывает в loading — данные прежнего запроса не выдаются', () => {
    expect(commandStart(commandSuccess(1), false)).toEqual({ status: 'loading' });
  });

  it('ошибка повторной загрузки не уносит данные', () => {
    const refreshing = commandStart(commandSuccess(1), true);
    expect(commandFailure(refreshing, err)).toEqual({
      status: 'ok',
      data: 1,
      refreshing: false,
      refreshError: err,
    });
  });

  it('ошибка держится во время повторного reload и снимается успехом', () => {
    const failed = commandFailure(commandStart(commandSuccess(1), true), err);
    expect(commandStart(failed, true)).toEqual({ status: 'ok', data: 1, refreshing: true, refreshError: err });
    expect(commandSuccess(3)).toMatchObject({ refreshError: null });
  });
});

describe('sameDeps', () => {
  it('первый запуск — не тот же запрос', () => {
    expect(sameDeps(null, [])).toBe(false);
  });

  it('поэлементное сравнение Object.is', () => {
    const o = {};
    expect(sameDeps([], [])).toBe(true);
    expect(sameDeps([1, 'a', o], [1, 'a', o])).toBe(true);
    expect(sameDeps([1, 'a'], [1, 'b'])).toBe(false);
    expect(sameDeps([{}], [{}])).toBe(false);
    expect(sameDeps([NaN], [NaN])).toBe(true);
    expect(sameDeps([1], [1, 2])).toBe(false);
  });
});
