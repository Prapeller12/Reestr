import type { DocKind } from '../../api/types';
import type { TimelineChipModel, TimelineLaneModel, TimelineTick } from '../../lib/timeline';
import TimelineChip from './TimelineChip';

interface Props {
  lane: TimelineLaneModel;
  ticks: TimelineTick[];
  trackWidth: number;
  todayLeft: number;
  onOpenDoc: (kind: DocKind, regNumber: string) => void;
  onDeck: (lane: string, chip: TimelineChipModel) => void;
}

// Дорожка темы: закреплённая слева подпись + трек с сеткой, связями,
// пунктиром «тишины» и позициями писем (плашки и колоды).
function TimelineLane({ lane, ticks, trackWidth, todayLeft, onOpenDoc, onDeck }: Props) {
  // id позиции уникален только внутри дорожки — клик по колоде несёт имя дорожки.
  const handleDeck = (chip: TimelineChipModel) => onDeck(lane.name, chip);
  return (
    <div
      className="timeline__lane"
      data-lane={lane.name}
      style={{ gridTemplateColumns: `230px ${trackWidth}px` }}
    >
      <div className="timeline__lane-side">
        <div className="timeline__lane-name">{lane.name}</div>
        <div
          className={`timeline__lane-meta${lane.alert ? ' timeline__lane-meta_alert' : ''}`}
          title={lane.meta}
        >
          {lane.meta}
        </div>
      </div>
      <div className="timeline__track" style={{ height: `${lane.height}px` }}>
        {ticks.map((t) =>
          t.lead ? null : (
            <div key={t.left} className="timeline__grid-line" style={{ left: `${t.left}px` }} />
          ),
        )}
        <div className="timeline__today-line" style={{ left: `${todayLeft}px` }} />
        {lane.links.map((k, i) => (
          <div
            key={i}
            className="timeline__link"
            style={{ left: `${k.left}px`, width: `${k.width}px`, top: `${k.top}px` }}
          />
        ))}
        {lane.tail ? (
          <div
            className="timeline__tail"
            style={{
              left: `${lane.tail.left}px`,
              width: `${lane.tail.width}px`,
              top: `${lane.tail.top}px`,
            }}
          />
        ) : null}
        {lane.chips.map((chip) => (
          <TimelineChip key={chip.id} chip={chip} onOpen={onOpenDoc} onDeck={handleDeck} />
        ))}
      </div>
    </div>
  );
}

export default TimelineLane;
