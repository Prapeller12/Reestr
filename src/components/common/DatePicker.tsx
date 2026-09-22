import { useState } from 'react';
import { epochDayToIso, epochDayToYmd, ymdToEpochDay } from '../../lib/dates';
import Icon from './Icon';

interface Props {
  valueEpoch: number | null; // текущий срок (подсветка), может быть в прошлом (просрочка)
  minEpoch: number | null; // нижняя граница (день regDate), раньше выбрать нельзя; null — без границы
  todayEpoch: number; // «сегодня» для маркера
  onPick: (iso: string) => void;
  onReset: () => void;
  onCancel: () => void;
}

type Mode = 'days' | 'months' | 'years';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_FULL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_SHORT = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
];

// Собственный БЭМ-датапикер (§4): дрилл-даун дни → месяцы → годы и обратно, нижняя граница = minEpoch.
// Вся арифметика — на эпоха-днях (lib/dates), без объекта Date и без чтения системных часов.
function DatePicker({ valueEpoch, minEpoch, todayEpoch, onPick, onReset, onCancel }: Props) {
  const minY = minEpoch === null ? null : epochDayToYmd(minEpoch);
  const clampYear = (y: number): number => (minY === null ? y : Math.max(minY.y, y));
  // Старт: месяц срока, если он не раньше границы; иначе месяц границы; нет обоих — «сегодня».
  const startEpoch =
    valueEpoch !== null && (minEpoch === null || valueEpoch >= minEpoch)
      ? valueEpoch
      : minEpoch ?? todayEpoch;
  const init = epochDayToYmd(startEpoch);

  const [mode, setMode] = useState<Mode>('days');
  const [viewY, setViewY] = useState(init.y);
  const [viewM, setViewM] = useState(init.m); // 1..12
  const [yearBase, setYearBase] = useState(() => clampYear(init.y - 5));

  const prevMonth = (): void => {
    if (viewM === 1) {
      setViewM(12);
      setViewY(viewY - 1);
    } else setViewM(viewM - 1);
  };
  const nextMonth = (): void => {
    if (viewM === 12) {
      setViewM(1);
      setViewY(viewY + 1);
    } else setViewM(viewM + 1);
  };

  // Дни месяца и лидирующие пустые ячейки (неделя с понедельника).
  const firstEpoch = ymdToEpochDay(viewY, viewM, 1);
  const nextM = viewM === 12 ? 1 : viewM + 1;
  const nextY = viewM === 12 ? viewY + 1 : viewY;
  const daysInMonth = ymdToEpochDay(nextY, nextM, 1) - firstEpoch;
  const dow = ((firstEpoch % 7) + 4) % 7; // 0=Вс
  const lead = (dow + 6) % 7; // индекс дня 1 при старте недели с понедельника

  const prevMonthDisabled =
    minY !== null && (viewY < minY.y || (viewY === minY.y && viewM <= minY.m));
  const prevYearDisabled = minY !== null && viewY <= minY.y;
  const prevPageDisabled = minY !== null && yearBase <= minY.y;

  const days: number[] = [];
  for (let d = 1; d <= daysInMonth; d += 1) days.push(d);
  const blanks: number[] = [];
  for (let i = 0; i < lead; i += 1) blanks.push(i);
  const years: number[] = [];
  for (let i = 0; i < 12; i += 1) years.push(yearBase + i);

  return (
    <div className="date-picker">
      {mode === 'days' ? (
        <>
          <div className="date-picker__nav">
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={prevMonth}
              disabled={prevMonthDisabled}
              aria-label="Предыдущий месяц"
            >
              <Icon name="arrow-left" />
            </button>
            <button
              type="button"
              className="date-picker__title"
              onClick={() => setMode('months')}
            >
              {MONTHS_FULL[viewM - 1]} {viewY}
            </button>
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={nextMonth}
              aria-label="Следующий месяц"
            >
              <Icon name="arrow-right" />
            </button>
          </div>
          <div className="date-picker__weekdays">
            {WEEKDAYS.map((w) => (
              <div key={w} className="date-picker__weekday">
                {w}
              </div>
            ))}
          </div>
          <div className="date-picker__grid">
            {blanks.map((b) => (
              <span key={`b${b}`} className="date-picker__blank" />
            ))}
            {days.map((d) => {
              const epoch = firstEpoch + (d - 1);
              const disabled = minEpoch !== null && epoch < minEpoch;
              const selected = valueEpoch !== null && epoch === valueEpoch;
              const isToday = epoch === todayEpoch;
              const cls =
                'date-picker__day' +
                (selected ? ' date-picker__day_selected' : '') +
                (isToday && !selected ? ' date-picker__day_today' : '');
              return (
                <button
                  key={d}
                  type="button"
                  className={cls}
                  disabled={disabled}
                  onClick={() => onPick(epochDayToIso(epoch))}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {mode === 'months' ? (
        <>
          <div className="date-picker__nav">
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={() => setViewY(viewY - 1)}
              disabled={prevYearDisabled}
              aria-label="Предыдущий год"
            >
              <Icon name="arrow-left" />
            </button>
            <button
              type="button"
              className="date-picker__title"
              onClick={() => {
                setYearBase(clampYear(viewY - 5));
                setMode('years');
              }}
            >
              {viewY}
            </button>
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={() => setViewY(viewY + 1)}
              aria-label="Следующий год"
            >
              <Icon name="arrow-right" />
            </button>
          </div>
          <div className="date-picker__months">
            {MONTHS_SHORT.map((mName, i) => {
              const m = i + 1;
              const disabled =
                minY !== null && (viewY < minY.y || (viewY === minY.y && m < minY.m));
              return (
                <button
                  key={mName}
                  type="button"
                  className="date-picker__month"
                  disabled={disabled}
                  onClick={() => {
                    setViewM(m);
                    setMode('days');
                  }}
                >
                  {mName}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {mode === 'years' ? (
        <>
          <div className="date-picker__nav">
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={() => setYearBase(clampYear(yearBase - 12))}
              disabled={prevPageDisabled}
              aria-label="Предыдущие годы"
            >
              <Icon name="arrow-left" />
            </button>
            <div className="date-picker__title date-picker__title_static">
              {yearBase}–{yearBase + 11}
            </div>
            <button
              type="button"
              className="date-picker__nav-btn"
              onClick={() => setYearBase(yearBase + 12)}
              aria-label="Следующие годы"
            >
              <Icon name="arrow-right" />
            </button>
          </div>
          <div className="date-picker__years">
            {years.map((y) => {
              const disabled = minY !== null && y < minY.y;
              return (
                <button
                  key={y}
                  type="button"
                  className="date-picker__year"
                  disabled={disabled}
                  onClick={() => {
                    setViewY(y);
                    setMode('months');
                  }}
                >
                  {y}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="date-picker__footer">
        <button type="button" className="date-picker__foot-btn" onClick={onReset}>
          Сбросить срок
        </button>
        <button type="button" className="date-picker__foot-btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default DatePicker;
