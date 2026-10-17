import { webcrypto } from 'node:crypto';
import { TestBed } from '@angular/core/testing';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  type MapAsset,
} from '@kriegsspiel/maps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseReplayParameters } from '../../../legacy/map-authoring/generation/protocol';
import type { BoardPreparation, CertifiedBoard } from '../../../shared/game-setup/contracts';
import type {
  LibraryMapSummary,
  MapLibraryPort,
} from '../../../shared/lobby-map-library/contracts';
import { verifyLibraryAsset } from '../../../shared/lobby-map-library/asset-check';
import { MAP_LIBRARY_ASSET_VERIFIER, type LibraryAssetVerifier } from './asset-verifier';
import { checkLibraryAssetForTest } from './asset-verifier.testing';
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
    const state = new MapLibraryState(
      {
        saved: vi.fn(),
        cancelled,
        dirty: (dirty) => {
          if (!dirty) state.dispose();
        },
      },
      checkLibraryAssetForTest,
    );
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
    const state = new MapLibraryState(
      {
        saved: vi.fn(),
        cancelled: vi.fn(),
        dirty: (dirty) => {
          if (!dirty) state.configure(replacement, port);
        },
      },
      checkLibraryAssetForTest,
    );
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
    const state = new MapLibraryState(
      {
        saved: vi.fn(),
        cancelled: vi.fn(),
        dirty: (dirty) => {
          if (!dirty) state.configure(shared, port);
        },
      },
      checkLibraryAssetForTest,
    );
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
    const state = new MapLibraryState(
      { saved: vi.fn(), cancelled, dirty: vi.fn() },
      checkLibraryAssetForTest,
    );
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
    const state = new MapLibraryState(
      {
        saved: vi.fn(),
        cancelled,
        dirty: (dirty) => {
          if (!dirty) state.configure(shared, port);
        },
      },
      checkLibraryAssetForTest,
    );
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function certified(name = 'Reference valley'): Promise<CertifiedBoard> {
  const asset = createReferenceAsset();
  asset.name = name;
  return {
    asset,
    canonicalJson: canonicalizeAsset(asset),
    assetIdentity: await assetIdentity(asset, 'asset'),
    bounds: { minX: 0, minY: 0, maxX: 150, maxY: 150 },
    summary: { ref: null, name, widthM: 150, heightM: 150 },
  };
}
describe('Add asset verification lifetimes', () => {
  let state: MapLibraryState;
  let prep: BoardPreparation;
  let port: MapLibraryPort;
  let board: CertifiedBoard;
  let summary: LibraryMapSummary;
  let saved: ReturnType<typeof vi.fn<(value: LibraryMapSummary) => void>>;
  let verifier: ReturnType<typeof vi.fn<LibraryAssetVerifier>>;
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    board = await certified();
    prep = { generate: vi.fn().mockResolvedValue(board), load: vi.fn(), dispose: vi.fn() };
    summary = {
      ref: { kind: 'owned', id: '7da01aae-638e-4700-9a8d-5f39646c78d1' },
      name: 'My geography',
      widthM: 150,
      heightM: 150,
      assetIdentity: board.assetIdentity,
      status: 'needs-scenario',
      createdAtMs: 1,
    };
    port = {
      list: vi.fn(),
      save: vi.fn().mockResolvedValue(summary),
      read: vi.fn().mockResolvedValue({ item: summary, canonicalJson: board.canonicalJson }),
    };
    saved = vi.fn();
    verifier = vi.fn(checkLibraryAssetForTest);
    state = new MapLibraryState({ saved, cancelled: vi.fn(), dirty: vi.fn() }, verifier);
    state.configure(
      prep,
      port,
      parseReplayParameters({
        seed: board.asset.provenance.seed,
        settings: board.asset.settings,
        overrides: board.asset.overrides,
      }),
    );
  });
  afterEach(() => {
    state?.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('defaults the root token to the actual worker verifier', () => {
    expect(TestBed.inject(MAP_LIBRARY_ASSET_VERIFIER)).toBe(verifyLibraryAsset);
  });

  it.each(['bytes', 'identity', 'dimensions', 'candidate'])(
    'uses a real rejecting test checker for %s rather than unconditional success',
    async (invalid) => {
      const job = {
        canonicalJson: board.canonicalJson,
        assetIdentity: board.assetIdentity,
        widthM: 150,
        heightM: 150,
        candidate: structuredClone(board.asset) as MapAsset,
      };
      if (invalid === 'bytes') job.canonicalJson += ' ';
      if (invalid === 'identity')
        job.assetIdentity = await assetIdentity(board.asset as MapAsset, 'geometry');
      if (invalid === 'dimensions') job.heightM = 160;
      if (invalid === 'candidate') job.candidate.name = 'Foreign certified candidate';
      await expect(checkLibraryAssetForTest(job, new AbortController().signal)).rejects.toThrow();
    },
  );

  it.each(['replace', 'cancel', 'destroy'])(
    'cannot publish an old generation verification after %s or clear a newer lifetime',
    async (exit) => {
      const pending = deferred<MapAsset>();
      verifier.mockReturnValueOnce(pending.promise);
      const operation = state.generate();
      await vi.waitFor(() => expect(verifier).toHaveBeenCalledOnce());
      const [job, signal] = verifier.mock.calls[0]!;
      expect(job.candidate).toEqual(board.asset);
      expect(signal).toBe(vi.mocked(prep.generate).mock.calls[0]![1]);
      expect(state.board()).toBeUndefined();
      const incoming = preparation();
      const newer = await certified('Replacement map');
      vi.mocked(incoming.generate).mockResolvedValue(newer);
      if (exit === 'replace') {
        state.configure(incoming, port, state.recipe());
        await state.generate();
      } else if (exit === 'cancel') {
        state.requestCancel();
        expect(state.confirming()).toBe(true);
        state.discard();
      } else state.dispose();
      expect(signal.aborted).toBe(true);
      expect(prep.dispose).toHaveBeenCalledOnce();
      const active = state.board();
      pending.resolve(board.asset as MapAsset);
      await operation;
      expect(state.board()).toBe(active);
      expect(state.busy()).toBe(false);
      expect(saved).not.toHaveBeenCalled();
      if (exit === 'replace') {
        expect(state.board()?.canonicalJson).toBe(newer.canonicalJson);
        expect(incoming.dispose).not.toHaveBeenCalled();
        state.dispose();
        expect(incoming.dispose).toHaveBeenCalledOnce();
      } else expect(state.board()).toBeUndefined();
    },
  );

  it('retains the same exact save intent on verification failure and emits only after verified readback', async () => {
    await state.generate();
    state.setName(summary.name);
    verifier.mockRejectedValueOnce(new Error('Verification unavailable'));
    await state.save();
    expect(state.pending()).toBe(true);
    expect(state.completed()).toBeUndefined();
    expect(saved).not.toHaveBeenCalled();
    expect(state.error()).toContain('may already be saved');
    state.setName('Cannot replace an ambiguous intent');
    expect(state.name()).toBe(summary.name);
    await state.save();
    const requests = vi.mocked(port.save).mock.calls;
    expect(requests).toHaveLength(2);
    expect(requests[0]![0]).toEqual(requests[1]![0]);
    expect(requests[0]![0]).toMatchObject({
      canonicalJson: board.canonicalJson,
      assetIdentity: board.assetIdentity,
      name: summary.name,
    });
    expect(verifier.mock.calls.at(-1)![0]).toEqual({
      canonicalJson: board.canonicalJson,
      assetIdentity: board.assetIdentity,
      widthM: 150,
      heightM: 150,
    });
    expect(saved).toHaveBeenCalledExactlyOnceWith(summary);
  });

  it.each(['replace', 'discard', 'destroy'])(
    'cannot emit a saved map after pending readback verification and %s',
    async (exit) => {
      await state.generate();
      state.setName(summary.name);
      const pending = deferred<MapAsset>();
      verifier.mockReturnValueOnce(pending.promise);
      const operation = state.save();
      await vi.waitFor(() => expect(verifier).toHaveBeenCalledTimes(2));
      const [job, signal] = verifier.mock.calls[1]!;
      expect(job).toEqual({
        canonicalJson: board.canonicalJson,
        assetIdentity: board.assetIdentity,
        widthM: 150,
        heightM: 150,
      });
      expect(signal).toBe(vi.mocked(port.read).mock.calls[0]![1]);
      expect(state.pending()).toBe(true);
      expect(saved).not.toHaveBeenCalled();
      if (exit === 'replace') state.configure(preparation(), port, state.recipe());
      else if (exit === 'discard') {
        state.requestCancel();
        expect(state.error()).toContain('may already be saved');
        state.discard();
      } else state.dispose();
      expect(signal.aborted).toBe(true);
      pending.resolve(board.asset as MapAsset);
      await operation;
      expect(saved).not.toHaveBeenCalled();
      expect(state.completed()).toBeUndefined();
      expect(state.busy()).toBe(false);
      expect(prep.dispose).toHaveBeenCalledOnce();
    },
  );
});
