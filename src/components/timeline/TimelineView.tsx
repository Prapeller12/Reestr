import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { DocKind } from '../../api/types';
import { chipSpan, collectChains, deckPositions, layoutTimeline, layoutTimelineRows, splitZoom } from '../../lib/timeline';
import type {
  DeckTarget,
  TimelineChipModel,
  TimelineLaneInput,
  TimelineZoom,
} from '../../lib/timeline';
import TimelineAxis from './TimelineAxis';
import TimelineLane from './TimelineLane';

interface Props {
  groups: TimelineLaneInput[];
  todayEpoch: number | null;
  zoom: TimelineZoom;
  onZoom: (zoom: TimelineZoom) => void;
  hideClosed: boolean;
  onToggleHideClosed: () => void;
  onOpenDoc: (kind: DocKind, regNumber: string) => void;
}

// Четыре статуса задач (§3) + вид «входящее»: у входящего письма статуса нет, оно показывает,
// чем закрыта задача.
const LEGEND: { mod: string; label: string }[] = [
  { mod: 'inwork', label: 'В работе' },
  { mod: 'done', label: 'Выполнено' },
  { mod: 'overdue', label: 'Не выполнено' },
  { mod: 'reworked', label: 'В доработке' },
  { mod: 'incoming', label: 'Входящее' },
];

const ZOOMS: { key: TimelineZoom; label: string }[] = [
  { key: 'week', label: 'Недели' },
  { key: 'month', label: 'Месяцы' },
  { key: 'quarter', label: 'Кварталы' },
  { key: 'year', label: 'Годы' },
];

// Ширина стороны дорожки (grid-колонка подписи) — как в TimelineLane/TimelineAxis.
const LANE_SIDE_W = 230;
// Печатная область A4 landscape (297×210мм − поля 2×10мм = 277×190мм @96dpi ≈ 1047×718px,
// см. print.css @page). Ширину берём с небольшим запасом (1040). По высоте резервируем место
// под шапку страницы и компактную легенду над графом (~130px) — остаток отдаём графу, чтобы он
// уместился на первом листе рядом с легендой, а не уезжал на пустой второй лист.
const PRINT_PAGE_W = 1040;
const PRINT_PAGE_H = 560;
// Ниже этого масштаба печати граф нечитаем — подсказываем выбрать масштаб помельче (решение (Б)).
const PRINT_HINT_SCALE = 0.35;
// Высота липкой оси (40px + нижняя рамка): при фокусе на колоде ряд не должен уйти под неё.
const AXIS_H = 41;

// Вкладка «Хронология»: карточка-легенда + карточка-график.
function TimelineView({ groups, todayEpoch, zoom, onZoom, hideClosed, onToggleHideClosed, onOpenDoc }: Props) {
  // Цепочки не зависят от масштаба — при переключении масштаба пересчитывается только раскладка.
  const chains = useMemo(() => collectChains(groups), [groups]);
  const model = useMemo(
    () => (todayEpoch === null ? null : layoutTimeline(chains, todayEpoch, zoom, hideClosed)),
    [chains, todayEpoch, zoom, hideClosed],
  );

  const rows = useMemo(() => model ? layoutTimelineRows(model, chains) : [], [model, chains]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Колода, к которой нужно прокрутить после смены масштаба (без state: не нужен лишний рендер).
  const focusRef = useRef<DeckTarget | null>(null);

  const handleZoom = useCallback(
    (next: TimelineZoom) => {
      focusRef.current = null;
      onZoom(next);
    },
    [onZoom],
  );

  // Клик по колоде (QA-3 п.3): масштаб, на котором она раскладывается; если такого нет —
  // «неделя»; на «неделе» без распада — карточка верхнего (последнего) письма.
  const handleDeck = useCallback(
    (lane: string, chip: TimelineChipModel) => {
      if (todayEpoch === null) return;
      const target: DeckTarget = { lane, memberIds: chip.memberIds };
      const next =
        splitZoom(chains, todayEpoch, hideClosed, zoom, target) ?? (zoom === 'week' ? null : 'week');
      if (next === null) {
        onOpenDoc(chip.kind, chip.regNumber);
        return;
      }
      focusRef.current = target;
      onZoom(next);
    },
    [chains, todayEpoch, zoom, hideClosed, onZoom, onOpenDoc],
  );

  // После смены масштаба: центр письма колоды → центр видимой части трека (левые 230px закрыты
  // липкой колонкой тем); по вертикали — минимальный сдвиг, если ряд вне видимой области.
  useLayoutEffect(() => {
    const target = focusRef.current;
    focusRef.current = null;
    const scroll = scrollRef.current;
    if (!target || !model || !scroll) return;
    const positions = deckPositions(model, target);
    const firstPos = positions[0];
    if (!firstPos) return;
    const spans = positions.map(chipSpan);
    const cx =
      (Math.min(...spans.map((s) => s.left)) + Math.max(...spans.map((s) => s.right))) / 2;
    scroll.scrollLeft = Math.max(0, cx - (scroll.clientWidth - LANE_SIDE_W) / 2);

    const laneEl = Array.from(scroll.querySelectorAll<HTMLElement>('[data-lane]')).find(
      (el) => el.dataset.lane === target.lane,
    );
    const posEl = laneEl
      ? Array.from(laneEl.querySelectorAll<HTMLElement>('[data-pos]')).find(
          (el) => el.dataset.pos === firstPos.id,
        )
      : undefined;
    if (!posEl) return;
    const box = scroll.getBoundingClientRect();
    const pos = posEl.getBoundingClientRect();
    const topBound = box.top + AXIS_H;
    const bottomBound = box.top + scroll.clientHeight;
    if (pos.top < topBound) scroll.scrollTop -= topBound - pos.top + 8;
    else if (pos.bottom > bottomBound) scroll.scrollTop += pos.bottom - bottomBound + 8;
  }, [model]);

  // Масштаб печати: вписываем ВЕСЬ граф (ось + все дорожки со всеми плашками) в ОДИН
  // альбомный лист — и по ширине, И по высоте, чтобы ось и плашки всегда были на одном листе,
  // ничего не обрезалось снизу и не появлялось пустых листов (п.6).
  //   scale = min(1, доступная_ширина / ширина_графа, доступная_высота / высота_графа).
  // Ширина графа = подпись дорожки (230) + ширина трека. Высоту графа берём по РЕАЛЬНОЙ высоте
  // дорожек: lane.height = число рядов каскада × 32 + 18 (timeline.ts) — каждая несвязанная
  // плашка кладётся отдельным рядом со ступенькой 32px вниз, поэтому диагональный каскад из
  // десятков плашек честно попадает в высоту (не грубая оценка — из-за заниженной высоты
  // контент раньше уезжал на 2-й лист). Пол 64px — минимальная высота подписи дорожки, +1px —
  // нижняя рамка, 35px — ось. Приоритет — весь граф на одном листе без обрезки, даже если
  // плашки станут мелкими. На экране переменные не используются — только в @media print
  // (print.css). Inline-style разрешён в timeline/**.
  const print = useMemo(() => {
    if (!model || !model.lanes.length) return null;
    const graphWidth = LANE_SIDE_W + model.trackWidth;
    const graphHeight =
      35 + model.lanes.reduce((h, lane) => h + Math.max(lane.height, 64) + 1, 0);
    const scale = Math.min(1, PRINT_PAGE_W / graphWidth, PRINT_PAGE_H / graphHeight);
    return {
      scale,
      vars: {
        ['--timeline-print-scale']: String(scale),
        ['--timeline-print-h']: `${graphHeight}px`,
      } as CSSProperties,
    };
  }, [model]);
  // Подсказка про печать (решение (Б)): советуем только масштабы мельче текущего; на «годах»
  // мельче нет — подсказки нет.
  const printHint =
    print === null || print.scale >= PRINT_HINT_SCALE || zoom === 'year'
      ? null
      : zoom === 'quarter'
        ? 'Для печати выберите масштаб «Годы»'
        : 'Для печати выберите масштаб «Кварталы» или «Годы»';

  return (
    <div className="screen screen_stack screen_fill">
      <div className="card">
        <div className="timeline-legend">
          {/* Заголовок карточки убран (решение пользователя 2026-09-20, п.10): он дублировал
              название вкладки. Легенда остаётся. */}
          <div className="timeline-legend__hint">
            Сплошная линия: привязка писем. Пунктир: период без писем до текущей даты. «ВХ»:
            входящее письмо.
          </div>
          <div className="page__spacer" />
          <div className="timeline-legend__items">
            {LEGEND.map((l) => (
              <div key={l.mod} className="timeline-legend__item">
                <div className={`timeline-legend__swatch timeline-legend__swatch_${l.mod}`} />
                <div className="timeline-legend__label">{l.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Главная карточка вкладки: сжимается до остатка окна, скроллится тело (QA-3 п.2). */}
      <div className="card screen__main">
        <div className="timeline-scale">
          <div className="timeline-scale__label">Масштаб</div>
          {ZOOMS.map((z) => (
            <button
              key={z.key}
              type="button"
              className={`pill pill_sm${zoom === z.key ? ' pill_active' : ''}`}
              onClick={() => handleZoom(z.key)}
            >
              {z.label}
            </button>
          ))}
          <button
            type="button"
            className={`pill pill_sm${hideClosed ? ' pill_active' : ''}`}
            onClick={onToggleHideClosed}
          >
            Скрыть завершённые
          </button>
          <div className="page__spacer" />
          {printHint ? (
            <div className="timeline-scale__note print-hide">{printHint}</div>
          ) : null}
          <div className="timeline-scale__range">{model ? model.rangeLabel : ''}</div>
        </div>

        {model && model.lanes.length ? (
          <div className="timeline__scroll" ref={scrollRef} style={print?.vars}>
            <TimelineAxis
              ticks={model.ticks}
              trackWidth={model.trackWidth}
              todayLeft={model.todayLeft}
            />
            {rows.map((row) => (
              <TimelineLane key={`screen-${zoom}-${row.name}`} lane={row} row={row}
                ticks={model.ticks} trackWidth={model.trackWidth} todayLeft={model.todayLeft}
                onOpenDoc={onOpenDoc} onDeck={handleDeck} />
            ))}
            {model.lanes.map((lane) => (
              <TimelineLane
                key={lane.name}
                lane={lane}
                ticks={model.ticks}
                trackWidth={model.trackWidth}
                todayLeft={model.todayLeft}
                onOpenDoc={onOpenDoc}
                onDeck={handleDeck}
              />
            ))}
          </div>
        ) : (
          <div className="timeline__empty">Данных нет. Импортируйте выгрузку из 1С.</div>
        )}
      </div>
    </div>
  );
}

export default TimelineView;
