import { describe, expect, it, vi } from 'vitest';
import type { BoardPreparation } from '../../../shared/game-setup/contracts';
import type { MapLibraryPort } from '../../../shared/lobby-map-library/contracts';
import { MapLibraryState } from './map-library-state';

const preparation = (): BoardPreparation => ({
  generate: vi.fn(),
  load: vi.fn(),
  dispose: vi.fn(),
});
const library = (): MapLibraryPort => ({ save: vi.fn(), read: vi.fn(), list: vi.fn() });

describe('Add geography resource ownership during synchronous callbacks', () => {
  it('releases both supplied preparations when resetting dirty state destroys the owner', () => {
    const old = preparation();
    const incoming = preparation();
    const cancelled = vi.fn();
    const state = new MapLibraryState({
      saved: vi.fn(),
      cancelled,
      dirty: (dirty) => {
        if (!dirty) state.dispose();
      },
    });
    state.configure(old, library());
    state.setSeed('17');
    state.configure(incoming, library());
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(incoming.dispose).toHaveBeenCalledTimes(1);
    expect(state.canGenerate()).toBe(false);
    state.dispose();
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(incoming.dispose).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('retains a reentrantly supplied preparation while retiring the superseded input', async () => {
    const old = preparation();
    const superseded = preparation();
    const replacement = preparation();
    const port = library();
    const state = new MapLibraryState({
      saved: vi.fn(),
      cancelled: vi.fn(),
      dirty: (dirty) => {
        if (!dirty) state.configure(replacement, port);
      },
    });
    state.configure(old, port);
    state.setSeed('17');
    state.configure(superseded, port);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(superseded.dispose).toHaveBeenCalledTimes(1);
    expect(replacement.dispose).not.toHaveBeenCalled();
    expect(state.canGenerate()).toBe(true);
    await state.generate(); // The current preparation alone receives the explicit request.
    expect(replacement.generate).toHaveBeenCalledTimes(1);
    expect(superseded.generate).not.toHaveBeenCalled();
    state.dispose();
    expect(replacement.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not dispose a preparation reused by the current replacement lifetime', () => {
    const shared = preparation();
    const port = library();
    const state = new MapLibraryState({
      saved: vi.fn(),
      cancelled: vi.fn(),
      dirty: (dirty) => {
        if (!dirty) state.configure(shared, port);
      },
    });
    state.configure(shared, port);
    state.setSeed('17');
    state.configure(shared, port);
    expect(shared.dispose).not.toHaveBeenCalled();
    expect(state.canGenerate()).toBe(true);
    state.dispose();
    expect(shared.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not let an old Cancel close a replacement created synchronously by its abort listener', async () => {
    const old = preparation();
    const next = preparation();
    const port = library();
    const cancelled = vi.fn();
    const state = new MapLibraryState({ saved: vi.fn(), cancelled, dirty: vi.fn() });
    vi.mocked(old.generate).mockImplementation(async (_recipe, signal) => {
      signal.addEventListener('abort', () => state.configure(next, port));
      throw new Error('interrupted generation');
    });
    state.configure(old, port);
    const operation = state.generate();
    state.requestCancel();
    await operation;
    expect(cancelled).not.toHaveBeenCalled();
    expect(state.closed()).toBe(false);
    expect(state.confirming()).toBe(false);
    expect(state.phase()).toBe('Choose a landscape, then Generate map.');
    expect(state.canGenerate()).toBe(true);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(next.dispose).not.toHaveBeenCalled();
    state.dispose();
    expect(next.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps a replacement supplied by the final dirty callback alive instead of completing the old close', () => {
    const shared = preparation();
    const port = library();
    const cancelled = vi.fn();
    const state = new MapLibraryState({
      saved: vi.fn(),
      cancelled,
      dirty: (dirty) => {
        if (!dirty) state.configure(shared, port);
      },
    });
    state.configure(shared, port);
    state.setSeed('17');
    state.requestCancel();
    state.discard();
    expect(cancelled).not.toHaveBeenCalled();
    expect(state.closed()).toBe(false);
    expect(state.canGenerate()).toBe(true);
    expect(shared.dispose).not.toHaveBeenCalled();
    state.dispose();
    expect(shared.dispose).toHaveBeenCalledTimes(1);
  });
});
