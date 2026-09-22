// Единая модель ошибок — зеркало backend.md §10.3.
// code — машиночитаемый (ветвление в UI), message — русский текст для пользователя.

export type ApiErrorCode =
  | 'PARSE_HEADER'
  | 'PARSE_FIELDS'
  | 'PARSE_DATE'
  | 'IO_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'LINK_TARGET_NOT_IN_REGISTRY'
  | 'DUPLICATE_THEME'
  | 'DB_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

// Tauri отдаёт ошибку команды как объект { code, message } (backend.md §10.3).
export function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    typeof (e as { message: unknown }).message === 'string'
  );
}

// Нормализация неизвестной ошибки invoke в ApiError (frontend.md §5.3).
export function toApiError(e: unknown): ApiError {
  if (isApiError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return { code: 'DB_ERROR', message };
}
