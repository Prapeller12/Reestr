import type { ApiError } from '../../api/errors';

interface Props {
  error: ApiError;
  onRetry?: () => void;
}

function ErrorState({ error, onRetry }: Props) {
  return (
    <div className="error-state">
      <div className="error-state__title">Не удалось загрузить реестр</div>
      <div>{error.message}</div>
      <div className="error-state__code">{error.code}</div>
      {onRetry ? (
        <div className="error-state__actions">
          <button type="button" className="btn btn_secondary" onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ErrorState;
