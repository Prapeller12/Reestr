import type { DocKind } from '../../api/types';
import type { TimelineChipModel } from '../../lib/timeline';
import { statusMod } from '../../lib/format';
import { lettersLabel } from '../../lib/texts';
import TypeChip from '../registry/TypeChip';

interface Props {
  chip: TimelineChipModel;
  onOpen: (kind: DocKind, regNumber: string) => void;
  onDeck: (chip: TimelineChipModel) => void;
}

// Позиция ряда: одиночная плашка письма или «колода» из нескольких писем (QA-3 п.3). На дате
// стоит левый край (у правого края трека — правый, flip), там же — метка даты (п.8).
// Координаты (left/top) и разворот — вычисляемая геометрия, единственное допустимое inline-style.
function TimelineChip({ chip, onOpen, onDeck }: Props) {
  // У входящего статуса нет (§2) — свой модификатор вида, вне четвёрки статусов.
  const mod = chip.status === null ? 'incoming' : statusMod(chip.status);
  const deck = chip.count > 1;
  const kindChip = chip.kind === 'incoming' ? <TypeChip kind="incoming" /> : null;
  return (
    <div
      className={`timeline__pos${chip.flip ? ' timeline__pos_flip' : ''}`}
      data-pos={chip.id}
      style={{
        left: `${chip.left}px`,
        top: `${chip.top}px`,
        transform: chip.flip ? 'translate(-100%,-50%)' : 'translateY(-50%)',
      }}
    >
      {/* Подложки колоды — в приглушённом цвете статуса лица, чтобы стопка читалась. */}
      {chip.sheets >= 2 ? (
        <span className={`timeline__sheet timeline__sheet_2 timeline__sheet_${mod}`} />
      ) : null}
      {chip.sheets >= 1 ? (
        <span className={`timeline__sheet timeline__sheet_1 timeline__sheet_${mod}`} />
      ) : null}
      <button
        type="button"
        className={`timeline__chip timeline__chip_${mod}${deck ? ' timeline__chip_deck' : ''}`}
        title={chip.title}
        aria-label={
          deck
            ? `${lettersLabel(chip.count)}, ${chip.rangeLabel}, последнее ${chip.regLabel}`
            : undefined
        }
        onClick={() => (deck ? onDeck(chip) : onOpen(chip.kind, chip.regNumber))}
      >
        {/* Метка даты — внутри плашки: цвет берёт от её текста (currentColor). */}
        <span className="timeline__date-mark" />
        {deck ? (
          <>
            <span className="timeline__chip-line">
              {kindChip}
              <span className="timeline__chip-reg">{chip.regLabel}</span>
              <span className="timeline__chip-topic">{chip.topic}</span>
            </span>
            <span className="timeline__chip-line">
              <span className="timeline__chip-range">{chip.rangeLabel}</span>
              <span className="timeline__chip-count">×{chip.count}</span>
            </span>
          </>
        ) : (
          <>
            {kindChip}
            <span className="timeline__chip-reg">{chip.regLabel}</span>
            <span className="timeline__chip-topic">{chip.topic}</span>
          </>
        )}
      </button>
    </div>
  );
}

export default TimelineChip;
