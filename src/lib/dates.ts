// Датовая арифметика на целых «эпоха-днях» (алгоритм days-from-civil, Howard Hinnant).
// Объект Date не используется: «сегодня» фронт восстанавливает из фактов backend
// (todayEpoch = epochDay(dueDate) − daysRemaining), системные часы не читает (frontend.md §6).

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** (y, m, d) → количество дней от эпохи 1970-01-01 (может быть отрицательным). */
export function ymdToEpochDay(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Обратное преобразование: эпоха-день → календарная дата. */
export function epochDayToYmd(day: number): Ymd {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** ISO 'YYYY-MM-DD' → эпоха-день; null, если строка не разбирается. */
export function isoToEpochDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return ymdToEpochDay(y, mo, d);
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** ISO 'YYYY-MM-DD' → 'ДД.ММ.ГГГГ' (как fmt() прототипа); пусто/непарсябельно → '—'. */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Эпоха-день → 'ДД.ММ.ГГГГ'. */
export function formatEpochDay(day: number): string {
  const { y, m, d } = epochDayToYmd(day);
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

/** Эпоха-день → ISO 'YYYY-MM-DD' (формат для backend set_deadline / set_field_override). */
export function epochDayToIso(day: number): string {
  const { y, m, d } = epochDayToYmd(day);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Русская плюрализация: plural(3, 'запись', 'записи', 'записей') → 'записи'. */
export function plural(n: number, one: string, few: string, many: string): string {
  return n % 10 === 1 && n % 100 !== 11
    ? one
    : [2, 3, 4].indexOf(n % 10) >= 0 && !(n % 100 >= 12 && n % 100 <= 14)
      ? few
      : many;
}
