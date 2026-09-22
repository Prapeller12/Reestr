import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

// Лёгкое автодополнение (§3): поле ввода + выпадающий список совпадений из справочника участников.
// Список рендерится в нормальном потоке (не absolute) — не клипается overflow:hidden таблицы полей.
// Без внешних либ (офлайн). Фильтр — по подстроке, регистронезависимо; точное совпадение не предлагаем.
// Поле — textarea, растущая по содержимому: ФИО с должностью в скобках в одну строку не помещается,
// а пользователь должен видеть значение целиком. Перевод строки в значении не нужен — Enter сохраняет.
function AutocompleteInput({ value, onChange, suggestions, placeholder, autoFocus, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Высота по содержимому: сбрасываем и берём scrollHeight (границы задаёт CSS через max-height).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions
      .filter((s) => {
        const sl = s.toLowerCase();
        return q === '' ? true : sl.includes(q) && sl !== q;
      })
      .slice(0, 8);
  }, [suggestions, value]);

  return (
    <div className="autocomplete">
      <textarea
        ref={ref}
        className="autocomplete__input"
        rows={1}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          // Значение всегда однострочное: вставленные переводы строк схлопываем в пробел.
          onChange(e.target.value.replace(/\s*\n+\s*/g, ' '));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); // перенос строки не нужен — Enter сохраняет
            if (onSubmit) onSubmit();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && matches.length > 0 ? (
        <div className="autocomplete__list">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              className="autocomplete__option"
              // onMouseDown (не onClick), чтобы сработать до blur инпута.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default AutocompleteInput;
