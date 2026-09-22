// Позиционирование плавающего элемента (выпадающее меню, поповер), отрендеренного порталом в
// document.body с position:fixed, относительно кнопки-якоря (QA-3 п.10).
//
// Координаты — данные геометрии, не оформление: хук пишет их в CSS custom properties
// плавающего элемента (el.style.setProperty), оформление и их применение — в CSS блока:
//   --float-left   левый край (прижат к окну с полем margin);
//   --float-top    верх при открытии вниз  (низ кнопки + gap);
//   --float-bottom низ при открытии вверх  (от низа окна до верха кнопки + gap);
//   --float-max-h  свободное место в выбранную сторону — список внутри скроллится.
// Так в JSX нет style={{}}, а при скролле нет ре-рендеров React (прецедент — useScrollLock).
// ВАЖНО: на плавающий элемент никогда не вешать style-проп в JSX — React начнёт управлять
// атрибутом style и затрёт --float-*.
//
// Направление: вниз, если снизу есть minHeight; иначе вверх, если сверху места больше.
// Возвращается как state — для модификатора «вверх» в className.
import { useEffect, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export type FloatingPlacement = 'down' | 'up';

export interface FloatingOptions {
  /** Зазор между кнопкой и меню, px. */
  gap?: number;
  /** Минимальное поле до краёв окна, px. */
  margin?: number;
  /** Минимум места снизу, чтобы открыть вниз, px. */
  minHeight?: number;
}

// Считает и записывает геометрию; возвращает направление. React-состояние не читает.
function place(
  anchor: HTMLElement,
  floating: HTMLElement,
  gap: number,
  margin: number,
  minHeight: number,
): FloatingPlacement {
  const root = document.documentElement;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const r = anchor.getBoundingClientRect();
  const below = vh - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  const up = below < minHeight && above > below;
  const maxH = Math.max(0, Math.floor(up ? above : below));
  const w = floating.offsetWidth;
  // Приоритет у левого поля, если меню шире окна без полей.
  const left = Math.max(margin, Math.min(r.left, vw - margin - w));
  const { style } = floating;
  style.setProperty('--float-left', `${Math.round(left)}px`);
  style.setProperty('--float-top', `${Math.round(r.bottom + gap)}px`);
  style.setProperty('--float-bottom', `${Math.round(vh - r.top + gap)}px`);
  style.setProperty('--float-max-h', `${maxH}px`);
  return up ? 'up' : 'down';
}

export function useFloatingPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement>,
  floatingRef: RefObject<HTMLElement>,
  options: FloatingOptions = {},
): FloatingPlacement {
  const { gap = 8, margin = 8, minHeight = 240 } = options;
  const [placement, setPlacement] = useState<FloatingPlacement>('down');

  // Пересчёт до отрисовки — при открытии и после КАЖДОГО ре-рендера (эффект без deps): выбор
  // пункта меняет ширину меню и может сдвинуть кнопку («Сбросить», перенос строки фильтров).
  // Покрывает сдвиг кнопки, пока компонент не мемоизирован; при React.memo добавить
  // ResizeObserver на контейнер фильтров. Только считает — ни на что не подписывается.
  // setPlacement безусловный: одинаковое значение React отбрасывает, зацикливания нет.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!open || !anchor || !floating) return;
    setPlacement(place(anchor, floating, gap, margin, minHeight));
  });

  // Подписка на скролл (любого контейнера — capture на window, в т.ч. оверлей модалки) и ресайз.
  // Обработчики создаются внутри эффекта; state в них не читается (нет устаревших замыканий).
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onFrame = (): void => {
      frame = 0;
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      setPlacement(place(anchor, floating, gap, margin, minHeight));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(onFrame);
    };
    const onScroll = (e: Event): void => {
      // Собственный скролл списка кнопку не двигает.
      if (e.target === floatingRef.current) return;
      schedule();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      // Снимать с тем же capture — иначе слушатель не снимется и утечёт.
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [open, gap, margin, minHeight, anchorRef, floatingRef]);

  return placement;
}

export default useFloatingPosition;
