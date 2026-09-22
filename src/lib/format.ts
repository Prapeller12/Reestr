// Форматирование фактов DocumentView в тексты прототипа. Статус НЕ вычисляется —
// только рендер фактов backend (status/statusLabel/remainingText/alertLevel/chain/links).
import type { DocKind, DocStatus, DocumentView } from '../api/types';
import { formatIsoDate } from './dates';

/** БЭМ-модификатор статуса: status-badge_inwork, timeline-chip_done и т.п. */
export function statusMod(status: DocStatus): string {
  return status.toLowerCase();
}

/** Ключ документа уникален в пределах вида (§5.6 инвариант 1): (kind, regNumber). */
export function docKey(kind: DocKind, regNumber: string): string {
  return `${kind}:${regNumber}`;
}

/**
 * «Закрыто» = задача выполнена по существу: исходящее со статусом `done`. У входящих
 * своего статуса нет (§2), поэтому их «закрытость» определяется отдельно — привязкой к
 * задаче (см. App: множество закрывающих входящих). Статус тут не вычисляется — только факт.
 */
export function isClosed(doc: DocumentView): boolean {
  return doc.kind === 'outgoing' && doc.status === 'done';
}

/** Подпись статуса по enum — для узлов цепочки, когда полной карточки нет под рукой. */
const STATUS_LABELS: Record<DocStatus, string> = {
  inWork: 'В работе',
  overdue: 'Не выполнено',
  done: 'Выполнено',
  reworked: 'В доработке',
};

export function statusLabelOf(status: DocStatus): string {
  return STATUS_LABELS[status];
}

export type RemainTone = 'normal' | 'soon' | 'overdue';

export interface RemainingInfo {
  text: string;
  tone: RemainTone;
}

/**
 * Колонка «Исполнение» — теперь чистый рендер фактов backend (контракт v2):
 * текст = doc.remainingText (готовая строка, у входящих null → пусто),
 * тон = doc.alertLevel ('red' → просрочка, 'amber' → скоро срок, иначе обычный).
 * Никакой арифметики со временем на клиенте (инвариант «статус только с бэкенда»).
 */
export function remainingFor(doc: DocumentView): RemainingInfo {
  const tone: RemainTone =
    doc.alertLevel === 'red' ? 'overdue' : doc.alertLevel === 'amber' ? 'soon' : 'normal';
  return { text: doc.remainingText ?? '', tone };
}

/** Инициалы подписанта: 'Ваган В. Е.' → 'ВВ' (первая буква первых двух слов). */
export function signerInitials(signer: string): string {
  const parts = signer.split(' ');
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return first + second;
}

/** Короткое имя подписанта: 'Ваган В. Е.' → 'Ваган…'. */
export function signerShort(signer: string): string {
  const parts = signer.split(' ');
  return parts.length && parts[0] ? `${parts[0]}…` : '';
}

/** Русские подписи полей диффа импорта (id из import/diff.rs — camelCase). */
const DIFF_FIELD_LABELS: Record<string, string> = {
  regDate: 'дата регистрации',
  counterparty: 'контрагент',
  recipient: 'получатель',
  topic: 'заголовок',
  signer: 'подписант',
  addressees: 'адресаты',
  ref: 'ссылка',
};

export function diffFieldLabel(field: string): string {
  return DIFF_FIELD_LABELS[field] ?? field;
}

/** Значение поля диффа: даты — в ДД.ММ.ГГГГ, пустое — '—'. */
export function diffFieldValue(field: string, value: string): string {
  if (field === 'regDate') return formatIsoDate(value);
  return value === '' ? '—' : value;
}
