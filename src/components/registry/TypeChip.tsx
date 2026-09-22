import type { DocKind } from '../../api/types';

interface Props {
  kind: DocKind;
}

// Чип вида документа: ИСХ (исходящее) / ВХ (входящее). Лейбл — фиксированная UI-строка,
// не доменные данные (правило «статус с backend» касается только статуса исполнения).
function TypeChip({ kind }: Props) {
  const isIncoming = kind === 'incoming';
  return (
    <span className={`type-chip type-chip_${isIncoming ? 'in' : 'out'}`}>
      {isIncoming ? 'ВХ' : 'ИСХ'}
    </span>
  );
}

export default TypeChip;
