import { useEffect, useMemo, useState } from 'react';
import { attachLetter, detachLetter, searchLetters } from '../../api/commands';
import { toApiError } from '../../api/errors';
import type { DocKind, DocStatus, DocumentView, LetterMatch } from '../../api/types';
import { formatIsoDate } from '../../lib/dates';
import { statusLabelOf } from '../../lib/format';
import StatusBadge from '../registry/StatusBadge';
import TypeChip from '../registry/TypeChip';
import Icon from '../common/Icon';

interface Props {
  doc: DocumentView;
  onChanged: () => void;
}

// Результирующий статус ЗАДАЧИ по виду привязываемого письма (§5.5, решение координатора):
// входящее даёт «Выполнено» (done), повторное исходящее — «В доработке» (reworked).
// Это превью до применения; фактический статус пересчитает backend.
function resultingStatus(letterKind: DocKind): DocStatus {
  return letterKind === 'incoming' ? 'done' : 'reworked';
}

// Смена статуса = привязка реального письма из базы (без отдельных кнопок «Выполнено/В доработке»).
// Одна строка поиска (searchLetters) → выпадающие совпадения → «Применить» (attachLetter).
// Здесь же — список уже привязанных писем с «Отвязать» (detachLetter). Только для исходящих.
function TransitionBlock({ doc, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LetterMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<LetterMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();

  // Поиск писем по базе с дебаунсом (порог — 2 символа). Системное время не читается.
  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchLetters(q, 8)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setSearching(false);
          setSearchError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setSearching(false);
          setSearchError(toApiError(e).message);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // Привязать письмо к самому себе нельзя — исключаем саму задачу из кандидатов.
  const pool = useMemo(
    () => results.filter((m) => !(m.regNumber === doc.regNumber && m.kind === doc.kind)),
    [results, doc.regNumber, doc.kind],
  );

  const apply = async (): Promise<void> => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await attachLetter(doc.regNumber, picked.regNumber, picked.kind);
      setPicked(null);
      setQuery('');
      setResults([]);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (letterReg: string, letterKind: DocKind): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await detachLetter(doc.regNumber, letterReg, letterKind);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="transition">
      <div className="transition__label">Привязка письма</div>
      <div className="transition__hint">
        Привязка входящего письма переводит задачу в статус «Выполнено», привязка повторного
        исходящего — в «В доработке». Привязать письмо к самому себе нельзя.
      </div>

      {doc.links.length > 0 ? (
        <div className="transition__attached">
          {doc.links.map((l) => (
            <div key={`${l.letterKind}:${l.letterReg}`} className="transition__attached-item">
              <TypeChip kind={l.letterKind} />
              <span className="transition__opt-reg">{l.letterReg}</span>
              <span className="transition__attached-topic">{l.letterTopic}</span>
              <button
                type="button"
                className="transition__detach"
                onClick={() => void detach(l.letterReg, l.letterKind)}
                disabled={busy}
              >
                Отвязать
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="transition__fields">
        <div className="transition__search">
          <Icon name="search" size={20} className="toolbar__glyph" />
          <input
            className="transition__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Рег. номер или заголовок"
          />
          <span className="transition__found">
            {q.length >= 2
              ? searching
                ? 'Поиск…'
                : `Найдено: ${pool.length}`
              : 'Введите не менее двух символов'}
          </span>
        </div>

        {pool.length > 0 ? (
          <div className="transition__drop">
            {pool.map((m) => {
              const st = resultingStatus(m.kind);
              const isPicked = picked?.regNumber === m.regNumber && picked?.kind === m.kind;
              return (
                <button
                  key={`${m.kind}:${m.regNumber}`}
                  type="button"
                  className={`transition__opt${isPicked ? ' transition__opt_picked' : ''}`}
                  onClick={() => setPicked(m)}
                >
                  <TypeChip kind={m.kind} />
                  <span className="transition__opt-reg">{m.regNumber}</span>
                  <span className="transition__opt-topic">
                    {m.topic} · {formatIsoDate(m.regDate)}
                  </span>
                  <StatusBadge status={st} label={statusLabelOf(st)} />
                </button>
              );
            })}
          </div>
        ) : null}

        {q.length >= 2 && !searching && pool.length === 0 && !searchError ? (
          <div className="transition__idle">
            Письмо № {q} в реестре не найдено. Привязать можно только письмо из выгрузки.
          </div>
        ) : null}

        {searchError ? <div className="transition__error">{searchError}</div> : null}
        {error ? <div className="transition__error">{error}</div> : null}

        <div className="transition__actions">
          <button
            type="button"
            className={`btn btn_lg ${picked && !busy ? 'btn_primary' : 'btn_off'}`}
            onClick={() => void apply()}
          >
            Применить
          </button>
          {picked ? (
            <span className="transition__picked">Выбрано: № {picked.regNumber}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default TransitionBlock;
