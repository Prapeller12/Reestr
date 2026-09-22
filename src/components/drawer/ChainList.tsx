import type { ChainNode, DocKind, DocumentView } from '../../api/types';
import { formatIsoDate, isoToEpochDay } from '../../lib/dates';
import { docKey, statusLabelOf } from '../../lib/format';
import TypeChip from '../registry/TypeChip';

interface Props {
  doc: DocumentView;
  byReg: Map<string, DocumentView>;
  onNavigate: (kind: DocKind, regNumber: string) => void;
}

interface Node {
  regNumber: string;
  kind: DocKind;
  topic: string;
  date: string;
  status: string;
  role: string;
  current: boolean;
}

// Цепочка писем по привязкам (LINK). Backend отдаёт предыдущие письма от ближнего к дальнему —
// разворачиваем в хронологический порядок, как в прототипе. Узлы обоих видов: повторные исходящие
// и входящее, которым задача закрыта (у него статуса нет — «—»).
function ChainList({ doc, byReg, onNavigate }: Props) {
  const toNode = (n: ChainNode, role: string): Node => {
    const full = byReg.get(docKey(n.kind, n.regNumber));
    return {
      regNumber: n.regNumber,
      kind: n.kind,
      topic: n.topic,
      date: full ? formatIsoDate(full.regDate) : '—',
      status: n.status === null ? '—' : statusLabelOf(n.status),
      role: n.kind === 'incoming' ? 'Входящее' : role,
      current: false,
    };
  };

  const epochOf = (n: ChainNode): number | null =>
    isoToEpochDay(byReg.get(docKey(n.kind, n.regNumber))?.regDate ?? '');

  const nodes: Node[] = [
    ...[...doc.chain.predecessors].reverse().map((n) => toNode(n, 'Предыдущее')),
    {
      regNumber: doc.regNumber,
      kind: doc.kind,
      topic: doc.topic,
      date: formatIsoDate(doc.regDate),
      status: doc.statusLabel ?? '—',
      role: 'Текущее',
      current: true,
    },
    // Последующие — по дате регистрации по возрастанию (QA-3 п.3 (г)); без даты — в конец.
    ...doc.chain.successors
      .map((n) => ({ n, epoch: epochOf(n) }))
      .sort((a, b) => (a.epoch ?? Infinity) - (b.epoch ?? Infinity))
      .map(({ n }) => toNode(n, 'Последующее')),
  ];

  if (nodes.length <= 1) return null;

  return (
    <div className="drawer__section">
      <div className="drawer__section-title">Цепочка писем</div>
      <div className="chain">
        {nodes.map((n) => (
          <div key={`${n.role}-${docKey(n.kind, n.regNumber)}`} className="chain__node">
            <div className="chain__date">{n.date}</div>
            <button
              type="button"
              className="chain__body"
              onClick={() => onNavigate(n.kind, n.regNumber)}
            >
              <span className="chain__dot" />
              <span className={`chain__card${n.current ? ' chain__card_current' : ''}`}>
                <span className="chain__row">
                  <TypeChip kind={n.kind} />
                  <span className="chain__reg">№ {n.regNumber}</span>
                  <span className="chain__role">{n.role}</span>
                </span>
                <span className="chain__topic">{n.topic}</span>
                <span className="chain__status">{n.status}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChainList;
