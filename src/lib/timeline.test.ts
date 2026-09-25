import { describe, expect, it } from 'vitest';
import type { DocKind, DocStatus, DocumentView } from '../api/types';
import { isoToEpochDay } from './dates';
import {
  CHIP_GAP,
  ZOOM_ORDER,
  buildTimeline,
  layoutTimelineRows,
  chipSpan,
  collectChains,
  deckPositions,
  splitZoom,
} from './timeline';
import type { TimelineChipModel, TimelineLaneInput, TimelineModel, TimelineZoom } from './timeline';

const LABELS: Record<DocStatus, string> = {
  inWork: 'В работе',
  overdue: 'Не выполнено',
  done: 'Выполнено',
  reworked: 'В доработке',
};

function E(iso: string): number {
  const day = isoToEpochDay(iso);
  if (day === null) throw new Error(`bad date ${iso}`);
  return day;
}

function base(regNumber: string, kind: DocKind, regDate: string): DocumentView {
  return {
    regNumber,
    kind,
    regDate,
    counterparty: '',
    topic: `тема ${regNumber}`,
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
  };
}

/** Исходящее; links — [вид, рег.номер] привязанных писем. */
function out(
  reg: string,
  iso: string,
  links: [DocKind, string][] = [],
  status: DocStatus = 'inWork',
): DocumentView {
  return {
    ...base(reg, 'outgoing', iso),
    status,
    statusLabel: LABELS[status],
    links: links.map(([letterKind, letterReg], i) => ({
      id: i + 1,
      letterReg,
      letterKind,
      letterTopic: '',
      letterRef: '',
      letterStatus: null,
      createdAt: '',
    })),
  };
}

function inc(reg: string, iso: string): DocumentView {
  return base(reg, 'incoming', iso);
}

const TODAY = E('2026-09-19');
const lane = (name: string, docs: DocumentView[]): TimelineLaneInput => ({ name, docs });
const build = (groups: TimelineLaneInput[], zoom: TimelineZoom, hideClosed = false): TimelineModel =>
  buildTimeline(groups, TODAY, zoom, hideClosed);
const chipsOf = (m: TimelineModel): TimelineChipModel[] =>
  m.lanes.reduce<TimelineChipModel[]>((acc, l) => acc.concat(l.chips), []);
const pxOf = (m: TimelineModel, iso: string): number => Math.round((E(iso) - m.lo) * m.ppd);
const posOf = (m: TimelineModel, key: string): TimelineChipModel | undefined =>
  chipsOf(m).find((c) => c.memberIds.includes(key));
const rowsOf = (m: TimelineModel): number => new Set(chipsOf(m).map((c) => c.top)).size;
const countSum = (m: TimelineModel): number => chipsOf(m).reduce((n, c) => n + c.count, 0);

// Пример QA-3 п.8: 100/48 (12.01) → 100/93 (12.01) → 100/931 (19.01).
const EXAMPLE = [
  lane('Тема', [
    out('100/48', '2026-01-12', [['outgoing', '100/93']], 'reworked'),
    out('100/93', '2026-01-12', [['outgoing', '100/931']], 'reworked'),
    out('100/931', '2026-01-19'),
  ]),
];

// Еженедельные входящие к одной задаче (05.01 + 10 понедельников).
function weeklyDocs(): DocumentView[] {
  const dates = [
    '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09',
    '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16',
  ];
  const ins = dates.map((d, i) => inc(`ВХ${i + 1}`, d));
  const task = out('100/1', '2026-01-05', ins.map((d): [DocKind, string] => ['incoming', d.regNumber]), 'done');
  return [task, ...ins];
}
const WEEKLY = [lane('Еженедельно', weeklyDocs())];

// Письма у правого края трека (разворот плашки влево): B — одиночная, C+B — колода.
const FLIP = [
  lane('Край', [
    out('A', '2026-01-01', [['outgoing', 'P']]),
    out('P', '2026-06-01', [['outgoing', 'B']]),
    out('B', '2026-12-29'),
  ]),
];
const FLIP_DECK = [
  lane('Край', [
    out('A', '2026-01-01', [['outgoing', 'C']]),
    out('C', '2026-12-09', [['outgoing', 'B']]),
    out('B', '2026-12-29'),
  ]),
];

function checkInvariant(m: TimelineModel): void {
  const byRow = new Map<string, TimelineChipModel[]>();
  for (const l of m.lanes) {
    for (const c of l.chips) {
      // Позиция стоит ровно на дате первого письма.
      expect(c.left).toBe(Math.round((c.firstEpoch - m.lo) * m.ppd));
      const key = `${l.name}|${c.top}`;
      byRow.set(key, (byRow.get(key) ?? []).concat(c));
    }
  }
  for (const row of byRow.values()) {
    const spans = row.map(chipSpan).sort((a, b) => a.left - b.left);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1];
      const next = spans[i];
      if (prev && next) expect(next.left).toBeGreaterThanOrEqual(prev.right + CHIP_GAP);
    }
  }
}

describe('колода: пример 100/48 → 100/93 → 100/931', () => {
  it.each<TimelineZoom>(['year', 'quarter', 'month'])('%s — одна колода ×3 на 12.01', (zoom) => {
    const m = build(EXAMPLE, zoom);
    const chips = chipsOf(m);
    expect(chips).toHaveLength(1);
    const deck = chips[0];
    expect(deck?.count).toBe(3);
    expect(deck?.sheets).toBe(2);
    expect(deck?.left).toBe(pxOf(m, '2026-01-12'));
    expect(deck?.regNumber).toBe('100/931');
    expect(deck?.rangeLabel).toBe('12.01 — 19.01');
    expect(deck?.memberIds).toEqual(['outgoing:100/48', 'outgoing:100/93', 'outgoing:100/931']);
  });

  it('week — 48+93 колодой ×2 на 12.01, 931 отдельно на 19.01', () => {
    const m = build(EXAMPLE, 'week');
    const chips = chipsOf(m).sort((a, b) => a.left - b.left);
    expect(chips).toHaveLength(2);
    expect(chips[0]?.count).toBe(2);
    expect(chips[0]?.sheets).toBe(1);
    expect(chips[0]?.regNumber).toBe('100/93');
    expect(chips[0]?.left).toBe(pxOf(m, '2026-01-12'));
    expect(chips[1]?.count).toBe(1);
    expect(chips[1]?.left).toBe(pxOf(m, '2026-01-19'));
    expect((chips[1]?.left ?? 0) - (chips[0]?.left ?? 0)).toBe(196);
    expect(m.lanes[0]?.links).toHaveLength(1);
  });

  it('тултип группы — письма по датам: номер · тип · дата · статус', () => {
    const deck = chipsOf(build(EXAMPLE, 'quarter'))[0];
    const lines = (deck?.title ?? '').split('\n');
    expect(lines[0]).toBe('3 письма · 12.01.2026 — 19.01.2026');
    expect(lines[1]).toBe('№ 100/48 · ИСХ · 12.01.2026 · В доработке');
    expect(lines[3]).toBe('№ 100/931 · ИСХ · 19.01.2026 · В работе');
    const withIn = chipsOf(
      build([lane('Т', [out('7', '2026-01-12', [['incoming', '555']], 'done'), inc('555', '2026-01-13')])], 'quarter'),
    )[0];
    expect(withIn?.title.split('\n')).toContain('№ 555 · ВХ · 13.01.2026');
    expect(withIn?.title.split('\n')).toContain('№ 7 · ИСХ · 12.01.2026 · Выполнено');
  });
});

describe('инвариант «позиция на дате первого письма», позиции ряда не пересекаются', () => {
  const fixtures = { EXAMPLE, WEEKLY, FLIP, FLIP_DECK };
  for (const [name, groups] of Object.entries(fixtures)) {
    it.each<TimelineZoom>([...ZOOM_ORDER])(`${name} — %s`, (zoom) => {
      checkInvariant(build(groups, zoom));
    });
  }

  it('письмо у правого края разворачивается, но стоит на своей дате', () => {
    const m = build(FLIP, 'quarter');
    const b = posOf(m, 'outgoing:B');
    expect(b?.flip).toBe(true);
    expect(b?.left).toBe(pxOf(m, '2026-12-29'));
    expect(b?.count).toBe(1);
  });

  it('у правого края близкие письма — колода на дате первого письма', () => {
    const m = build(FLIP_DECK, 'quarter');
    const deck = posOf(m, 'outgoing:B');
    expect(deck?.memberIds).toEqual(['outgoing:C', 'outgoing:B']);
    expect(deck?.flip).toBe(true);
    expect(deck?.left).toBe(pxOf(m, '2026-12-09'));
  });
});

describe('цепочка целиком', () => {
  it('еженедельные входящие — один ряд, без сирот, колоды по масштабу', () => {
    for (const zoom of ZOOM_ORDER) {
      const m = build(WEEKLY, zoom);
      expect(rowsOf(m)).toBe(1);
      expect(countSum(m)).toBe(11);
      expect(m.lanes[0]?.links).toHaveLength(chipsOf(m).length - 1);
    }
    expect(chipsOf(build(WEEKLY, 'quarter')).map((c) => c.count)).toEqual([9, 2]);
    expect(chipsOf(build(WEEKLY, 'week')).every((c) => c.count === 1)).toBe(true);
  });

  it('без лимита длины: 12 повторных исходящих — в одном ряду', () => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const docs = months.map((mm, i) =>
      out(`A${i + 1}`, `2025-${mm}-10`, i < 11 ? [['outgoing', `A${i + 2}`]] : []),
    );
    const m = build([lane('Длинная', docs)], 'week');
    expect(rowsOf(m)).toBe(1);
    expect(chipsOf(m)).toHaveLength(12);
  });

  it('цикл A↔B и самоссылка — каждое письмо ровно один раз', () => {
    const docs = [
      out('A', '2026-03-01', [['outgoing', 'B']]),
      out('B', '2026-03-10', [['outgoing', 'A']]),
      out('C', '2026-03-20', [['outgoing', 'C']]),
    ];
    const m = build([lane('Цикл', docs)], 'week');
    const ids = chipsOf(m).reduce<string[]>((acc, c) => acc.concat(c.memberIds), []);
    expect(ids.sort()).toEqual(['outgoing:A', 'outgoing:B', 'outgoing:C']);
    expect(posOf(m, 'outgoing:A')?.top).toBe(posOf(m, 'outgoing:B')?.top);
    expect(posOf(m, 'outgoing:C')?.top).not.toBe(posOf(m, 'outgoing:A')?.top);
  });

  it('взаимные привязки A1↔A2↔A3 — один ряд в порядке дат', () => {
    const docs = [
      out('A1', '2026-02-01', [['outgoing', 'A2']]),
      out('A2', '2026-03-01', [['outgoing', 'A1'], ['outgoing', 'A3']]),
      out('A3', '2026-04-01', [['outgoing', 'A2']]),
    ];
    const m = build([lane('Взаимные', docs)], 'week');
    expect(rowsOf(m)).toBe(1);
    const order = chipsOf(m)
      .sort((a, b) => a.left - b.left)
      .map((c) => c.regNumber);
    expect(order).toEqual(['A1', 'A2', 'A3']);
  });

  it('входящее у двух задач темы — один раз, в цепочке первой по дате задачи', () => {
    const docs = [
      out('T1', '2026-02-01', [['incoming', 'X']], 'done'),
      out('T2', '2026-01-10', [['incoming', 'X']], 'done'),
      inc('X', '2026-02-20'),
    ];
    const m = build([lane('Две', docs)], 'week');
    expect(chipsOf(m).filter((c) => c.memberIds.includes('incoming:X'))).toHaveLength(1);
    expect(posOf(m, 'incoming:X')?.top).toBe(posOf(m, 'outgoing:T2')?.top);
    expect(posOf(m, 'outgoing:T1')?.top).not.toBe(posOf(m, 'outgoing:T2')?.top);

    const same = [
      out('T2', '2026-01-10', [['outgoing', 'T1'], ['incoming', 'X']], 'reworked'),
      out('T1', '2026-02-01', [['incoming', 'X']], 'done'),
      inc('X', '2026-02-20'),
    ];
    const m2 = build([lane('Одна', same)], 'week');
    expect(rowsOf(m2)).toBe(1);
    expect(countSum(m2)).toBe(3);
  });
});

describe('закрытость цепочки (решение (А): есть входящее И все исходящие выполнены)', () => {
  const groups = [
    lane('Смешанная', [
      out('Открытая', '2026-03-01'),
      out('Закрытая', '2026-02-01', [['incoming', 'Ответ']], 'done'),
      inc('Ответ', '2026-02-05'),
    ]),
  ];

  it('закрытые — ниже открытых, hideClosed скрывает их', () => {
    const m = build(groups, 'week');
    const open = posOf(m, 'outgoing:Открытая');
    const closed = posOf(m, 'outgoing:Закрытая');
    expect((open?.top ?? 0) < (closed?.top ?? 0)).toBe(true);
    const hidden = build(groups, 'week', true);
    expect(posOf(hidden, 'outgoing:Закрытая')).toBeUndefined();
    expect(posOf(hidden, 'incoming:Ответ')).toBeUndefined();
    expect(posOf(hidden, 'outgoing:Открытая')).toBeDefined();
  });

  it('дорожка только из закрытых при hideClosed исчезает', () => {
    const only = [lane('Всё закрыто', [out('T', '2026-02-01', [['incoming', 'X']], 'done'), inc('X', '2026-02-05')])];
    expect(build(only, 'quarter', true).lanes).toHaveLength(0);
    expect(build(only, 'quarter', false).lanes).toHaveLength(1);
  });

  it('T1 + ответ X + повтор T2 без ответа — цепочка открыта', () => {
    const g = [
      lane('Повтор', [
        out('T1', '2026-01-10', [['incoming', 'X'], ['outgoing', 'T2']], 'done'),
        inc('X', '2026-01-20'),
        out('T2', '2026-02-10', [], 'inWork'),
      ]),
    ];
    const m = build(g, 'week', true);
    expect(countSum(m)).toBe(3);
    expect(rowsOf(m)).toBe(1);
  });

  it('hideClosed не меняет шкалу и ось', () => {
    const a = build(groups, 'month', false);
    const b = build(groups, 'month', true);
    expect(b.lo).toBe(a.lo);
    expect(b.ppd).toBe(a.ppd);
    expect(b.trackWidth).toBe(a.trackWidth);
    expect(b.ticks).toEqual(a.ticks);
  });
});

describe('подписи оси', () => {
  const JAN = [lane('Январь', [out('1', '2026-01-12')])];

  it('кварталы — «I кв. 2026» римскими, ведущая подпись на left 0', () => {
    const m = build(JAN, 'quarter');
    expect(m.ticks[0]).toEqual({ label: 'I кв. 2026', left: 0, lead: true });
    expect(m.ticks.map((t) => t.label)).toContain('II кв. 2026');
    expect(m.ticks.some((t) => /^Q/.test(t.label))).toBe(false);
  });

  it('месяцы — год у первой подписи и у января', () => {
    const m = build(JAN, 'month');
    expect(m.ticks[0]).toEqual({ label: 'янв 2026', left: 0, lead: true });
    expect(m.ticks[1]?.label).toBe('фев');
    const cross = build([lane('Стык', [out('1', '2026-11-10'), out('2', '2027-02-10')])], 'month');
    const labels = cross.ticks.map((t) => t.label);
    const dec = labels.indexOf('дек');
    expect(dec).toBeGreaterThan(-1);
    expect(labels[dec + 1]).toBe('янв 2027');
  });

  it('годы — «2026» ведущей подписью', () => {
    const m = build(JAN, 'year');
    expect(m.ticks[0]).toEqual({ label: '2026', left: 0, lead: true });
  });

  it('недели — понедельники, шаг 196px, «5 янв 2026», «12 янв»', () => {
    const m = build(JAN, 'week');
    // lo = 04.01 (вс): до понедельника 05.01 всего 28px < 96 — ведущей нет.
    expect(m.ticks[0]).toEqual({ label: '5 янв 2026', left: 28, lead: false });
    expect(m.ticks[1]?.label).toBe('12 янв');
    for (let i = 0; i < m.ticks.length; i++) {
      const t = m.ticks[i];
      if (!t) continue;
      const day = m.lo + t.left / m.ppd;
      expect((((day + 3) % 7) + 7) % 7).toBe(0);
      const prev = m.ticks[i - 1];
      if (prev) expect(t.left - prev.left).toBe(196);
    }
    const cross = build([lane('Стык', [out('1', '2026-12-10'), out('2', '2027-01-20')])], 'week');
    expect(cross.ticks.map((t) => t.label)).toContain('4 янв 2027');
  });

  it('ведущей подписи нет, если первая засечка ближе 96px', () => {
    const m = build([lane('Апрель', [out('1', '2026-04-05')])], 'quarter');
    expect(m.ticks[0]?.lead).toBe(false);
    expect(m.ticks[0]?.label).toBe('II кв. 2026');
  });

  it('масштаб «неделя» — 28 px/день', () => {
    const m = build(JAN, 'week');
    expect(m.trackWidth).toBe(Math.round((E('2026-09-27') - E('2026-01-04')) * 28));
  });
});

describe('splitZoom — ближайший масштаб, на котором колода раскладывается', () => {
  const targetOf = (m: TimelineModel, laneName: string, key: string) => {
    const pos = posOf(m, key);
    return { lane: laneName, memberIds: pos?.memberIds ?? [] };
  };

  it('пример п.8: с «кварталов» и с «годов» — сразу «неделя»', () => {
    const chains = collectChains(EXAMPLE);
    const froms: TimelineZoom[] = ['quarter', 'year'];
    for (const from of froms) {
      const target = targetOf(build(EXAMPLE, from), 'Тема', 'outgoing:100/48');
      expect(splitZoom(chains, TODAY, false, from, target)).toBe('week');
    }
  });

  it('письма через 30 дней: с «годов» — «месяцы»', () => {
    const g = [lane('30', [out('T', '2026-01-01', [['incoming', 'X']], 'done'), inc('X', '2026-01-31')])];
    const target = targetOf(build(g, 'year'), '30', 'outgoing:T');
    expect(target.memberIds).toHaveLength(2);
    expect(splitZoom(collectChains(g), TODAY, false, 'year', target)).toBe('month');
  });

  it('письма одной даты не раскладываются нигде — null', () => {
    const chains = collectChains(EXAMPLE);
    const week = targetOf(build(EXAMPLE, 'week'), 'Тема', 'outgoing:100/48');
    expect(week.memberIds).toEqual(['outgoing:100/48', 'outgoing:100/93']);
    expect(splitZoom(chains, TODAY, false, 'week', week)).toBeNull();
    expect(splitZoom(chains, TODAY, false, 'month', week)).toBeNull();
  });

  it('дорожки не смешиваются: входящее X в двух темах', () => {
    const g = [
      // В «А» X склеено с задачей навсегда (2 дня).
      lane('А', [out('TA', '2026-02-27', [['incoming', 'X']], 'done'), inc('X', '2026-03-01')]),
      // В «Б» колода [X, TB1] раскладывается только на «неделе» (8 дней).
      lane('Б', [
        out('TB0', '2025-12-01', [['incoming', 'X'], ['outgoing', 'TB1']], 'done'),
        inc('X', '2026-03-01'),
        out('TB1', '2026-03-09', [], 'done'),
      ]),
    ];
    const q = build(g, 'quarter');
    const deckB = q.lanes.find((l) => l.name === 'Б')?.chips.find((c) => c.memberIds.includes('incoming:X'));
    expect(deckB?.memberIds).toEqual(['incoming:X', 'outgoing:TB1']);
    const target = { lane: 'Б', memberIds: deckB?.memberIds ?? [] };
    expect(splitZoom(collectChains(g), TODAY, false, 'quarter', target)).toBe('week');
    // Поиск позиций — только в своей дорожке.
    expect(deckPositions(q, target).every((c) => q.lanes.find((l) => l.name === 'Б')?.chips.includes(c))).toBe(true);
  });
});

// Подписи дорожки — решения пользователя 2026-09-20 (пп.2, 3): без «ждём» и «тишины».
describe('meta дорожки', () => {
  const overdueOut = (reg: string, iso: string, days: number): DocumentView => ({
    ...out(reg, iso, [], 'overdue'),
    daysRemaining: -days,
    alertLevel: 'red',
  });

  it('есть просроченные — «макс. просрочка N дн.»', () => {
    const m = build([lane('Т', [overdueOut('A', '2026-01-10', 214), overdueOut('B', '2026-02-10', 30)])], 'quarter');
    expect(m.lanes[0]?.meta).toBe('2 письма · макс. просрочка 214 дн.');
    expect(m.lanes[0]?.alert).toBe(true);
  });

  it('все исходящие выполнены — «все выполнены»', () => {
    const g = [lane('Т', [out('T', '2026-02-01', [['incoming', 'X']], 'done'), inc('X', '2026-02-05')])];
    expect(build(g, 'quarter').lanes[0]?.meta).toBe('2 письма · все выполнены');
  });

  it('давно нет писем — «последнее письмо N дн. назад»', () => {
    const m = build([lane('Т', [out('T', '2026-01-10', [], 'inWork')])], 'quarter');
    expect(m.lanes[0]?.meta).toBe(`1 письмо · последнее письмо ${TODAY - E('2026-01-10')} дн. назад`);
    expect(m.lanes[0]?.alert).toBe(true);
  });

  it('свежая переписка в работе — «в работе»', () => {
    const m = build([lane('Т', [out('T', '2026-09-10', [], 'inWork')])], 'quarter');
    expect(m.lanes[0]?.meta).toBe('1 письмо · в работе');
    expect(m.lanes[0]?.alert).toBe(false);
  });
});


describe('экранная горизонтальная строка темы', () => {
  const rowModel = (groups: TimelineLaneInput[], zoom: TimelineZoom = 'week', hide = false) => {
    const original = build(groups, zoom, hide);
    return { original, rows: layoutTimelineRows(original, collectChains(groups)) };
  };

  it('независимые письма на одной дате раскрываются отдельно и не получают ложных связей', () => {
    const { rows } = rowModel([lane('Тема', [out('1', '2026-09-01'), out('2', '2026-09-01'), inc('2', '2026-09-01')])]);
    expect(rows[0]!.groups).toHaveLength(1);
    expect(rows[0]!.groups[0]!.members.map((m) => m.id)).toEqual(['outgoing:1', 'outgoing:2', 'incoming:2']);
    expect(rows[0]!.chips[0]!.count).toBe(3);
    expect(rows[0]!.links).toEqual([]);
  });

  it('разнесённые письма стоят в одном ряду точно на своих датах; печать не меняется', () => {
    const groups = [lane('Тема', [out('1', '2026-01-01'), out('2', '2026-05-01'), out('3', '2026-09-01')])];
    const { original, rows } = rowModel(groups);
    const before = JSON.stringify(original);
    layoutTimelineRows(original, collectChains(groups));
    expect(JSON.stringify(original)).toBe(before);
    expect(new Set(rows[0]!.chips.map((c) => c.top)).size).toBe(1);
    expect(new Set(original.lanes[0]!.chips.map((c) => c.top)).size).toBe(3);
    for (const c of rows[0]!.chips) expect(c.left).toBe(Math.round((c.firstEpoch - original.lo) * original.ppd));
  });

  it('собирает транзитивные пересечения и сохраняет даты и статусы каждого письма', () => {
    const { rows } = rowModel([lane('Тема', [out('1', '2026-09-01'), out('2', '2026-09-06', [], 'overdue'), out('3', '2026-09-11')])]);
    expect(rows[0]!.groups).toHaveLength(1);
    expect(rows[0]!.groups[0]!.members.map((c) => [c.regNumber, c.firstEpoch, c.status])).toEqual([
      ['1', E('2026-09-01'), 'inWork'], ['2', E('2026-09-06'), 'overdue'], ['3', E('2026-09-11'), 'inWork'],
    ]);
  });

  it('учитывает фильтр завершённых цепочек и не объединяет разные темы', () => {
    const groups = [lane('A', [out('1', '2026-09-01', [['incoming', '2']], 'done'), inc('2', '2026-09-02'), out('3', '2026-09-02')]), lane('B', [out('4', '2026-09-02')])];
    const { rows } = rowModel(groups, 'month', true);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.groups.flatMap((g) => g.chip.memberIds)).toEqual(['outgoing:3']);
    expect(rows[1]!.groups.flatMap((g) => g.chip.memberIds)).toEqual(['outgoing:4']);
  });

  it('сохраняет все письма и не оставляет пересечений колод на всех масштабах', () => {
    const docs = Array.from({ length: 100 }, (_, i) => out(String(i), `2026-09-${String(1 + i % 28).padStart(2, '0')}`));
    for (const zoom of ZOOM_ORDER) {
      const { rows, original } = rowModel([lane('Тема', docs)], zoom);
      const row = rows[0]!;
      expect(new Set(row.groups.flatMap((g) => g.chip.memberIds)).size).toBe(100);
      const spans = row.chips.map(chipSpan).sort((a, b) => a.left - b.left);
      spans.forEach((span, i) => {
        expect(span.left).toBeGreaterThanOrEqual(0);
        expect(span.right).toBeLessThanOrEqual(original.trackWidth);
        if (i) expect(span.left).toBeGreaterThanOrEqual(spans[i - 1]!.right + CHIP_GAP);
      });
    }
  });
});
