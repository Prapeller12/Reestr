// Геометрия таймлайна «Связи писем» на факты backend (DocumentView) и целочисленные эпоха-дни.
// Чистые функции без Date. Единственное место, чьи координаты рендерятся через inline style.
//
// Две ступени (QA-3 F5):
//  1) collectChains — цепочки писем по привязкам (LINK), от масштаба не зависит;
//  2) layoutTimeline — ось, ряды и «колоды» на конкретном масштабе.
// Инвариант раскладки: позиция (плашка или колода) стоит ровно на дате своего первого письма —
// левым краем, у правого края трека (flip) — правым. Сдвигать плашку вправо запрещено: письма,
// которые наложились бы друг на друга, примагничиваются в колоду.
import type { DocKind, DocStatus, DocumentView } from '../api/types';
import {
  epochDayToYmd,
  formatEpochDay,
  formatIsoDate,
  isoToEpochDay,
  ymdToEpochDay,
} from './dates';
import { docKey, remainingFor, statusLabelOf } from './format';
import { lettersLabel } from './texts';

export type TimelineZoom = 'week' | 'month' | 'quarter' | 'year';

/** Масштабы от мелкого к крупному — порядок поиска уровня, на котором колода раскладывается. */
export const ZOOM_ORDER: readonly TimelineZoom[] = ['year', 'quarter', 'month', 'week'];

export interface TimelineLaneInput {
  name: string;
  docs: DocumentView[];
}

export interface TimelineTick {
  label: string;
  left: number;
  /** Ведущая подпись периода, начавшегося до левого края шкалы: стоит на left 0, без засечки. */
  lead: boolean;
}

/** Позиция ряда: одиночная плашка (count 1) или колода (count ≥ 2). */
export interface TimelineChipModel {
  /** docKey первого письма позиции. Уникален ТОЛЬКО внутри дорожки (входящее может быть в двух темах). */
  id: string;
  // Лицо позиции — последнее (самое позднее) письмо.
  regNumber: string;
  kind: DocKind;
  regLabel: string;
  topic: string;
  status: DocStatus | null; // null у входящих: статуса исполнения у них нет (§2)
  title: string;
  /** = px(дата первого письма): левый край, при flip — правый. */
  left: number;
  top: number;
  flip: boolean;
  count: number;
  sheets: 0 | 1 | 2;
  /** Диапазон дат колоды «12.01 – 19.01»; '' у одиночной плашки. */
  rangeLabel: string;
  /** docKey писем позиции в порядке дат. */
  memberIds: string[];
  firstEpoch: number;
  lastEpoch: number;
}

export interface TimelineLinkModel {
  left: number;
  width: number;
  top: number;
}

export interface TimelineLaneModel {
  name: string;
  meta: string;
  alert: boolean;
  chips: TimelineChipModel[];
  links: TimelineLinkModel[];
  height: number;
  tail: TimelineLinkModel | null;
}

export interface TimelineModel {
  ticks: TimelineTick[];
  lanes: TimelineLaneModel[];
  trackWidth: number;
  todayLeft: number;
  rangeLabel: string;
  /** Левая граница шкалы (эпоха-день) и px/день: px(day) = round((day − lo) · ppd). */
  lo: number;
  ppd: number;
}

/** Цель клика по колоде: дорожка + письма колоды (docKey уникален только внутри дорожки). */
export interface DeckTarget {
  lane: string;
  memberIds: string[];
}

interface LetterWork {
  doc: DocumentView;
  key: string;
  dateEpoch: number;
  order: number;
}

interface ChainWork {
  members: LetterWork[];
  closed: boolean;
}

/** Выход collectChains — вход layoutTimeline. Для UI непрозрачен. */
export interface LaneChains {
  name: string;
  letters: LetterWork[];
  dues: number[];
  chains: ChainWork[];
}

export const PPD: Record<TimelineZoom, number> = { week: 28, month: 9, quarter: 3.2, year: 1.1 };
/** Ширина плашки. Та же 180px стоит у .timeline__pos в blocks/timeline/timeline.css — менять вместе. */
export const CHIP_W = 180;
export const CHIP_GAP = 12;
const ROW_H = 32;
/** Ряд, где есть колода: лицо в две строки + подложки со сдвигом вверх. */
const ROW_H_DECK = 56;
const ROW_PAD_TOP = 4;
const ROW_PAD_BOTTOM = 14;
/** Ведущая подпись оси ставится, только если до первой полной засечки не меньше этого (подпись + отступ). */
const LEAD_MIN_PX = 96;
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const ROMAN = ['I', 'II', 'III', 'IV'];

/**
 * Подмешать в дорожки привязанные входящие письма (§6): входящее показывается в теме той задачи,
 * которая его привязала. Непривязанные входящие на таймлайн не попадают.
 * `byKey` — индекс всех документов (`App.byReg`): у `AttachedLetter` нет даты, а без неё
 * плашку некуда поставить, поэтому берём полный `DocumentView`.
 */
export function withAttachedIncoming(
  groups: TimelineLaneInput[],
  byKey: Map<string, DocumentView>,
): TimelineLaneInput[] {
  return groups.map((group) => {
    const docs = group.docs.slice();
    const seen = new Set(docs.map((d) => docKey(d.kind, d.regNumber)));
    for (const doc of group.docs) {
      for (const link of doc.links) {
        if (link.letterKind !== 'incoming') continue;
        const key = docKey('incoming', link.letterReg);
        // Одно входящее может закрывать несколько задач одной темы — в дорожке оно одно.
        if (seen.has(key)) continue;
        const full = byKey.get(key);
        if (!full) continue;
        seen.add(key);
        docs.push(full);
      }
    }
    return { name: group.name, docs };
  });
}

function compareLetters(a: LetterWork, b: LetterWork): number {
  if (a.dateEpoch !== b.dateEpoch) return a.dateEpoch - b.dateEpoch;
  if (a.doc.kind !== b.doc.kind) return a.doc.kind === 'outgoing' ? -1 : 1;
  if (a.doc.regNumber === b.doc.regNumber) return 0;
  return a.doc.regNumber < b.doc.regNumber ? -1 : 1;
}

/**
 * Цепочка закрыта, если в ней есть входящее (ответ пришёл) И все её исходящие выполнены.
 * Повторное исходящее без ответа держит цепочку открытой (решение пользователя (А), 2026-09-19).
 */
function chainClosed(members: LetterWork[]): boolean {
  return (
    members.some((m) => m.doc.kind === 'incoming') &&
    members.every((m) => m.doc.kind !== 'outgoing' || m.doc.status === 'done')
  );
}

/**
 * Цепочки дорожки по привязкам. У каждого письма один «главный родитель» — самое раннее из
 * ссылающихся на него БОЛЕЕ РАННИХ писем (если таких нет — самое раннее из любых). Так входящее,
 * привязанное к двум задачам темы, живёт в цепочке первой по дате задачи, а взаимные привязки
 * не дают цикла. Обход — DFS с множеством посещённых, без лимита длины.
 */
export function collectChains(groups: TimelineLaneInput[]): LaneChains[] {
  return groups.map((group) => {
    const dues = group.docs
      .map((d) => isoToEpochDay(d.dueDate ?? ''))
      .filter((v): v is number => v !== null);

    const letters: LetterWork[] = [];
    const seen = new Set<string>();
    for (const doc of group.docs) {
      const dateEpoch = isoToEpochDay(doc.regDate);
      const key = docKey(doc.kind, doc.regNumber);
      if (dateEpoch === null || seen.has(key)) continue;
      seen.add(key);
      letters.push({ doc, key, dateEpoch, order: 0 });
    }
    letters.sort(compareLetters);
    letters.forEach((l, i) => {
      l.order = i;
    });
    const byKey = new Map(letters.map((l) => [l.key, l]));

    const parent = new Map<string, LetterWork>();
    for (const p of letters) {
      for (const link of p.doc.links) {
        const child = byKey.get(docKey(link.letterKind, link.letterReg));
        if (!child || child === p) continue;
        const cur = parent.get(child.key);
        if (!cur) {
          parent.set(child.key, p);
          continue;
        }
        const pEarlier = p.order < child.order;
        const curEarlier = cur.order < child.order;
        if (pEarlier !== curEarlier ? pEarlier : p.order < cur.order) parent.set(child.key, p);
      }
    }
    const children = new Map<string, LetterWork[]>();
    for (const l of letters) {
      const p = parent.get(l.key);
      if (!p) continue;
      const list = children.get(p.key);
      if (list) list.push(l);
      else children.set(p.key, [l]);
    }

    const visited = new Set<string>();
    const chains: ChainWork[] = [];
    const walk = (root: LetterWork): void => {
      const pre = new Map<string, number>();
      const members: LetterWork[] = [];
      const stack: LetterWork[] = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!node || visited.has(node.key)) continue;
        visited.add(node.key);
        pre.set(node.key, members.length);
        members.push(node);
        const kids = children.get(node.key) ?? [];
        for (let i = kids.length - 1; i >= 0; i--) {
          const kid = kids[i];
          if (kid && !visited.has(kid.key)) stack.push(kid);
        }
      }
      members.sort(
        (a, b) => a.dateEpoch - b.dateEpoch || (pre.get(a.key) ?? 0) - (pre.get(b.key) ?? 0),
      );
      chains.push({ members, closed: chainClosed(members) });
    };

    for (const l of letters) if (!parent.has(l.key)) walk(l);
    // Страховка от циклов: недостижимые от корней — от самого раннего непосещённого.
    for (const l of letters) if (!visited.has(l.key)) walk(l);

    return { name: group.name, letters, dues, chains };
  });
}

// ---- Ось -------------------------------------------------------------------------------------

function periodStart(zoom: TimelineZoom, day: number): number {
  if (zoom === 'week') return day - (((day + 3) % 7) + 7) % 7; // эпоха-день 0 — четверг
  const { y, m } = epochDayToYmd(day);
  if (zoom === 'year') return ymdToEpochDay(y, 1, 1);
  if (zoom === 'quarter') return ymdToEpochDay(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
  return ymdToEpochDay(y, m, 1);
}

function nextPeriod(zoom: TimelineZoom, start: number): number {
  if (zoom === 'week') return start + 7;
  const { y, m } = epochDayToYmd(start);
  if (zoom === 'year') return ymdToEpochDay(y + 1, 1, 1);
  const nm = m + (zoom === 'quarter' ? 3 : 1);
  return nm > 12 ? ymdToEpochDay(y + 1, nm - 12, 1) : ymdToEpochDay(y, nm, 1);
}

function periodLabel(zoom: TimelineZoom, start: number, first: boolean): string {
  const { y, m, d } = epochDayToYmd(start);
  const month = MONTH_NAMES[m - 1] ?? '';
  if (zoom === 'year') return String(y);
  if (zoom === 'quarter') return `${ROMAN[Math.floor((m - 1) / 3)] ?? ''} кв. ${y}`;
  if (zoom === 'month') return first || m === 1 ? `${month} ${y}` : month;
  return first || (m === 1 && d <= 7) ? `${d} ${month} ${y}` : `${d} ${month}`;
}

/** Подписи оси (QA-3 п.7): «2026» · «I кв. 2026» · «янв 2026», «фев» · «5 янв 2026», «12 янв». */
function buildTicks(
  zoom: TimelineZoom,
  lo: number,
  hi: number,
  px: (day: number) => number,
): TimelineTick[] {
  const starts: number[] = [];
  for (let s = periodStart(zoom, lo); s <= hi; s = nextPeriod(zoom, s)) starts.push(s);
  const full = starts.filter((s) => s >= lo);
  const ticks: TimelineTick[] = [];
  const firstStart = starts[0];
  if (firstStart !== undefined && firstStart < lo) {
    const firstFull = full[0];
    if (firstFull === undefined || px(firstFull) >= LEAD_MIN_PX) {
      ticks.push({ label: periodLabel(zoom, firstStart, true), left: 0, lead: true });
    }
  }
  for (const s of full) {
    ticks.push({ label: periodLabel(zoom, s, ticks.length === 0), left: px(s), lead: false });
  }
  return ticks;
}

// ---- Тексты плашек ---------------------------------------------------------------------------

function statusText(doc: DocumentView): string {
  return doc.statusLabel ?? (doc.status === null ? '' : statusLabelOf(doc.status));
}

function singleTitle(doc: DocumentView): string {
  return doc.kind === 'incoming'
    ? `№ ${doc.regNumber} · ${doc.topic} · ВХ · ${formatIsoDate(doc.regDate)}`
    : `№ ${doc.regNumber} · ${doc.topic} · ${formatIsoDate(doc.regDate)} · ${statusText(doc)} · ${remainingFor(doc).text}`;
}

function shortDate(day: number): string {
  return formatEpochDay(day).slice(0, 5);
}

function rangeOf(first: number, last: number): string {
  return epochDayToYmd(first).y === epochDayToYmd(last).y
    ? `${shortDate(first)} — ${shortDate(last)}`
    : `${formatEpochDay(first)} — ${formatEpochDay(last)}`;
}

function deckTitle(items: LetterWork[], zoom: TimelineZoom): string {
  const first = items[0];
  const face = items[items.length - 1];
  if (!first || !face) return '';
  const lines = [
    `${lettersLabel(items.length)} · ${formatEpochDay(first.dateEpoch)} — ${formatEpochDay(face.dateEpoch)}`,
    ...items.map((l) =>
      l.doc.kind === 'incoming'
        ? `№ ${l.doc.regNumber} · ВХ · ${formatEpochDay(l.dateEpoch)}`
        : `№ ${l.doc.regNumber} · ИСХ · ${formatEpochDay(l.dateEpoch)} · ${statusText(l.doc)}`,
    ),
    zoom === 'week' ? `Открыть письмо № ${face.doc.regNumber}` : 'Увеличить масштаб',
  ];
  return lines.join('\n');
}

// ---- Раскладка -------------------------------------------------------------------------------

interface PosWork {
  x: number;
  items: LetterWork[];
}

export function layoutTimeline(
  lanesIn: LaneChains[],
  todayEpoch: number,
  zoom: TimelineZoom,
  hideClosed: boolean,
): TimelineModel {
  // Шкала — по ВСЕМ письмам (hideClosed её не меняет).
  const starts = lanesIn.reduce<number[]>(
    (acc, l) => acc.concat(l.letters.map((x) => x.dateEpoch)),
    [],
  );
  const dues = lanesIn.reduce<number[]>((acc, l) => acc.concat(l.dues), []);
  const lo = Math.min(...starts, todayEpoch) - 8;
  // Даты писем входят и в правую границу: у входящих нет dueDate, и письмо, пришедшее позже
  // последнего срока, иначе прижалось бы к краю трека. Запас 8 дней ⇒ px(дата) < trackPx.
  const hi = Math.max(...dues, ...starts, todayEpoch) + 8;

  const ppd = PPD[zoom];
  const totalDays = Math.max(30, hi - lo);
  const trackPx = Math.max(560, Math.round(totalDays * ppd));
  const px = (day: number): number => Math.round((day - lo) * ppd);
  const flipAt = (x: number): boolean => x + CHIP_W > trackPx;
  const occLeft = (x: number): number => (flipAt(x) ? x - CHIP_W : x);
  const occRight = (x: number): number => (flipAt(x) ? x : x + CHIP_W);

  const ticks = buildTicks(zoom, lo, hi, px);

  // Колода: письмо примагничивается к текущей позиции, если его плашка на своей дате
  // наложилась бы на неё (с учётом разворота у правого края).
  const cluster = (members: LetterWork[]): PosWork[] => {
    const out: PosWork[] = [];
    for (const m of members) {
      const x = px(m.dateEpoch);
      const cur = out[out.length - 1];
      if (cur && occLeft(x) < occRight(cur.x) + CHIP_GAP) cur.items.push(m);
      else out.push({ x, items: [m] });
    }
    return out;
  };

  const lanes: TimelineLaneModel[] = [];
  for (const lane of lanesIn) {
    if (!lane.letters.length) continue;
    // Открытые цепочки — верхние ряды, закрытые — ниже; при hideClosed закрытые не кладутся.
    const rows = lane.chains
      .filter((c) => !c.closed)
      .concat(hideClosed ? [] : lane.chains.filter((c) => c.closed));
    if (!rows.length) continue;

    const chips: TimelineChipModel[] = [];
    const links: TimelineLinkModel[] = [];
    const visible: LetterWork[] = [];
    let y = ROW_PAD_TOP;
    let last: { epoch: number; x: number; top: number } | null = null;

    for (const chain of rows) {
      const positions = cluster(chain.members);
      const pitch = positions.some((p) => p.items.length > 1) ? ROW_H_DECK : ROW_H;
      const top = y + pitch / 2;
      y += pitch;
      let prevLeft: number | null = null;
      for (const pos of positions) {
        const first = pos.items[0];
        const face = pos.items[pos.items.length - 1];
        if (!first || !face) continue;
        const n = pos.items.length;
        chips.push({
          id: first.key,
          regNumber: face.doc.regNumber,
          kind: face.doc.kind,
          regLabel: `№ ${face.doc.regNumber}`,
          topic: face.doc.topic,
          status: face.doc.status,
          title: n > 1 ? deckTitle(pos.items, zoom) : singleTitle(face.doc),
          left: pos.x,
          top,
          flip: flipAt(pos.x),
          count: n,
          sheets: n >= 3 ? 2 : n === 2 ? 1 : 0,
          rangeLabel: n > 1 ? rangeOf(first.dateEpoch, face.dateEpoch) : '',
          memberIds: pos.items.map((l) => l.key),
          firstEpoch: first.dateEpoch,
          lastEpoch: face.dateEpoch,
        });
        const left = occLeft(pos.x);
        if (prevLeft !== null) links.push({ left: prevLeft, width: Math.max(1, left - prevLeft), top });
        prevLeft = left;
        for (const l of pos.items) {
          visible.push(l);
          if (!last || l.dateEpoch >= last.epoch) last = { epoch: l.dateEpoch, x: pos.x, top };
        }
      }
    }
    if (!last) continue;

    const silence = todayEpoch - last.epoch;
    const overdue = visible.filter((l) => l.doc.status === 'overdue');
    const worst = overdue.length
      ? Math.max(...overdue.map((l) => Math.abs(l.doc.daysRemaining ?? 0)))
      : 0;
    // «Все выполнены» — про задачи: у входящих статуса нет, иначе условие никогда не выполнится
    // и пунктир «период без писем» рисовался бы всегда.
    const allClosed = visible.every((l) => l.doc.kind !== 'outgoing' || l.doc.status === 'done');

    // Подписи дорожки (решения пользователя 2026-09-20, пп.2, 3): без «ждём» и «тишины»,
    // просрочка — максимум по просроченным письмам темы, «дн.» как в компактных колонках.
    const letters = lettersLabel(visible.length);
    let meta: string;
    let alert = false;
    if (overdue.length) {
      meta = `${letters} · макс. просрочка ${worst} дн.`;
      alert = true;
    } else if (allClosed) {
      meta = `${letters} · все выполнены`;
    } else if (silence > 30) {
      meta = `${letters} · последнее письмо ${silence} дн. назад`;
      alert = true;
    } else {
      meta = `${letters} · в работе`;
    }

    lanes.push({
      name: lane.name,
      meta,
      alert,
      chips,
      links,
      height: y + ROW_PAD_BOTTOM,
      tail: allClosed
        ? null
        : { left: last.x, width: Math.max(1, px(todayEpoch) - last.x), top: last.top },
    });
  }

  return {
    ticks,
    lanes,
    trackWidth: trackPx,
    todayLeft: px(todayEpoch),
    rangeLabel: `${formatEpochDay(lo)} — ${formatEpochDay(hi)} · ${Math.round(totalDays / 30)} мес.`,
    lo,
    ppd,
  };
}

/** Обёртка: цепочки + раскладка за один вызов (тесты, совместимость). */
export function buildTimeline(
  groups: TimelineLaneInput[],
  todayEpoch: number,
  zoom: TimelineZoom,
  hideClosed: boolean,
): TimelineModel {
  return layoutTimeline(collectChains(groups), todayEpoch, zoom, hideClosed);
}

/** Занятый плашкой отрезок по x: при flip плашка стоит слева от своей даты. */
export function chipSpan(chip: TimelineChipModel): { left: number; right: number } {
  return chip.flip
    ? { left: chip.left - CHIP_W, right: chip.left }
    : { left: chip.left, right: chip.left + CHIP_W };
}

/** Позиции дорожки `target.lane`, в которых лежат письма колоды. */
export function deckPositions(model: TimelineModel, target: DeckTarget): TimelineChipModel[] {
  const lane = model.lanes.find((l) => l.name === target.lane);
  if (!lane) return [];
  return lane.chips.filter((c) => c.memberIds.some((id) => target.memberIds.includes(id)));
}

/**
 * Ближайший более крупный масштаб, на котором колода раскладывается (письма оказываются хотя бы
 * в двух позициях). null — не раскладывается ни на одном. Ищет только в своей дорожке.
 */
export function splitZoom(
  lanes: LaneChains[],
  todayEpoch: number,
  hideClosed: boolean,
  current: TimelineZoom,
  target: DeckTarget,
): TimelineZoom | null {
  const firstId = target.memberIds[0];
  if (firstId === undefined) return null;
  for (const z of ZOOM_ORDER.slice(ZOOM_ORDER.indexOf(current) + 1)) {
    const model = layoutTimeline(lanes, todayEpoch, z, hideClosed);
    const pos = deckPositions(model, { lane: target.lane, memberIds: [firstId] })[0];
    if (!pos) continue;
    if (!target.memberIds.every((id) => pos.memberIds.includes(id))) return z;
  }
  return null;
}

/** Число непустых дорожек (для подсказки таба «Связи писем») — без геометрии. */
export function laneCount(groups: TimelineLaneInput[]): number {
  return groups.filter((g) => g.docs.some((d) => isoToEpochDay(d.regDate) !== null)).length;
}
