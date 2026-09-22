// Типизированный слой команд — по одной функции на каждую из 22 Tauri-команд (docs/plans/v2-backend.md §6).
// Имена команд-строк — snake_case (как в контракте); имена аргументов — camelCase
// (Tauri маппит на snake_case параметры Rust). Ошибки нормализуются в ApiError и пробрасываются.

import { invoke } from '@tauri-apps/api/core';
import { toApiError } from './errors';
import type {
  BulkAssignResult,
  CompareResult,
  DeleteThemeResult,
  DocKind,
  DocRef,
  DocumentView,
  FieldOverrideName,
  ImportApplyResult,
  ImportBatchDto,
  ImportPreview,
  LetterMatch,
  PartyRole,
  PrintModel,
  RegistryFilters,
  RegistryResult,
  ThemeDto,
  TimelineResult,
} from './types';

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

// --- Реестр / карточка ---

export function getRegistry(filters?: RegistryFilters): Promise<RegistryResult> {
  return call('get_registry', { filters });
}

export function getDocument(kind: DocKind, regNumber: string): Promise<DocumentView> {
  return call('get_document', { kind, regNumber });
}

// --- Импорт (по типу) ---

export function importPreview(path: string, kind: DocKind): Promise<ImportPreview> {
  return call('import_preview', { path, kind });
}

export function importApply(path: string, kind: DocKind): Promise<ImportApplyResult> {
  return call('import_apply', { path, kind });
}

export function listImportBatches(): Promise<ImportBatchDto[]> {
  return call('list_import_batches');
}

// --- Привязка письма (смена статуса, §5.5) ---

export function searchLetters(query: string, limit?: number): Promise<LetterMatch[]> {
  return call('search_letters', { query, limit });
}

export function attachLetter(
  taskReg: string,
  letterReg: string,
  letterKind: DocKind,
): Promise<DocumentView> {
  return call('attach_letter', { taskReg, letterReg, letterKind });
}

export function detachLetter(
  taskReg: string,
  letterReg: string,
  letterKind: DocKind,
): Promise<DocumentView> {
  return call('detach_letter', { taskReg, letterReg, letterKind });
}

// --- Сроки (оверлей исходящих) ---

export function setDeadline(regNumber: string, endDate: string): Promise<DocumentView> {
  return call('set_deadline', { regNumber, endDate });
}

export function clearDeadline(regNumber: string): Promise<DocumentView> {
  return call('clear_deadline', { regNumber });
}

// --- Правка полей Подписант/Адресаты + справочник участников (батч 2, п.3) ---

// field: 'signer' | 'addressees'. value trim-ится на бэке; пустое допустимо (очистка поля).
// Оверлей «правка > факт» переживает переимпорт (КОНЦЕПЦИЯ-правка-полей §5a).
export function setFieldOverride(
  regNumber: string,
  field: FieldOverrideName,
  value: string,
): Promise<DocumentView> {
  return call('set_field_override', { regNumber, field, value });
}

// Реверт к исходному факту из выгрузки (удаляет FIELD_OVERRIDE).
export function clearFieldOverride(
  regNumber: string,
  field: FieldOverrideName,
): Promise<DocumentView> {
  return call('clear_field_override', { regNumber, field });
}

// Автодополнение из справочника участников. role: 'signer' | 'addressee'
// (поле addressees соответствует роли addressee).
export function getFieldSuggestions(role: PartyRole): Promise<string[]> {
  return call('get_field_suggestions', { role });
}

// --- Темы (документы обоих видов; ключ оверлея — пара (вид, рег.номер), §5.6) ---

export function assignTheme(
  kind: DocKind,
  regNumber: string,
  themeName: string,
): Promise<DocumentView> {
  return call('assign_theme', { kind, regNumber, themeName });
}

// items — пары (вид, рег.номер) документов ЛЮБОГО вида (каноническая форма DocRef[]).
export function bulkAssignThemes(items: DocRef[], themeName: string): Promise<BulkAssignResult> {
  return call('bulk_assign_themes', { items, themeName });
}

export function bulkClearThemes(items: DocRef[]): Promise<BulkAssignResult> {
  return call('bulk_clear_themes', { items });
}

export function createTheme(name: string): Promise<ThemeDto> {
  return call('create_theme', { name });
}

// Удалить тему: её письма (оба вида) → «Без темы». Нет темы → NOT_FOUND, пустое имя → VALIDATION_ERROR.
export function deleteTheme(name: string): Promise<DeleteThemeResult> {
  return call('delete_theme', { name });
}

export function listThemes(): Promise<ThemeDto[]> {
  return call('list_themes');
}

// --- Таймлайн / сверка / печать ---

export function getTimeline(filters?: RegistryFilters): Promise<TimelineResult> {
  return call('get_timeline', { filters });
}

export function getCompare(batchId?: number): Promise<CompareResult> {
  return call('get_compare', { batchId });
}

export function getPrintModel(filters?: RegistryFilters): Promise<PrintModel> {
  return call('get_print_model', { filters });
}
