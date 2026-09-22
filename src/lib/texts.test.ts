import { describe, expect, it } from 'vitest';
import { deleteThemeConfirm, lettersInThemeTitle, lettersLabel, themesLabel } from './texts';

describe('lettersLabel', () => {
  it('склоняет «письмо»', () => {
    const cases: [number, string][] = [
      [0, '0 писем'],
      [1, '1 письмо'],
      [2, '2 письма'],
      [4, '4 письма'],
      [5, '5 писем'],
      [11, '11 писем'],
      [12, '12 писем'],
      [14, '14 писем'],
      [21, '21 письмо'],
      [22, '22 письма'],
      [25, '25 писем'],
      [111, '111 писем'],
      [226, '226 писем'],
    ];
    cases.forEach(([n, s]) => expect(lettersLabel(n)).toBe(s));
  });
});

describe('themesLabel', () => {
  it('склоняет «тема» строго, с 11–14', () => {
    expect(themesLabel(1)).toBe('1 тема');
    expect(themesLabel(3)).toBe('3 темы');
    expect(themesLabel(5)).toBe('5 тем');
    expect(themesLabel(12)).toBe('12 тем');
    expect(themesLabel(21)).toBe('21 тема');
  });
});

describe('lettersInThemeTitle', () => {
  it('тултип числа у темы', () => {
    expect(lettersInThemeTitle(39)).toBe('39 писем в теме');
    expect(lettersInThemeTitle(1)).toBe('1 письмо в теме');
  });
});

describe('deleteThemeConfirm', () => {
  it('пустая тема', () => {
    expect(deleteThemeConfirm('Тема 2', 0)).toEqual({
      question: 'Удалить тему «Тема 2»?',
      detail: 'В теме нет писем',
    });
  });

  it('глагол согласуется с числом', () => {
    expect(deleteThemeConfirm('X', 1).detail).toBe('1 письмо перейдёт в «Без темы»');
    expect(deleteThemeConfirm('X', 21).detail).toBe('21 письмо перейдёт в «Без темы»');
    expect(deleteThemeConfirm('X', 2).detail).toBe('2 письма перейдут в «Без темы»');
    expect(deleteThemeConfirm('X', 7).detail).toBe('7 писем перейдут в «Без темы»');
    expect(deleteThemeConfirm('X', 11).detail).toBe('11 писем перейдут в «Без темы»');
  });

  it('имя дословно', () => {
    expect(deleteThemeConfirm('  Поставки  2026 ', 3).question).toBe('Удалить тему «  Поставки  2026 »?');
  });
});
