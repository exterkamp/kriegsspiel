import type { HqSnapshot, Result } from './contracts';
import type { ShellViewContext } from './shell/types';
import { sameScope } from './data/common';

/** Outlives the roster, but cancels on session, view or selection invalidation. */
export function createFormationFocus(signal: AbortSignal) {
  let pending: AbortController | null = null;
  return async (context: ShellViewContext, unitId: string): Promise<Result<void>> => {
    pending?.abort();
    const operation = new AbortController();
    pending = operation;
    const abort = () => operation.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let unsubscribe = () => {};
    const failure = (message: string): Result<never> => ({
      ok: false,
      error: {
        code: operation.signal.aborted ? 'aborted' : 'invalid-data',
        message,
        retry: 'never',
      },
    });
    try {
      const snapshot: HqSnapshot | null = context.sourceState.snapshot;
      if (operation.signal.aborted) return failure('Formation focus canceled.');
      if (
        !snapshot ||
        !sameScope(snapshot.scope, context.navigation.scope) ||
        !sameScope(snapshot.scope, context.surface.scope)
      )
        return failure('Formation focus belongs to another HQ session.');
      const row = snapshot.roster.find((row) => row.unitId === unitId);
      if (!row || row.position.kind !== 'snapshot')
        return failure('No supplied formation position.');
      const position = { ...row.position.value };
      const selected = context.navigation.select({
        kind: 'unit',
        id: unitId,
        scope: snapshot.scope,
      });
      if (!selected.ok) return selected;
      let reachedTable = false;
      unsubscribe = context.navigation.subscribe((state) => {
        const selection = state.selection;
        if (
          !sameScope(state.scope, snapshot.scope) ||
          selection.kind !== 'unit' ||
          selection.id !== unitId ||
          !sameScope(selection.scope, snapshot.scope)
        )
          abort();
        if (state.view === 'table') reachedTable = true;
        else if (reachedTable) abort();
      });
      const navigated = await context.navigation.navigate('table', null, {
        signal: operation.signal,
      });
      if (!navigated.ok) return navigated;
      if (operation.signal.aborted) return failure('Formation focus canceled.');
      const selection = context.navigation.getState().selection;
      if (
        selection.kind !== 'unit' ||
        selection.id !== unitId ||
        !sameScope(selection.scope, snapshot.scope)
      )
        return failure('Formation selection changed.');
      const focused = await context.surface.focusAt(position, { signal: operation.signal });
      return operation.signal.aborted ? failure('Formation focus canceled.') : focused;
    } catch {
      return failure('Formation focus failed. Please try again.');
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
      if (pending === operation) pending = null;
    }
  };
}
