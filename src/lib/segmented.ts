// Клавиатура сегментного переключателя (WAI-ARIA Radio Group): стрелки — соседний пункт по кругу,
// Home/End — первый/последний. Возвращает новое значение или null, если клавиша не обрабатывается.
export function stepValue<T>(values: readonly T[], current: T, key: string): T | null {
  const n = values.length;
  if (n === 0) return null;
  const idx = values.indexOf(current);
  let next: number;
  if (key === 'ArrowRight' || key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % n;
  else if (key === 'ArrowLeft' || key === 'ArrowUp') next = idx < 0 ? 0 : (idx - 1 + n) % n;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = n - 1;
  else return null;
  return values[next] ?? null;
}
