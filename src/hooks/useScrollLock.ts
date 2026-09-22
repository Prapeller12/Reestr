// Блокировка прокрутки фона, пока открыт любой попап (модалка/карточка).
// Ставит класс на <body> — саму блокировку делает CSS (page.css: body.is-scroll-locked).
// Ширину скроллбара кладём в CSS-переменную, чтобы фон не «прыгал» при исчезновении полосы.
// Счётчик ссылок: класс снимается только когда закрыт последний попап (на случай наложения).
import { useEffect } from 'react';

let lockCount = 0;

export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    const { body, documentElement: root } = document;
    if (lockCount === 0) {
      const scrollbar = window.innerWidth - root.clientWidth;
      root.style.setProperty('--scrollbar-lock', `${scrollbar}px`);
      body.classList.add('is-scroll-locked');
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        body.classList.remove('is-scroll-locked');
        root.style.removeProperty('--scrollbar-lock');
      }
    };
  }, [active]);
}

export default useScrollLock;
