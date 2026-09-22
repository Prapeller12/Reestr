import type { DocKind, DocumentView } from '../../api/types';
import { formatIsoDate } from '../../lib/dates';
import { docKey, remainingFor } from '../../lib/format';
import { useScrollLock } from '../../hooks/useScrollLock';
import StatusBadge from '../registry/StatusBadge';
import ChainList from './ChainList';
import FieldsTable from './FieldsTable';
import TransitionBlock from './TransitionBlock';
import Icon from '../common/Icon';

interface Props {
  kind: DocKind;
  regNumber: string;
  byReg: Map<string, DocumentView>;
  todayEpoch: number | null;
  onNavigate: (kind: DocKind, regNumber: string) => void;
  onClose: () => void;
  onChanged: () => void;
}

// Карточка письма. У исходящих — статус-полоса + привязка письма (смена статуса) + цепочка + поля.
// У входящих (status=null) статуса нет: только цепочка (задачи, закрытые этим письмом) и поля.
function DocumentDrawer({ kind, regNumber, byReg, todayEpoch, onNavigate, onClose, onChanged }: Props) {
  useScrollLock();
  const doc = byReg.get(docKey(kind, regNumber));
  if (!doc) return null;
  const remaining = remainingFor(doc);

  return (
    <div className="drawer__overlay print-hide" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__header">
          <div className="drawer__heading">
            <div className="drawer__eyebrow">
              {doc.kind === 'incoming' ? 'Карточка входящего письма' : 'Карточка письма'}
            </div>
            <div className="drawer__title">
              № {doc.regNumber} · {doc.topic}
            </div>
          </div>
          <button type="button" className="btn btn_icon" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer__body">
          {doc.status !== null ? (
            <div className="drawer__panel">
              <div className="drawer__status-strip">
                <StatusBadge status={doc.status} label={doc.statusLabel ?? ''} large />
                <div className="drawer__due">Срок исполнения: {formatIsoDate(doc.dueDate)}</div>
                <div className="drawer__remaining">{remaining.text}</div>
              </div>
              <TransitionBlock doc={doc} onChanged={onChanged} />
            </div>
          ) : null}

          <ChainList doc={doc} byReg={byReg} onNavigate={onNavigate} />
          <FieldsTable
            key={docKey(kind, regNumber)}
            doc={doc}
            todayEpoch={todayEpoch}
            onChanged={onChanged}
          />
        </div>
      </div>
    </div>
  );
}

export default DocumentDrawer;
