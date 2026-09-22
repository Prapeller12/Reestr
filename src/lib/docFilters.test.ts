import { describe, expect, it } from 'vitest';
import type { DocumentView } from '../api/types';
import {
  EMPTY_FILTER_STATE,
  NO_THEME,
  buildFilterModels,
  copyFilterState,
  fieldOf,
  hasActiveFilters,
  kindOf,
  makeMatcher,
  pruneSelection,
  themesStartFor,
  toggleAllVisible,
  togglePick,
  withKind,
  withoutValue,
} from './docFilters';
import type { DocFilterState, Filters } from './docFilters';

function doc(p: Partial<DocumentView> & Pick<DocumentView, 'regNumber'>): DocumentView {
  return {
    kind: 'outgoing',
    regDate: '2026-01-10',
    counterparty: '',
    topic: '',
    signer: '',
    addressees: '',
    signerEdited: false,
    addresseesEdited: false,
    ref: '',
    deadlineSrc: '',
    status: null,
    statusLabel: null,
    dueDate: null,
    daysRemaining: null,
    alertLevel: null,
    remainingText: null,
    theme: null,
    links: [],
    chain: { predecessors: [], successors: [] },
    ...p,
  };
}

function state(filters: Partial<Filters> = {}, query = ''): DocFilterState {
  return { query, filters: { ...EMPTY_FILTER_STATE.filters, ...filters } };
}

function deepFreeze(s: DocFilterState): DocFilterState {
  Object.values(s.filters).forEach((arr) => Object.freeze(arr));
  Object.freeze(s.filters);
  return Object.freeze(s);
}

const out1 = doc({
  regNumber: '100/1',
  topic: 'Поставка труб',
  signer: 'Иванов',
  addressees: 'Петров',
  statusLabel: 'В работе',
  status: 'inWork',
  theme: 'Трубы',
});
const out2 = doc({
  regNumber: '100/2',
  topic: 'Ремонт котельной',
  signer: 'Сидоров',
  addressees: 'Петров',
  statusLabel: 'Выполнено',
  status: 'done',
  theme: 'Трубы',
});
const out3 = doc({
  regNumber: '100/3',
  topic: 'Аренда',
  signer: 'Иванов',
  statusLabel: 'В работе',
  status: 'inWork',
});
const inc1 = doc({ regNumber: '100/1', kind: 'incoming', topic: 'Ответ по трубам' });
const inc2 = doc({ regNumber: '7', kind: 'incoming', topic: 'Письмо', theme: 'Трубы' });
const ALL = [out1, out2, out3, inc1, inc2];

const key = (d: DocumentView): string => `${d.kind}:${d.regNumber}`;

describe('fieldOf', () => {
  it('берёт значения по ключам с учётом входящих', () => {
    expect(fieldOf(out1, 'type')).toBe('Исходящие');
    expect(fieldOf(inc1, 'type')).toBe('Входящие');
    expect(fieldOf(out1, 'status')).toBe('В работе');
    expect(fieldOf(inc1, 'status')).toBe('');
    expect(fieldOf(out1, 'theme')).toBe('Трубы');
    expect(fieldOf(out3, 'theme')).toBe(NO_THEME);
    expect(fieldOf(out1, 'signer')).toBe('Иванов');
    expect(fieldOf(out1, 'addressee')).toBe('Петров');
  });
});

describe('makeMatcher', () => {
  it('пустое состояние пропускает всё', () => {
    expect(ALL.filter(makeMatcher(EMPTY_FILTER_STATE))).toHaveLength(ALL.length);
  });

  it('поиск без учёта регистра по заголовку и рег.номеру, с trim', () => {
    expect(ALL.filter(makeMatcher(state({}, '  ТРУБ '))).map(key)).toEqual([
      'outgoing:100/1',
      'incoming:100/1',
    ]);
    expect(ALL.filter(makeMatcher(state({}, '100/3'))).map(key)).toEqual(['outgoing:100/3']);
  });

  it('внутри ключа ИЛИ, между ключами И', () => {
    const m = makeMatcher(state({ signer: ['Иванов', 'Сидоров'], theme: ['Трубы'] }));
    expect(ALL.filter(m).map(key)).toEqual(['outgoing:100/1', 'outgoing:100/2']);
  });

  it('фильтр вида', () => {
    expect(ALL.filter(makeMatcher(state({ type: ['Входящие'] }))).map(key)).toEqual([
      'incoming:100/1',
      'incoming:7',
    ]);
    expect(ALL.filter(makeMatcher(state({ type: ['Исходящие'] })))).toHaveLength(3);
  });
});

describe('buildFilterModels', () => {
  it('4 модели без вида, в порядке Статус/Тема/Подписант/Адресаты', () => {
    const models = buildFilterModels(ALL, EMPTY_FILTER_STATE.filters);
    expect(models.map((m) => m.key)).toEqual(['status', 'theme', 'signer', 'addressee']);
    expect(models.map((m) => m.label)).toEqual(['Статус:', 'Тема:', 'Подписант:', 'Адресаты:']);
  });

  it('«Все» первым, счётчики, порядок первого появления, пустые значения пропущены', () => {
    const [status, theme, signer] = buildFilterModels(ALL, EMPTY_FILTER_STATE.filters);
    expect(status!.options).toEqual([
      { label: 'Все', value: '', count: 5, on: true },
      { label: 'В работе', value: 'В работе', count: 2, on: false },
      { label: 'Выполнено', value: 'Выполнено', count: 1, on: false },
    ]);
    expect(theme!.options.map((o) => [o.value, o.count])).toEqual([
      ['', 5],
      ['Трубы', 3],
      [NO_THEME, 2],
    ]);
    expect(signer!.options.map((o) => o.value)).toEqual(['', 'Иванов', 'Сидоров']);
  });

  it('valueLabel, active, on', () => {
    const none = buildFilterModels(ALL, EMPTY_FILTER_STATE.filters)[2]!;
    expect([none.valueLabel, none.active]).toEqual(['Все', false]);
    const one = buildFilterModels(ALL, state({ signer: ['Иванов'] }).filters)[2]!;
    expect([one.valueLabel, one.active]).toEqual(['Иванов', true]);
    expect(one.options.find((o) => o.value === 'Иванов')!.on).toBe(true);
    expect(one.options[0]!.on).toBe(false);
    const two = buildFilterModels(ALL, state({ signer: ['Иванов', 'Сидоров'] }).filters)[2]!;
    expect(two.valueLabel).toBe('Выбрано: 2');
  });

  it('отмеченное отсутствующее значение остаётся со счётчиком 0', () => {
    const theme = buildFilterModels(ALL, state({ theme: ['Удалённая'] }).filters)[1]!;
    expect(theme.options.find((o) => o.value === 'Удалённая')).toEqual({
      label: 'Удалённая',
      value: 'Удалённая',
      count: 0,
      on: true,
    });
  });
});

describe('togglePick', () => {
  it('добавляет, снимает, «Все» сбрасывает, другие ключи не трогает', () => {
    const base = state({ theme: ['Трубы'] }).filters;
    const added = togglePick(base, 'signer', 'Иванов');
    expect(added.signer).toEqual(['Иванов']);
    expect(added.theme).toEqual(['Трубы']);
    expect(togglePick(added, 'signer', 'Иванов').signer).toEqual([]);
    expect(togglePick(state({ signer: ['A', 'B'] }).filters, 'signer', '').signer).toEqual([]);
    expect(base.signer).toEqual([]);
  });
});

describe('withoutValue', () => {
  it('снимает значение, прочие ключи целы, вход не мутирует', () => {
    const f = state({ theme: ['A', 'B'], signer: ['Иванов'] }).filters;
    const next = withoutValue(f, 'theme', 'A');
    expect(next.theme).toEqual(['B']);
    expect(next.signer).toBe(f.signer);
    expect(f.theme).toEqual(['A', 'B']);
  });

  it('отсутствующее значение — тот же объект', () => {
    const f = state({ theme: ['A'] }).filters;
    expect(withoutValue(f, 'theme', 'Z')).toBe(f);
  });
});

describe('hasActiveFilters', () => {
  it('учитывает вид, не учитывает поиск', () => {
    expect(hasActiveFilters(EMPTY_FILTER_STATE.filters)).toBe(false);
    expect(hasActiveFilters(state({ type: ['Исходящие'] }).filters)).toBe(true);
    expect(hasActiveFilters(state({}, 'труб').filters)).toBe(false);
  });
});

describe('kindOf / withKind', () => {
  it('положение переключателя по фильтру вида', () => {
    expect(kindOf(state().filters)).toBe('all');
    expect(kindOf(state({ type: ['Исходящие'] }).filters)).toBe('outgoing');
    expect(kindOf(state({ type: ['Входящие'] }).filters)).toBe('incoming');
    expect(kindOf(state({ type: ['Исходящие', 'Входящие'] }).filters)).toBe('all');
  });

  it('пишет в filters.type, остальное сохраняет', () => {
    const f = state({ signer: ['Иванов'], type: ['Входящие'] }).filters;
    expect(withKind(f, 'outgoing')).toEqual({ ...f, type: ['Исходящие'] });
    expect(withKind(f, 'all').type).toEqual([]);
    expect(f.type).toEqual(['Входящие']);
  });
});

describe('пустое начальное состояние не мутируется', () => {
  it('withKind / togglePick / copyFilterState на замороженном EMPTY', () => {
    const frozen = deepFreeze(copyFilterState(EMPTY_FILTER_STATE));
    expect(() => withKind(frozen.filters, 'incoming')).not.toThrow();
    expect(() => togglePick(frozen.filters, 'theme', 'Трубы')).not.toThrow();
    expect(withKind(frozen.filters, 'incoming')).not.toBe(frozen.filters);
    const copy = copyFilterState(frozen);
    copy.filters.theme.push('X');
    expect(frozen.filters.theme).toEqual([]);
    expect(EMPTY_FILTER_STATE).toEqual({
      query: '',
      filters: { type: [], status: [], theme: [], signer: [], addressee: [] },
    });
  });
});

describe('copyFilterState', () => {
  it('копия независима от оригинала', () => {
    const orig = state({ theme: ['Трубы'], type: ['Исходящие'] }, 'труб');
    const copy = copyFilterState(orig);
    expect(copy).toEqual(orig);
    copy.filters.theme.push('Другая');
    orig.filters.type.push('Входящие');
    expect(orig.filters.theme).toEqual(['Трубы']);
    expect(copy.filters.type).toEqual(['Исходящие']);
  });
});

describe('themesStartFor', () => {
  it('«Без темы» заменяет выбранные темы, остальное копирует, без предвыбора', () => {
    const reg = state({ theme: ['A', 'B'], type: ['Исходящие'], signer: ['Иванов'] }, 'труб');
    const start = themesStartFor(NO_THEME, reg, ALL, null);
    expect(start.initial).toEqual({
      query: 'труб',
      filters: { type: ['Исходящие'], status: [], theme: [NO_THEME], signer: ['Иванов'], addressee: [] },
    });
    expect(start.preselect).toEqual({});
    expect(reg.filters.theme).toEqual(['A', 'B']);
  });

  it('именованная тема: независимая копия, предвыбраны видимые письма темы', () => {
    const reg = state({ type: ['Исходящие'] });
    const start = themesStartFor('Трубы', reg, ALL, null);
    expect(start.initial).toEqual(reg);
    expect(start.initial.filters).not.toBe(reg.filters);
    expect(start.initial.filters.type).not.toBe(reg.filters.type);
    // inc2 в теме «Трубы», но скрыт фильтром вида.
    expect(start.preselect).toEqual({ 'outgoing:100/1': true, 'outgoing:100/2': true });
  });

  it('«Скрыть завершённые» в реестре: завершённые письма темы не предвыбраны', () => {
    const closed = (d: DocumentView): boolean => d.status === 'done';
    expect(themesStartFor('Трубы', EMPTY_FILTER_STATE, ALL, closed).preselect).toEqual({
      'outgoing:100/1': true,
      'incoming:7': true,
    });
    expect(themesStartFor('Трубы', EMPTY_FILTER_STATE, ALL, null).preselect).toEqual({
      'outgoing:100/1': true,
      'outgoing:100/2': true,
      'incoming:7': true,
    });
  });

  it('исх. и вх. с одним рег.номером различаются', () => {
    const incSame = doc({ regNumber: '100/1', kind: 'incoming', theme: 'Трубы' });
    const start = themesStartFor('Трубы', EMPTY_FILTER_STATE, [out1, incSame], null);
    expect(start.preselect).toEqual({ 'outgoing:100/1': true, 'incoming:100/1': true });
    const onlyOut = themesStartFor('Трубы', state({ type: ['Исходящие'] }), [out1, incSame], null);
    expect(onlyOut.preselect).toEqual({ 'outgoing:100/1': true });
  });
});

describe('pruneSelection', () => {
  it('снимает скрытые, оставляет видимые, отбрасывает false', () => {
    const sel = { 'outgoing:100/1': true, 'outgoing:100/2': true, 'outgoing:100/3': false };
    expect(pruneSelection(sel, [out1, out3])).toEqual({ 'outgoing:100/1': true });
  });

  it('без изменений возвращает тот же объект', () => {
    const sel = { 'outgoing:100/1': true };
    expect(pruneSelection(sel, [out1, out2])).toBe(sel);
    const empty = {};
    expect(pruneSelection(empty, ALL)).toBe(empty);
  });
});

describe('toggleAllVisible', () => {
  it('частичный выбор → все видимые; все видимые → сняты; скрытые не добавляются', () => {
    const visible = [out1, out2];
    const all = toggleAllVisible({ 'outgoing:100/1': true }, visible);
    expect(all).toEqual({ 'outgoing:100/1': true, 'outgoing:100/2': true });
    expect(toggleAllVisible(all, visible)).toEqual({});
    expect(toggleAllVisible({}, [])).toEqual({});
  });
});
