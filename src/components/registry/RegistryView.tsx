import type { DocKind } from '../../api/types';
import RegistryGroup from './RegistryGroup';
import type { GroupRow } from './RegistryGroup';
import RegistryPrintTable from './RegistryPrintTable';
import RegistryToolbar from './RegistryToolbar';
import type { DocFilters } from '../../hooks/useDocFilters';

export interface RegistryGroupModel {
  name: string;
  rows: GroupRow[];
}

interface Props {
  groups: RegistryGroupModel[];
  docFilters: DocFilters;
  shownLabel: string;
  hideClosed: boolean;
  onToggleHideClosed: () => void;
  closedGroups: Record<string, boolean>;
  onToggleGroup: (name: string) => void;
  onConfigureTheme: (name: string) => void;
  onOpenDoc: (kind: DocKind, regNumber: string) => void;
}

// Вкладка «Реестр» (QA-3 пп.2,10): две карточки — секция фильтров сверху и таблица под ней.
// Вкладка занимает остаток окна; скроллится только тело таблицы (по вертикали всегда,
// по горизонтали — когда окно уже суммы минимумов колонок). У страницы скролла нет.
function RegistryView({
  groups,
  closedGroups,
  onToggleGroup,
  onConfigureTheme,
  onOpenDoc,
  ...toolbar
}: Props) {
  return (
    <div className="screen screen_stack screen_fill">
      <RegistryToolbar {...toolbar} />
      <div className="card card_shadow screen__main">
        <div className="registry-table print-hide">
          <div className="registry-table__inner">
            {groups.length === 0 ? (
              <div className="registry-table__empty">
                Реестр пуст. Импортируйте выгрузку из 1С.
              </div>
            ) : (
              groups.map((g) => (
                <RegistryGroup
                  key={g.name}
                  name={g.name}
                  rows={g.rows}
                  open={!closedGroups[g.name]}
                  onToggle={onToggleGroup}
                  onConfigure={onConfigureTheme}
                  onOpenDoc={onOpenDoc}
                />
              ))
            )}
          </div>
        </div>
        <RegistryPrintTable groups={groups} />
      </div>
    </div>
  );
}

export default RegistryView;
