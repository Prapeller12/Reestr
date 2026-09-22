import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { stepValue } from '../../lib/segmented';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

// Сегментный переключатель (QA-3 п.4): выбран всегда ровно один пункт — радиогруппа WAI-ARIA.
// Roving tabindex (в Tab-порядке только выбранный), стрелки и Home/End выбирают соседний пункт
// и переводят на него фокус. Вид — трек `segmented` + пункты-пилюли (микс `pill segmented__item`).
function SegmentedControl<T extends string>({ label, options, value, onChange }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = options.map((o) => o.value);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = stepValue(values, value, e.key);
    if (next === null) return;
    // Стрелки и Home/End иначе заодно прокрутят оверлей или список.
    e.preventDefault();
    if (next !== value) onChange(next);
    refs.current[values.indexOf(next)]?.focus();
  };

  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={handleKeyDown}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`pill segmented__item${checked ? ' pill_active' : ''}`}
            onClick={() => {
              if (!checked) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
