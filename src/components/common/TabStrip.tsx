import type { ReactNode } from 'react';
import Icon from './Icon';

export type Tab = 'registry' | 'graph';

interface Props {
  tab: Tab;
  registryHint: string;
  graphHint: string;
  onPick: (tab: Tab) => void;
}

// Иконки разделов — компонент Icon (currentColor): «Реестр» — список, «Хронология» — граф.
const ICON_REGISTRY: ReactNode = <Icon name="list" size={20} className="tab-strip__ico" />;
const ICON_GRAPH: ReactNode = <Icon name="link" size={20} className="tab-strip__ico" />;

// Полоса вкладок — сегментный переключатель: серая капсула, активная вкладка —
// тёмная (инверсия). Кнопки — пилюли с миксом tab-strip__item (внутри капсулы без своей заливки).
function TabStrip({ tab, registryHint, graphHint, onPick }: Props) {
  const items: { key: Tab; label: string; hint: string; icon: ReactNode }[] = [
    { key: 'registry', label: 'Реестр', hint: registryHint, icon: ICON_REGISTRY },
    { key: 'graph', label: 'Хронология', hint: graphHint, icon: ICON_GRAPH },
  ];
  return (
    <div className="tab-strip print-hide">
      <div className="tab-strip__seg">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`pill tab-strip__item${tab === it.key ? ' pill_active' : ''}`}
            onClick={() => onPick(it.key)}
          >
            {it.icon}
            <span>{it.label}</span>
            <span className="pill__hint">{it.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default TabStrip;
