// Собственный набор иконок Реестра: линейные (обводка 2, скруглённые концы), inline-SVG без CDN
// (принцип 1: офлайн). Мелкие значки нарисованы на сетке 16, крупные — на сетке 24.
// stroke = currentColor: цвет иконки задаёт цвет текста родителя (белая галка на чекбоксе и т.п.).

type Glyph = {
  viewBox: string;
  /** Контуры обводки; точка — нулевой отрезок с круглым концом. */
  d: string[];
};

const GLYPHS = {
  // ── сетка 16 ──
  clear: { viewBox: '0 0 16 16', d: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'] },
  check: { viewBox: '0 0 16 16', d: ['M3.5 8.5l3 3 6-7'] },
  minus: { viewBox: '0 0 16 16', d: ['M4 8h8'] },
  equal: { viewBox: '0 0 16 16', d: ['M4 6h8', 'M4 10h8'] },
  exclamation: { viewBox: '0 0 16 16', d: ['M8 3.5V9', 'M8 12.5v0'] },
  'chevron-down': { viewBox: '0 0 16 16', d: ['M4 6l4 4 4-4'] },
  'chevron-right': { viewBox: '0 0 16 16', d: ['M6 4l4 4-4 4'] },
  // ── сетка 24 ──
  close: { viewBox: '0 0 24 24', d: ['M6 6l12 12', 'M18 6L6 18'] },
  'arrow-left': { viewBox: '0 0 24 24', d: ['M14.5 6l-6 6 6 6'] },
  'arrow-right': { viewBox: '0 0 24 24', d: ['M9.5 6l6 6-6 6'] },
  search: { viewBox: '0 0 24 24', d: ['M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0z', 'M15 15l5 5'] },
  print: {
    viewBox: '0 0 24 24',
    d: [
      'M7 9V4h10v5',
      'M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2',
      'M7 14h10v6H7z',
    ],
  },
  // «Настроить» — ползунки, а не шестерёнка.
  settings: {
    viewBox: '0 0 24 24',
    d: [
      'M4 7h9',
      'M19 7h1',
      'M4 17h1',
      'M11 17h9',
      'M18 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
      'M10 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    ],
  },
  // «Удалить» — корзина (QA-3 п.9).
  trash: {
    viewBox: '0 0 24 24',
    d: [
      'M4 7h16',
      'M9.5 7V4.5h5V7',
      'M6.5 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7',
      'M10 11v6',
      'M14 11v6',
    ],
  },
  list: { viewBox: '0 0 24 24', d: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6v0', 'M4.5 12v0', 'M4.5 18v0'] },
  // «Связи» — граф из трёх узлов.
  link: {
    viewBox: '0 0 24 24',
    d: [
      'M8.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
      'M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
      'M20.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
      'M8.2 10.9l7.6-3.8',
      'M8.2 13.1l7.6 3.8',
    ],
  },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

interface Props {
  name: IconName;
  /** Сторона в px; по умолчанию — родной размер сетки иконки (16 или 24). */
  size?: number;
  /** БЭМ-микс места использования, например «btn__ico». */
  className?: string;
}

function Icon({ name, size, className }: Props) {
  const glyph: Glyph = GLYPHS[name];
  const side = size ?? Number(glyph.viewBox.split(' ')[3]);
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={side}
      height={side}
      viewBox={glyph.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph.d.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default Icon;
