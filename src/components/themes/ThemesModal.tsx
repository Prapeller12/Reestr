import { useMemo, useRef, useState } from 'react';
import { bulkAssignThemes, bulkClearThemes, createTheme, deleteTheme } from '../../api/commands';
import { isApiError, toApiError } from '../../api/errors';
import type { DocKind, DocRef, DocumentView, ThemeDto } from '../../api/types';
import { docKey } from '../../lib/format';
import { pruneSelection, toggleAllVisible } from '../../lib/docFilters';
import type { DocFilterState } from '../../lib/docFilters';
import { useDocFilters } from '../../hooks/useDocFilters';
import { useScrollLock } from '../../hooks/useScrollLock';
import ThemesDocsPanel from './ThemesDocsPanel';
import ThemesSidePanel from './ThemesSidePanel';
import Icon from '../common/Icon';

interface Props {
  docs: DocumentView[];
  themes: ThemeDto[];
  // Стартовое состояние (QA-3 п.5): КОПИЯ фильтров реестра (с шестерёнки «Без темы» — с Темой =
  // «Без темы») и предвыбор — строки группы реестра, с шестерёнки которой открыли окно.
  initialFilters: DocFilterState;
  preselect: Record<string, boolean>;
  onClose: () => void;
  onChanged: () => void;
  /** Тема удалена — реестр снимает её из своего фильтра «Тема» (QA-3 п.9). Обязателен. */
  onThemeDeleted: (name: string) => void;
}

// Модалка «Распределение писем по темам».
function ThemesModal({
  docs,
  themes,
  initialFilters,
  preselect,
  onClose,
  onChanged,
  onThemeDeleted,
}: Props) {
  useScrollLock();
  // Свой фильтр окна: независим от реестра. Окно фиксированной высоты (QA-3 п.6), кнопки фильтров
  // не двигаются — меню колесом не закрывается (решение пользователя F4), только клик вне и Escape.
  const f = useDocFilters(docs, { initial: initialFilters });
  const visible = useMemo(() => docs.filter(f.matches), [docs, f.matches]);

  // Ключ выбора — пара (вид, рег.номер): исх. и вх. могут делить один рег.номер (§5.6).
  const [selected, setSelected] = useState<Record<string, boolean>>(() => ({ ...preselect }));
  // Выбор ⊆ видимого: при смене поиска/фильтров/вида или перезагрузке docs отметки со скрытых
  // строк снимаются. Подрезка во время рендера (паттерн «состояние от предыдущего рендера»):
  // без кадра, где «выбрано» больше видимого. pruneSelection без изменений отдаёт тот же объект.
  const [prunedFor, setPrunedFor] = useState(visible);
  if (prunedFor !== visible) {
    setPrunedFor(visible);
    setSelected((prev) => pruneSelection(prev, visible));
  }

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Первый клик по затемнению при открытом меню закрывает только меню (как нативный select).
  const menuOpenOnDownRef = useRef(false);

  // Выбранные документы как DocRef[] (каноническая форма bulk-команд). Страховка: только видимые.
  const selectedItems = useMemo<DocRef[]>(
    () =>
      visible
        .filter((d) => selected[docKey(d.kind, d.regNumber)])
        .map((d): DocRef => ({ kind: d.kind, regNumber: d.regNumber })),
    [visible, selected],
  );
  const selCount = selectedItems.length;
  const canClear = visible.some((d) => selected[docKey(d.kind, d.regNumber)] && d.theme);

  const toggleKey = (kind: DocKind, regNumber: string): void => {
    const key = docKey(kind, regNumber);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  // Действие с темами: после успеха выбор очищается (в т.ч. стартовый предвыбор) и данные
  // перезагружаются. Возвращает успех; ошибка — в строке ошибки правой панели.
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      setSelected({});
      onChanged();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Удаление темы (QA-3 п.9): её письма → «Без темы». NOT_FOUND — тему уже удалили (другое окно,
  // повтор): цель достигнута, как успех с перезагрузкой. Фильтры снимаются только после успеха.
  const handleDelete = (name: string): Promise<boolean> =>
    run(async () => {
      try {
        await deleteTheme(name);
      } catch (e) {
        if (!isApiError(e) || e.code !== 'NOT_FOUND') throw e;
      }
      f.dropValue('theme', name);
      onThemeDeleted(name);
    });

  const handleCreate = (): void => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      try {
        await createTheme(name);
      } catch (e) {
        // Существующее имя — не ошибка: прототип просто назначает такую тему выбранным.
        if (!isApiError(e) || e.code !== 'DUPLICATE_THEME') throw e;
      }
      if (selectedItems.length) await bulkAssignThemes(selectedItems, name);
      setNewName('');
    });
  };

  return (
    <div
      className="modal__overlay modal__overlay_themes print-hide"
      onMouseDown={() => {
        menuOpenOnDownRef.current = f.openMenu !== null;
      }}
      onClick={() => {
        if (menuOpenOnDownRef.current) {
          menuOpenOnDownRef.current = false;
          return;
        }
        onClose();
      }}
    >
      <div className="modal modal_themes" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header modal__header_themes">
          <div className="modal__heading">
            <div className="modal__title">Распределение писем по темам</div>
          </div>
          <button type="button" className="btn btn_icon" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="modal__body_themes">
          <ThemesDocsPanel
            docs={visible}
            totalCount={docs.length}
            docFilters={f}
            selected={selected}
            selCount={selCount}
            onToggle={toggleKey}
            onToggleAll={() => setSelected((prev) => toggleAllVisible(prev, visible))}
          />
          <ThemesSidePanel
            themes={themes}
            selCount={selCount}
            canClear={canClear}
            newName={newName}
            onNewName={setNewName}
            onAssign={(name) => {
              if (selectedItems.length) void run(() => bulkAssignThemes(selectedItems, name));
            }}
            onClear={() => {
              if (selectedItems.length) void run(() => bulkClearThemes(selectedItems));
            }}
            onCreate={handleCreate}
            onDelete={handleDelete}
            busy={busy}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}

export default ThemesModal;
