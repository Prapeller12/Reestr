import type { DocKind } from '../../api/types';

interface Props {
  kind: DocKind;
  onKind: (kind: DocKind) => void;
  busy: boolean;
  error: string | null;
  onPick: () => void;
}

// Шаг загрузки: сначала ТИП выгрузки (Исходящие или Входящие), затем выбор файла.
// Тип определяет, как backend парсит .txt и куда кладёт записи (§5.3). Подписи «N колонок» —
// справочная подсказка о составе колонок (§2.1/§2.2), оставлена как в макете §6.1.
function ImportUploadStep({ kind, onKind, busy, error, onPick }: Props) {
  const fileHint = kind === 'incoming' ? 'Список вхд..txt' : 'Список исх..txt';
  return (
    <div className="import-upload">
      <div className="import-upload__step-label">Шаг 1. Тип выгрузки</div>
      <div className="import-upload__seg">
        <button
          type="button"
          className={`import-upload__seg-option${
            kind === 'outgoing' ? ' import-upload__seg-option_on' : ''
          }`}
          onClick={() => onKind('outgoing')}
          disabled={busy}
        >
          Исходящие, 9 колонок
        </button>
        <button
          type="button"
          className={`import-upload__seg-option${
            kind === 'incoming' ? ' import-upload__seg-option_on' : ''
          }`}
          onClick={() => onKind('incoming')}
          disabled={busy}
        >
          Входящие, 8 колонок
        </button>
      </div>

      <div className="import-upload__step-label">Шаг 2. Файл</div>
      <div className="import-upload__zone">
        <div className="import-upload__file">{fileHint}</div>
        <div className="import-upload__text">Выберите файл выгрузки</div>
        <div className="import-upload__hint">Состав полей задаётся в 1С</div>
        <button
          type="button"
          className={`btn btn_lg import-upload__action ${busy ? 'btn_off' : 'btn_primary'}`}
          onClick={onPick}
          disabled={busy}
        >
          {busy ? 'Чтение файла…' : 'Загрузить файл'}
        </button>
      </div>
      {error ? <div className="import-upload__error">{error}</div> : null}
    </div>
  );
}

export default ImportUploadStep;
