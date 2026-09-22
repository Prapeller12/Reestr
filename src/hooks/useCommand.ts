// Общий хук загрузки данных для экранов: loading/ok/error (frontend.md §5.3).
// Оборачивает любую команду из src/api/commands; ошибки нормализуются в ApiError.
// runner держим в ref, чтобы его пересоздание не триггерило перезапуск — перезапуск
// контролируется массивом deps (сериализованные фильтры и т.п.) и счётчиком reload.
// reload того же запроса — stale-while-revalidate (переходы в lib/commandState.ts, под тестами):
// загруженные данные остаются 'ok' (refreshing / refreshError). Смена deps — сброс в 'loading':
// данные прежнего запроса за актуальные не выдаются.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { toApiError } from '../api/errors';
import { commandFailure, commandStart, commandSuccess, sameDeps } from '../lib/commandState';
import type { CommandState } from '../lib/commandState';

export type { CommandState } from '../lib/commandState';

export function useCommand<T>(
  runner: () => Promise<T>,
  deps: DependencyList,
): { state: CommandState<T>; reload: () => void } {
  const [state, setState] = useState<CommandState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  // deps прошлого запуска: отличают reload (те же deps) от смены запроса.
  const lastDepsRef = useRef<DependencyList | null>(null);

  useEffect(() => {
    let cancelled = false;
    const same = sameDeps(lastDepsRef.current, deps);
    lastDepsRef.current = deps;
    setState((prev) => commandStart(prev, same));
    runnerRef
      .current()
      .then((data) => {
        if (!cancelled) setState(commandSuccess(data));
      })
      .catch((e) => {
        if (!cancelled) setState((prev) => commandFailure(prev, toApiError(e)));
      });
    return () => {
      cancelled = true;
    };
    // Зависим от внешних deps и от счётчика перезагрузки.
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
