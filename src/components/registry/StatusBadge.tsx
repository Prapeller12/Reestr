import type { DocStatus } from '../../api/types';
import { statusMod } from '../../lib/format';

interface Props {
  status: DocStatus;
  label: string;
  large?: boolean;
}

// Бейдж статуса. Подпись приходит с backend (statusLabel) — фронт её не вычисляет.
function StatusBadge({ status, label, large = false }: Props) {
  return (
    <span
      className={`status-badge status-badge_${statusMod(status)}${large ? ' status-badge_lg' : ''}`}
    >
      {label}
    </span>
  );
}

export default StatusBadge;
