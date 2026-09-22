import { useEffect, useState } from 'react';
import { clearFieldOverride, getFieldSuggestions, setFieldOverride } from '../../api/commands';
import { toApiError } from '../../api/errors';
import type { FieldOverrideName, PartyRole } from '../../api/types';
import AutocompleteInput from './AutocompleteInput';

interface Props {
  regNumber: string;
  field: FieldOverrideName; // 'signer' | 'addressees'
  role: PartyRole; // 'signer' | 'addressee' (маппинг: addressees → addressee)
  value: string; // эффективное значение (правка > факт)
  edited: boolean; // есть FIELD_OVERRIDE — метка «изменено вручную»
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChanged: () => void;
}

// Инлайн-правка поля исходящего (Подписант/Адресаты, §3). Просмотр: бейдж «изменено вручную» и
// «Вернуть значение из выгрузки»; правка: автодополнение из справочника и «Сохранить».
// Оверлей «правка > факт» переживает переимпорт (КОНЦЕПЦИЯ-правка-полей §5a); пустое значение
// при сохранении = очистка поля (легитимная правка, не реверт).
function EditableField({
  regNumber,
  field,
  role,
  value,
  edited,
  editing,
  onStartEdit,
  onStopEdit,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // При входе в режим правки: подставляем текущее значение и грузим справочник по роли.
  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    setError(null);
    let cancelled = false;
    getFieldSuggestions(role)
      .then((rows) => {
        if (!cancelled) setSuggestions(rows);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
    // Значение фиксируем на момент входа в режим — намеренно не в deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, role]);

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setFieldOverride(regNumber, field, draft);
      onStopEdit();
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const revert = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearFieldOverride(regNumber, field);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // Компонент отдаёт ДВЕ ячейки строки таблицы полей: значение и действие. Кнопка живёт
  // в своей колонке, поэтому её место не зависит от длины значения (решение пользователя).
  if (!editing) {
    return (
      <>
        <div className="doc-fields__value">
          <div className="field-edit">
            <span className="field-edit__text">{value ? value : '—'}</span>
            {edited ? (
              <div className="field-edit__note">
                <span>Изменено вручную</span>
                <button
                  type="button"
                  className="field-edit__link"
                  onClick={() => void revert()}
                  disabled={busy}
                >
                  Вернуть значение из выгрузки
                </button>
              </div>
            ) : null}
            {error ? <div className="field-edit__error">{error}</div> : null}
          </div>
        </div>
        <div className="doc-fields__action">
          <button type="button" className="field-edit__btn" onClick={onStartEdit}>
            Изменить
          </button>
        </div>
      </>
    );
  }

  // Правка: значение остаётся на месте, поле ввода — отдельной строкой во всю ширину
  // таблицы (в колонке значения ему тесно), «Отмена» — там же, где была «Изменить».
  return (
    <>
      <div className="doc-fields__value">
        <div className="field-edit">
          <span className="field-edit__text">{value ? value : '—'}</span>
        </div>
      </div>
      <div className="doc-fields__action">
        <button
          type="button"
          className="field-edit__btn"
          onClick={onStopEdit}
          disabled={busy}
        >
          Отмена
        </button>
      </div>
      <div className="doc-fields__expand">
        <div className="field-edit">
          <AutocompleteInput
            value={draft}
            onChange={setDraft}
            suggestions={suggestions}
            placeholder="Введите значение или выберите из справочника"
            autoFocus
            onSubmit={() => void save()}
          />
          <div className="field-edit__actions">
            <button
              type="button"
              className="field-edit__btn field-edit__btn_primary"
              onClick={() => void save()}
              disabled={busy}
            >
              Сохранить
            </button>
          </div>
          {error ? <div className="field-edit__error">{error}</div> : null}
        </div>
      </div>
    </>
  );
}

export default EditableField;
