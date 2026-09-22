import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { plural } from '../../lib/dates';
import { importApply, importPreview } from '../../api/commands';
import { toApiError } from '../../api/errors';
import type { DocKind, DocumentView, ImportPreview } from '../../api/types';
import { useScrollLock } from '../../hooks/useScrollLock';
import ImportResultStep, { bannerKindOf } from './ImportResultStep';
import type { ImportTab } from './ImportResultStep';
import ImportUploadStep from './ImportUploadStep';
import Icon from '../common/Icon';

interface Props {
  byReg: Map<string, DocumentView>;
  onClose: () => void;
  onApplied: () => void;
}

interface ResultState {
  path: string;
  fileName: string;
  kind: DocKind;
  preview: ImportPreview;
  tab: ImportTab;
  limit: number;
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

// Модалка импорта: выбор ТИПА выгрузки, выбор файла, import_preview(kind), import_apply(kind).
function ImportModal({ byReg, onClose, onApplied }: Props) {
  useScrollLock();
  const [kind, setKind] = useState<DocKind>('outgoing');
  const [result, setResult] = useState<ResultState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = async (): Promise<void> => {
    if (busy) return;
    setError(null);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Выгрузка из 1С', extensions: ['txt'] }],
      });
      if (typeof picked !== 'string') return;
      setBusy(true);
      const preview = await importPreview(picked, kind);
      setResult({
        path: picked,
        fileName: fileNameOf(picked),
        kind,
        preview,
        // При наличии изменений таб «Все» скрыт — открываем «Новые», как в прототипе.
        tab: preview.counts.changed > 0 ? 'new' : 'all',
        limit: 25,
      });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!result || busy) return;
    const bannerKind = bannerKindOf(result.preview.counts);
    if (bannerKind === 'same') {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await importApply(result.path, result.kind);
      onApplied();
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
      setBusy(false);
    }
  };

  const applyLabel = ((): string => {
    if (!result) return '';
    const { counts } = result.preview;
    if (counts.changed > 0) return `Добавить ${counts.new}, обновить ${counts.changed}`;
    if (counts.new > 0) {
      return `Добавить ${counts.new} ${plural(counts.new, 'запись', 'записи', 'записей')}`;
    }
    return 'Закрыть без изменений';
  })();

  const total = result
    ? result.preview.counts.new + result.preview.counts.same + result.preview.counts.changed
    : 0;

  return (
    <div className="modal__overlay modal__overlay_import print-hide" onClick={onClose}>
      <div className="modal modal_import" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header modal__header_import">
          <div className="modal__heading">
            <div className="modal__eyebrow">Импорт из 1С</div>
            <div className="modal__title">
              {result ? 'Результат сверки' : 'Выгрузка из 1С'}
            </div>
          </div>
          <button type="button" className="btn btn_icon" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="modal__body_import">
          {result ? (
            <ImportResultStep
              preview={result.preview}
              byReg={byReg}
              kind={result.kind}
              tab={result.tab}
              onTab={(tab) => setResult((r) => (r ? { ...r, tab, limit: 25 } : r))}
              limit={result.limit}
              onMore={() => setResult((r) => (r ? { ...r, limit: r.limit + 25 } : r))}
            />
          ) : (
            <ImportUploadStep
              kind={kind}
              onKind={setKind}
              busy={busy}
              error={error}
              onPick={() => void pickFile()}
            />
          )}
        </div>

        {result ? (
          <div className="modal__footer">
            <div className="import-result__file">
              {result.fileName} · {total} {plural(total, 'строка', 'строки', 'строк')}
            </div>
            <div className="import-result__actions">
              {error ? <div className="themes-side__error">{error}</div> : null}
              <button
                type="button"
                className="btn btn_secondary"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Другой файл
              </button>
              <button
                type="button"
                className={`btn ${busy ? 'btn_off' : 'btn_primary'}`}
                onClick={() => void apply()}
              >
                {applyLabel}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ImportModal;
