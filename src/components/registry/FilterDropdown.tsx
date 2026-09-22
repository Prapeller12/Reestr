import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import type { FilterOption } from '../../lib/docFilters';
import Icon from '../common/Icon';

interface Props {
  label: string;
  valueLabel: string;
  active: boolean;
  open: boolean;
  options: FilterOption[];
  onToggle: () => void;
  onPick: (value: string) => void;
}

// Мультиселект: пункт «все» (value '') сбрасывает фильтр, остальные переключаются.
// Счётчики считаются по нефильтрованному списку — как в прототипе.
// Меню — порталом в document.body с position:fixed от кнопки (QA-3 п.10): его не обрезает
// overflow ни одного предка (карточка реестра, модалка тем). Позицию, направление (вниз/вверх)
// и max-height считает useFloatingPosition. Закрытие кликом вне — у владельца состояния по
// селектору '.filter, .filter__menu' (меню в DOM вне .filter).
// Длинное значение обрезается многоточием (filter.css, .filter__value), полное — в title кнопки.
function FilterDropdown({ label, valueLabel, active, open, options, onToggle, onPick }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusInMenuRef = useRef(false);
  const menuId = useId();
  const placement = useFloatingPosition(open, anchorRef, menuRef);

  // Меню закрылось, пока фокус был в нём (напр. Escape) — фокус ушёл бы на body вместе с
  // размонтированным порталом; возвращаем его на кнопку фильтра.
  useEffect(() => {
    if (open || !focusInMenuRef.current) return;
    focusInMenuRef.current = false;
    const current = document.activeElement;
    if (current === null || current === document.body) anchorRef.current?.focus();
  }, [open]);

  return (
    <div className="filter">
      <button
        ref={anchorRef}
        type="button"
        className={`filter__button${active ? ' filter__button_active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`${label} ${valueLabel}`}
        onClick={onToggle}
      >
        <span className="filter__label">{label}</span>
        <span className="filter__value">{valueLabel}</span>
        <Icon name="chevron-down" className="filter__caret" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="group"
              aria-label={label}
              className={`filter__menu print-hide${placement === 'up' ? ' filter__menu_up' : ''}`}
              onFocus={() => {
                focusInMenuRef.current = true;
              }}
            >
              {options.map((o) => (
                <button
                  key={o.value || '__all'}
                  type="button"
                  className={`filter__option${o.on ? ' filter__option_on' : ''}`}
                  aria-pressed={o.on}
                  onClick={() => onPick(o.value)}
                >
                  <span className="filter__option-left">
                    <span className="filter__mark">
                      {o.on ? <Icon name="check" size={14} /> : null}
                    </span>
                    <span>{o.label}</span>
                  </span>
                  <span className="filter__count">{o.count}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default FilterDropdown;
