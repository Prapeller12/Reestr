// TS-типы DTO — ДОСЛОВНОЕ зеркало замороженного контракта docs/plans/v2-backend.md §6 (= src-tauri/src/dto.rs).
// Имена полей — camelCase (как в JSON; backend отдаёт через serde rename_all="camelCase").
// Это НЕ новый интерфейс: любое изменение здесь идёт вслед за dto.rs / §6, не наоборот.

export type { ApiError, ApiErrorCode } from './errors';

// Домены-перечисления (КОНЦЕПЦИЯ §2/§3).
export type DocKind = 'outgoing' | 'incoming';
export type DocStatus = 'inWork' | 'overdue' | 'done' | 'reworked';
export type AlertLevel = 'red' | 'amber' | 'none';

// Правка полей (батч 2, п.3). Имя правимого поля и роль справочника участников.
// ВНИМАНИЕ: поле 'addressees' (мн.) соответствует роли справочника 'addressee' (ед.).
export type FieldOverrideName = 'signer' | 'addressees';
export type PartyRole = 'signer' | 'addressee';

// Ссылка на документ (вид + рег.номер) — ключ тема-оверлея для массовых операций.
// Рег.номер уникален лишь в пределах вида (КОНЦЕПЦИЯ §5.6), поэтому вид обязателен.
export interface DocRef {
  kind: DocKind;
  regNumber: string;
}

// Привязанное к задаче письмо (карточка исходящего).
export interface AttachedLetter {
  id: number;
  letterReg: string;
  letterKind: DocKind;
  letterTopic: string;
  letterRef: string;
  letterStatus: DocStatus | null; // статус письма-исходящего; null у входящего
  createdAt: string; // 'YYYY-MM-DD HH:MM:SS'
}

// Кандидат письма для привязки (search_letters / выпадающий список §5.5).
export interface LetterMatch {
  regNumber: string;
  kind: DocKind;
  topic: string;
  regDate: string; // ISO
  ref: string;
  status: DocStatus | null; // null у входящих
}

// Узел цепочки: задача-исходящее либо входящее письмо, которым задача закрыта.
export interface ChainNode {
  regNumber: string;
  kind: DocKind;
  ref: string;
  topic: string;
  status: DocStatus | null; // null у входящих
}

// Главный DTO — зеркало dto.rs::DocumentView. Статус-блок = null у входящих.
export interface DocumentView {
  regNumber: string;
  kind: DocKind;
  regDate: string; // ISO
  counterparty: string; // Получатель (исх.) / Корреспондент (вх.), сырой текст
  topic: string;
  signer: string; // эффективное: правка пользователя > факт из выгрузки; '' у входящих
  addressees: string; // эффективное: правка пользователя > факт; '' если пусто (не null)
  signerEdited: boolean; // true, если signer правил пользователь (есть FIELD_OVERRIDE); всегда false у входящих
  addresseesEdited: boolean; // true, если addressees правил пользователь; всегда false у входящих
  ref: string;
  deadlineSrc: string; // Срок исполнения из выгрузки (ISO или '')
  status: DocStatus | null; // null у входящих
  statusLabel: string | null;
  dueDate: string | null; // вычислен backend (§3)
  daysRemaining: number | null;
  alertLevel: AlertLevel | null;
  remainingText: string | null;
  theme: string | null; // null → «Без темы» (только исх.)
  links: AttachedLetter[]; // привязанные письма (у входящих [])
  // У входящего продолжений нет, а предшественники — задачи, которые им закрыты.
  chain: { predecessors: ChainNode[]; successors: ChainNode[] };
}

// Все поля опциональны (§6).
export interface RegistryFilters {
  kind?: DocKind;
  theme?: string;
  signer?: string;
  addressees?: string;
  counterparty?: string;
  status?: DocStatus;
  query?: string;
}

// Ответ import_preview / get_compare — одна модель diff (§6).
export interface ImportDiffField {
  field: string;
  old: string;
  new: string;
}
export interface ImportDiffRow {
  regNumber: string;
  kind: 'new' | 'same' | 'changed';
  diff?: ImportDiffField[]; // присутствует только для 'changed'
}
export interface ImportPreview {
  counts: { new: number; same: number; changed: number };
  rows: ImportDiffRow[];
}

export interface ImportBatchDto {
  id: number;
  kind: DocKind;
  fileName: string;
  source: string;
  importedAt: string;
  countNew: number;
  countChanged: number;
  countSame: number;
}
export interface ImportApplyResult {
  batch: ImportBatchDto;
  counts: { new: number; same: number; changed: number };
}

export interface ThemeDto {
  name: string;
  userCreated: boolean;
  documentCount: number;
}

export interface RegistryGroup {
  theme: string | null;
  documents: DocumentView[];
}
export interface RegistryResult {
  groups: RegistryGroup[];
  total: number;
}

export interface TimelineItem {
  regNumber: string;
  regDate: string;
  dueDate: string;
  status: DocStatus;
}
export interface TimelineLane {
  theme: string | null;
  items: TimelineItem[];
}
export interface TimelineResult {
  lanes: TimelineLane[];
}

export type CompareResult = ImportPreview; // §6: форма повторяет превью

export interface PrintModel {
  generatedAt: string;
  groups: RegistryGroup[];
}

export interface BulkAssignResult {
  updated: number;
}

// Ответ deleteTheme: сколько писем (оба вида) перешло в «Без темы».
// Та же метрика, что ThemeDto.documentCount; с видимыми строками группы реестра не сверять.
export interface DeleteThemeResult {
  reassigned: number;
}
