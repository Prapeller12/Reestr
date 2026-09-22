import type { TimelineTick } from '../../lib/timeline';

interface Props {
  ticks: TimelineTick[];
  trackWidth: number;
  todayLeft: number;
}

// Ось времени: засечки масштаба + пунктирная линия текущей даты с подписью. Ведущая подпись
// (период, начавшийся до левого края шкалы) — на left 0, без засечки (QA-3 п.7).
function TimelineAxis({ ticks, trackWidth, todayLeft }: Props) {
  return (
    <div className="timeline__axis" style={{ gridTemplateColumns: `230px ${trackWidth}px` }}>
      <div className="timeline__axis-side" />
      <div className="timeline__axis-track">
        {ticks.map((t) => (
          <div
            key={t.left}
            className={`timeline__tick${t.lead ? ' timeline__tick_lead' : ''}`}
            style={{ left: `${t.left}px` }}
          >
            <div className="timeline__tick-label">{t.label}</div>
          </div>
        ))}
        <div className="timeline__today" style={{ left: `${todayLeft}px` }}>
          <div className="timeline__tick-label">Текущая дата</div>
        </div>
      </div>
    </div>
  );
}

export default TimelineAxis;
