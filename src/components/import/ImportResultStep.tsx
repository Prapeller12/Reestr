import type { DocKind, DocumentView, ImportDiffRow, ImportPreview } from '../../api/types';
import { diffFieldLabel, diffFieldValue, docKey } from '../../lib/format';
import Icon from '../common/Icon';

export type ImportTab = 'all' | 'new' | 'same' | 'changed';

interface Props {
  preview: ImportPreview;
  byReg: Map<string, DocumentView>;
  kind: DocKind;
  tab: ImportTab;
  onTab: (tab: ImportTab) => void;
  limit: number;
  onMore: () => void;
}

// Баннеры — результат СВЕРКИ: на этом шаге импорт ещё не применён (решение пользователя 2026-09-20, п.11).
const BANNERS = {
  new: {
    title: 'Сверка выполнена: все записи новые',
    text: 'Совпадений с реестром нет. Записи можно добавить.',
    glyph: 'check' as const,
  },
  same: {
    title: 'Сверка выполнена: новых записей нет',
    text: 'Все записи уже есть в реестре без изменений.',
    glyph: 'equal' as const,
  },
  changed: {
    title: 'Сверка выполнена: найдены изменения',
    text: 'Часть записей отличается от реестра. Требуется обновление.',
    glyph: 'exclamation' as const,
  },
};

/** Вариант баннера по реальным счётчикам: изменения важнее новых, новые важнее совпадений. */
export function bannerKindOf(counts: ImportPreview['counts']): 'new' | 'same' | 'changed' {
  if (counts.changed > 0) return 'changed';
  if (counts.new > 0) return 'new';
  return 'same';
}

const TAG = {
  new: { label: 'Новая запись', mod: 'new' },
  same: { label: 'Уже в реестре', mod: 'same' },
  changed: { label: 'Изменена', mod: 'changed' },
};

function ImportResultStep({ preview, byReg, kind, tab, onTab, limit, onMore }: Props) {
  const { counts, rows } = preview;
  const total = counts.new + counts.same + counts.changed;
  const banner = BANNERS[bannerKindOf(counts)];
  const bannerMod = bannerKindOf(counts);

  const allTabs: { key: ImportTab; label: string; count: number }[] = [
    { key: 'all', label: 'Все', count: rows.length },
    { key: 'new', label: 'Новые', count: counts.new },
    { key: 'same', label: 'Уже в реестре', count: counts.same },
    { key: 'changed', label: 'Изменённые', count: counts.changed },
  ];
  // При наличии изменений таб «Все» скрыт — как в прототипе для сценария changed.
  const tabs = allTabs.filter((t) => !(counts.changed > 0 && t.key === 'all'));

  const visible: ImportDiffRow[] = tab === 'all' ? rows : rows.filter((r) => r.kind === tab);
  const shown = visible.slice(0, limit);
  const rest = visible.length - shown.length;

  const stats: { label: string; value: number; mod: string }[] = [
    { label: 'Строк в файле', value: total, mod: '' },
    { label: 'Новых', value: counts.new, mod: 'new' },
    { label: 'Уже в реестре', value: counts.same, mod: 'same' },
    { label: 'Изменённых', value: counts.changed, mod: 'changed' },
  ];

  return (
    <div className="import-result">
      <div className={`import-result__banner import-result__banner_${bannerMod}`}>
        <div className="import-result__glyph">
          <Icon name={banner.glyph} />
        </div>
        <div className="import-result__banner-text">
          <div className="import-result__banner-title">{banner.title}</div>
          <div className="import-result__banner-sub">{banner.text}</div>
        </div>
      </div>

      <div className="import-result__stats">
        {stats.map((s) => (
          <div key={s.label} className="import-result__stat">
            <div className="import-result__stat-label">{s.label}</div>
            <div
              className={`import-result__stat-value${
                s.mod ? ` import-result__stat-value_${s.mod}` : ''
              }`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="import-result__tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pill pill_md${tab === t.key ? ' pill_active' : ''}`}
            onClick={() => onTab(t.key)}
          >
            <span>{t.label}</span>
            <span className="pill__hint">{t.count}</span>
          </button>
        ))}
        <div className="page__spacer" />
        <div className="import-result__rows-label">
          Показано {shown.length} из {visible.length} строк
        </div>
      </div>

      <div className="import-result__table">
        <div className="import-result__head">
          <div className="import-result__th">Рег. номер</div>
          <div className="import-result__th">Заголовок и изменения</div>
          <div className="import-result__th">Подписант</div>
          <div className="import-result__th">Результат</div>
        </div>
        <div className="import-result__list">
          {shown.map((r) => {
            const known = byReg.get(docKey(kind, r.regNumber));
            const tag = TAG[r.kind];
            return (
              <div
                key={r.regNumber}
                className={`import-result__row import-result__row_${r.kind}`}
              >
                <div className="import-result__reg">{r.regNumber}</div>
                <div className="import-result__cell">
                  <div className="import-result__topic">{known ? known.topic : '—'}</div>
                  {r.diff && r.diff.length ? (
                    <div className="import-result__diffs">
                      {r.diff.map((d) => (
                        <div key={d.field} className="import-result__diff">
                          <span className="import-result__diff-field">
                            {diffFieldLabel(d.field)}
                          </span>
                          <span className="import-result__diff-was">
                            {diffFieldValue(d.field, d.old)}
                          </span>
                          <span className="import-result__diff-arrow">→</span>
                          <span className="import-result__diff-now">
                            {diffFieldValue(d.field, d.new)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="import-result__signer">{known ? known.signer : '—'}</div>
                <div>
                  <span className={`import-result__tag import-result__tag_${tag.mod}`}>
                    {tag.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {rest > 0 ? (
          <button type="button" className="import-result__more" onClick={onMore}>
            Показать ещё {Math.min(25, rest)} из {rest}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ImportResultStep;
