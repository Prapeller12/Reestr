import { useEffect, useId, useRef, useState } from 'react';
import type { ThemeDto } from '../../api/types';
import { deleteThemeConfirm, lettersInThemeTitle } from '../../lib/texts';
import Icon from '../common/Icon';

interface Props {
  themes: ThemeDto[];
  selCount: number;
  canClear: boolean;
  newName: string;
  onNewName: (value: string) => void;
  onAssign: (name: string) => void;
  onClear: () => void;
  onCreate: () => void;
  /** Удалить тему; true — успех (ошибка уже показана в строке ошибки). */
  onDelete: (name: string) => Promise<boolean>;
  /** Идёт действие с темами — кнопки подтверждения неактивны. */
  busy: boolean;
  error: string | null;
}

// Правая панель окна тем: перенос выбранных писем в тему, перенос в «Без темы», удаление темы
// (корзина на плашке, подтверждение прямо в плашке, QA-3 п.9), создание новой темы.
function ThemesSidePanel({
  themes,
  selCount,
  canClear,
  newName,
  onNewName,
  onAssign,
  onClear,
  onCreate,
  onDelete,
  busy,
  error,
}: Props) {
  // Одно поле — в режиме подтверждения ровно одна плашка. Активное подтверждение вычисляется
  // из списка тем: тема исчезла после перезагрузки — режима (и Escape-слушателя) больше нет.
  const [confirming, setConfirming] = useState<string | null>(null);
  const active = confirming !== null && themes.some((t) => t.name === confirming) ? confirming : null;

  const trashRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelRef = useRef<HTMLButtonElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<string | null>(null);
  const confirmId = useId();

  // Фокус — после коммита: в режиме подтверждения корзина размонтирована.
  useEffect(() => {
    if (active !== null) {
      cancelRef.current?.focus();
      return;
    }
    const back = returnFocusRef.current;
    if (back !== null) {
      returnFocusRef.current = null;
      trashRefs.current.get(back)?.focus();
    }
  }, [active]);

  // Escape отменяет подтверждение. Слушатель на document (bubble): открытое меню фильтра ловит
  // Escape раньше (window, capture + stopPropagation) — первый Escape закрывает меню, второй —
  // подтверждение. Если модалке добавят свой Escape на document, подтверждение должно стоять раньше.
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      returnFocusRef.current = active;
      setConfirming(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  const cancel = (name: string): void => {
    returnFocusRef.current = name;
    setConfirming(null);
  };

  const confirmDelete = async (name: string): Promise<void> => {
    const ok = await onDelete(name);
    if (ok) {
      // Выйти из режима сразу, не дожидаясь перезагрузки: иначе плашка висит в подтверждении с
      // активными кнопками, а новая тема с тем же именем открылась бы сразу в «Удалить тему?».
      // Цели для возврата фокуса нет — тема исчезнет; фокус в поле «Новая тема».
      setConfirming(null);
      newNameRef.current?.focus();
    } else {
      cancel(name);
    }
  };

  return (
    <div className="card themes-side">
      <div className="themes-side__head">Темы</div>

      {/* Цепочка высоты: .themes-side (max-height 100%) → __section_list → __list (скролл). */}
      <div className="themes-side__section themes-side__section_bordered themes-side__section_list">
        <div className="themes-side__label">Перенести выбранные письма в тему</div>
        <div className="themes-side__list">
          {themes.map((t) => {
            if (t.name === active) {
              const text = deleteThemeConfirm(t.name, t.documentCount);
              return (
                <div key={t.name} className="themes-side__theme themes-side__theme_confirm">
                  <div
                    className="themes-side__confirm"
                    role="group"
                    aria-labelledby={`${confirmId}-q`}
                    aria-describedby={`${confirmId}-d`}
                  >
                    <div className="themes-side__confirm-text">
                      <span id={`${confirmId}-q`} className="themes-side__confirm-question">
                        {text.question}
                      </span>
                      <span id={`${confirmId}-d`} className="themes-side__confirm-detail">
                        {text.detail}
                      </span>
                    </div>
                    <div className="themes-side__confirm-actions">
                      <button
                        type="button"
                        className="btn btn_danger"
                        disabled={busy}
                        onClick={() => void confirmDelete(t.name)}
                      >
                        Удалить
                      </button>
                      <button
                        ref={cancelRef}
                        type="button"
                        className="btn btn_secondary"
                        disabled={busy}
                        onClick={() => cancel(t.name)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={t.name}
                className={`themes-side__theme${selCount ? '' : ' themes-side__theme_idle'}`}
              >
                <button
                  type="button"
                  className="themes-side__assign"
                  title={t.name}
                  aria-disabled={selCount ? undefined : true}
                  onClick={() => onAssign(t.name)}
                >
                  <span className="themes-side__theme-name">{t.name}</span>
                  <span
                    className="themes-side__theme-count"
                    title={lettersInThemeTitle(t.documentCount)}
                  >
                    {t.documentCount}
                  </span>
                </button>
                <button
                  ref={(el) => {
                    if (el) trashRefs.current.set(t.name, el);
                    else trashRefs.current.delete(t.name);
                  }}
                  type="button"
                  className="themes-side__delete"
                  title="Удалить тему"
                  aria-label={`Удалить тему «${t.name}»`}
                  disabled={busy}
                  onClick={() => setConfirming(t.name)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            );
          })}
        </div>
        {canClear ? (
          <button type="button" className="themes-side__clear" onClick={onClear}>
            Перенести выбранные письма в «Без темы»
          </button>
        ) : null}
      </div>

      <div className="themes-side__section themes-side__section_new">
        <div className="themes-side__label">Новая тема</div>
        <div className="themes-side__new">
          <input
            ref={newNameRef}
            className="themes-side__input"
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            placeholder="Название темы"
          />
          <button
            type="button"
            className={`btn btn_lg ${newName.trim() ? 'btn_primary' : 'btn_off'}`}
            onClick={onCreate}
          >
            Создать тему
          </button>
        </div>
        {error ? <div className="themes-side__error">{error}</div> : null}
        <div className="themes-side__note">Отмеченные письма будут перенесены в новую тему.</div>
      </div>
    </div>
  );
}

export default ThemesSidePanel;
