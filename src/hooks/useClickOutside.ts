import { useEffect } from 'react';

// Пока `active`, закрывает попап по клику вне элементов, подходящих под `selector`,
// и по Escape (п.5). Клик по другому элементу того же селектора (напр. соседний фильтр)
// не закрывает — его собственный onClick переключит состояние.
// `selector` может быть списком: портальные поповеры (в DOM вне своего блока) добавляют
// туда свой класс — напр. '.filter, .filter__menu'. Селектор глобальный: одновременно открыт
// один такой попап; понадобится изоляция — перейти на containment по ref (кнопка + меню).
// Escape слушается на window в фазе capture и дальше не идёт (stopPropagation): открытый
// попап — верхний слой и поглощает Escape, обработчики модалки под ним его не получат.
// `wheelIgnore` (QA-3 п.5, окно тем): если задан — прокрутка колесом где угодно, кроме элементов
// под этим селектором (само меню), тоже закрывает попап. Именно `wheel`, а не `scroll`: `scroll`
// приходит и при зажатии scrollTop, когда список после выбора пункта укорачивается, — меню
// закрывалось бы после каждого клика. Перетаскивание полосы прокрутки закрывает `mousedown`.
export function useDismissOnOutside(
  active: boolean,
  selector: string,
  onDismiss: () => void,
  wheelIgnore: string | null = null,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target || !target.closest(selector)) onDismiss();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss();
    };
    const onWheel = (e: WheelEvent): void => {
      if (wheelIgnore === null) return;
      if (e.target instanceof Element && e.target.closest(wheelIgnore)) return;
      onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, { capture: true });
    if (wheelIgnore !== null) {
      window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, { capture: true });
      // Снимать с тем же capture — иначе слушатель не снимется.
      if (wheelIgnore !== null) window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [active, selector, onDismiss, wheelIgnore]);
}
