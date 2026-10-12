import { battlefieldPreset, createReferenceAsset } from '@kriegsspiel/maps';
import { describe, expect, it, vi } from 'vitest';
import type {
  CertifiedBoard,
  MapSummary,
  SetupProps,
} from '../../../shared/game-setup/contracts.js';
import { SetupState, mapRefKey } from './setup-state';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const summary: MapSummary = {
  ref: { kind: 'generated', id: 'saved' },
  name: 'Saved title',
  widthM: 150,
  heightM: 150,
};
function certified(saved = false): CertifiedBoard {
  return {
    asset: createReferenceAsset(),
    canonicalJson: 'canonical',
    assetIdentity: 'full-identity',
    summary: { ...structuredClone(summary), ref: saved ? structuredClone(summary.ref) : null },
    bounds: { minX: 0, minY: 0, maxX: 150, maxY: 150 },
  };
}
function harness() {
  const props: SetupProps = {
    catalog: {
      list: vi.fn().mockResolvedValue([structuredClone(summary)]),
      read: vi.fn().mockResolvedValue('saved-json'),
      save: vi.fn().mockResolvedValue(structuredClone(summary)),
    },
    preparation: {
      load: vi.fn().mockResolvedValue(certified(true)),
      generate: vi.fn().mockResolvedValue(certified()),
      dispose: vi.fn(),
    },
    onStart: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  };
  const state = new SetupState();
  return { state, props, open: () => state.configure(props) };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('SetupState ownership and eligibility', () => {
  it('awaits cancelled preparation retirement before a successor can allocate', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate).mockReturnValueOnce(old.promise);
    await h.open();
    const first = h.state.generate();
    await flush();
    const oldSignal = vi.mocked(h.props.preparation.generate).mock.calls[0]![1];
    const next = h.state.selectSaved(mapRefKey(summary.ref));
    await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(h.props.preparation.load).not.toHaveBeenCalled();
    expect(h.state.busy()).toBe(true);
    old.reject(new Error('Late hash failure'));
    await Promise.all([first, next]);
    expect(h.props.preparation.load).toHaveBeenCalledOnce();
    expect(h.state.phase()).toBe('Saved map ready.');
    expect(h.state.canStart()).toBe(true);
    await h.state.dispose();
  });

  it('invalidates immediately but acknowledges cancellation only after retirement, allowing a new owner', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate).mockReturnValueOnce(old.promise);
    await h.open();
    const first = h.state.generate();
    await flush();
    const cancelled = h.state.cancel();
    expect(h.state.closed()).toBe(true);
    expect(h.props.preparation.dispose).toHaveBeenCalledOnce();
    expect(h.props.onCancel).not.toHaveBeenCalled();
    const next = harness();
    const replacement = cancelled.then(async () => {
      await next.open();
      await next.state.generate();
    });
    await flush();
    expect(next.props.preparation.generate).not.toHaveBeenCalled();
    old.resolve(certified());
    await Promise.all([first, replacement]);
    expect(h.props.onCancel).toHaveBeenCalledOnce();
    expect(next.props.preparation.generate).toHaveBeenCalledOnce();
    expect(h.state.board()).toBeNull();
    await next.state.dispose();
  });

  it('reserves completion before an injected preparation port synchronously destroys setup', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    let teardown!: Promise<void>;
    let retired = false;
    vi.mocked(h.props.preparation.generate).mockImplementation(() => {
      teardown = h.state.dispose();
      void teardown.then(() => (retired = true));
      return old.promise;
    });
    await h.open();
    const first = h.state.generate();
    await flush();
    expect(h.state.closed()).toBe(true);
    expect(retired).toBe(false);
    expect(h.state.dispose()).toBe(teardown);
    old.reject(new Error('Late identity failure'));
    await Promise.all([first, teardown]);
    expect(retired).toBe(true);
    expect(h.state.board()).toBeNull();
    expect(h.props.preparation.dispose).toHaveBeenCalledOnce();
  });

  it('an abort listener may supersede an outer command without allocating that outer command', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    let reentered: Promise<void> | undefined;
    vi.mocked(h.props.preparation.generate).mockImplementationOnce((_recipe, signal) => {
      signal.addEventListener('abort', () => {
        h.state.setSeed('43');
        reentered = h.state.generate();
      });
      return old.promise;
    });
    await h.open();
    const first = h.state.generate();
    await flush();
    await h.state.selectSaved(mapRefKey(summary.ref));
    old.resolve(certified());
    await first;
    await reentered;
    expect(h.props.catalog.read).not.toHaveBeenCalled();
    expect(
      vi.mocked(h.props.preparation.generate).mock.calls.map(([recipe]) => recipe.seed),
    ).toEqual([17, 43]);
    await h.state.dispose();
  });

  it('stale generation success/finally cannot clear a newer generation busy state', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    const latest = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    await h.open();
    const first = h.state.generate();
    await flush();
    h.state.setSeed('18');
    const second = h.state.generate();
    old.resolve(certified());
    await first;
    await flush();
    expect(h.state.busy()).toBe(true);
    expect(h.state.board()).toBeNull();
    expect(h.state.phase()).toBe('Generating and certifying map…');
    latest.resolve(certified());
    await second;
    expect(h.state.canSave()).toBe(true);
    await h.state.dispose();
  });

  it.each(['seed', 'preset', 'size'] as const)(
    'a valid %s edit during generation invalidates a late certified result',
    async (field) => {
      const h = harness();
      const old = deferred<CertifiedBoard>();
      vi.mocked(h.props.preparation.generate).mockReturnValue(old.promise);
      await h.open();
      const first = h.state.generate();
      await flush();
      if (field === 'seed') h.state.setSeed('18');
      else if (field === 'preset') h.state.setPreset('river-valley');
      else h.state.setSize('10000');
      old.resolve(certified());
      await first;
      expect(h.state.currentDraft()).not.toBeNull();
      expect(h.state.board()).toBeNull();
      expect(h.state.canSave()).toBe(false);
      expect(h.state.phase()).toContain('Draft changed');
      await h.state.dispose();
    },
  );

  it.each(['seed', 'preset', 'size'] as const)(
    'a valid %s edit during save cannot publish a saved reference',
    async (field) => {
      const h = harness();
      const old = deferred<MapSummary>();
      vi.mocked(h.props.catalog.save).mockReturnValue(old.promise);
      await h.open();
      await h.state.generate();
      const saving = h.state.save();
      if (field === 'seed') h.state.setSeed('18');
      else if (field === 'preset') h.state.setPreset('river-valley');
      else h.state.setSize('10000');
      old.resolve(summary);
      await saving;
      expect(h.state.board()?.summary.ref).toBeNull();
      expect(h.state.canStart()).toBe(false);
      expect(h.state.phase()).toContain('Draft changed');
      await h.state.dispose();
    },
  );

  it.each(['', '-1', '1.5', '1e2', ' 17', '9007199254740992', '9'.repeat(400)])(
    'rejects invalid/unsafe seed %s before invoking preparation',
    async (seed) => {
      const h = harness();
      await h.open();
      h.state.setSeed(seed);
      await h.state.generate();
      expect(h.state.currentDraft()).toBeNull();
      expect(h.props.preparation.generate).not.toHaveBeenCalled();
      await h.state.dispose();
    },
  );

  it('returning to the exact certified recipe enables retry save, never accepts the old save', async () => {
    const h = harness();
    const old = deferred<MapSummary>();
    vi.mocked(h.props.catalog.save).mockReturnValueOnce(old.promise);
    await h.open();
    await h.state.generate();
    const saving = h.state.save();
    h.state.setSeed('18');
    h.state.setSeed('17');
    old.resolve(summary);
    await saving;
    expect(h.state.canStart()).toBe(false);
    expect(h.state.canSave()).toBe(true);
    await h.state.save();
    expect(vi.mocked(h.props.catalog.save).mock.calls.map(([bytes]) => bytes)).toEqual([
      'canonical',
      'canonical',
    ]);
    expect(h.props.preparation.generate).toHaveBeenCalledOnce();
    await h.state.dispose();
  });

  it('stale save rejection/finally cannot clear a newer save or overwrite its status', async () => {
    const h = harness();
    const old = deferred<MapSummary>();
    const latest = deferred<MapSummary>();
    vi.mocked(h.props.catalog.save)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    await h.open();
    await h.state.generate();
    const first = h.state.save();
    h.state.setSeed('18');
    h.state.setSeed('17');
    const second = h.state.save();
    old.reject(new Error('Stale save failure'));
    await first;
    expect(h.state.phase()).toBe('Saving map…');
    expect(h.state.busy()).toBe(true);
    expect(h.state.canStart()).toBe(false);
    latest.resolve(summary);
    await second;
    expect(h.state.canStart()).toBe(true);
    await h.state.dispose();
  });

  it.each(['resolve', 'reject'] as const)(
    'a late initial list %s cannot override an edited draft or its status',
    async (outcome) => {
      const h = harness();
      const listed = deferred<MapSummary[]>();
      h.props.initialRef = summary.ref;
      vi.mocked(h.props.catalog.list).mockReturnValue(listed.promise);
      const opening = h.open();
      await flush();
      h.state.setSeed('42');
      if (outcome === 'resolve') listed.resolve([summary]);
      else listed.reject(new Error('Late list failure'));
      await opening;
      expect(h.props.catalog.read).not.toHaveBeenCalled();
      expect(h.state.seed()).toBe('42');
      expect(h.state.phase()).toContain('Draft changed');
      await h.state.dispose();
    },
  );

  it('refuses storage dimension mismatch and wrong saved certification reference', async () => {
    const h = harness();
    await h.open();
    vi.mocked(h.props.preparation.load).mockResolvedValue({
      ...certified(true),
      summary: { ...summary, ref: { kind: 'premade', id: 'wrong' } },
    });
    await h.state.selectSaved(mapRefKey(summary.ref));
    expect(h.state.canStart()).toBe(false);
    expect(h.state.board()).toBeNull();
    await h.state.generate();
    vi.mocked(h.props.catalog.save).mockResolvedValue({ ...summary, widthM: 151 });
    await h.state.save();
    expect(h.state.phase()).toContain('Saved map dimensions do not match');
    expect(h.state.board()?.summary.ref).toBeNull();
    expect(h.state.canSave()).toBe(true);
    await h.state.dispose();
  });

  it('custom preset and empty saved selection invalidate pending work without changing recorded settings', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate).mockReturnValueOnce(old.promise);
    await h.open();
    const recipe = structuredClone(h.state.recipe());
    const generating = h.state.generate();
    await flush();
    h.state.setPreset('');
    expect(h.state.preset()).toBe('');
    expect(h.state.recipe()).toEqual(recipe);
    expect(vi.mocked(h.props.preparation.generate).mock.calls[0]![1].aborted).toBe(true);
    await h.state.selectSaved('');
    old.resolve(certified());
    await generating;
    expect(h.state.phase()).toBe('Choose a saved map or generate one.');
    expect(h.state.board()).toBeNull();
    await h.state.dispose();
  });

  it.each(['resolve', 'reject'] as const)(
    'late list/read/save %s after destruction cannot allocate or publish',
    async (outcome) => {
      for (const port of ['list', 'read', 'save'] as const) {
        const h = harness();
        const old = deferred<never>();
        let pending: Promise<void>;
        if (port === 'list') {
          vi.mocked(h.props.catalog.list).mockReturnValue(old.promise);
          pending = h.open();
          await flush();
        } else {
          await h.open();
          if (port === 'read') {
            vi.mocked(h.props.catalog.read).mockReturnValue(old.promise);
            pending = h.state.selectSaved(mapRefKey(summary.ref));
          } else {
            await h.state.generate();
            vi.mocked(h.props.catalog.save).mockReturnValue(old.promise);
            pending = h.state.save();
          }
        }
        await h.state.dispose();
        const phase = h.state.phase();
        const board = h.state.board();
        const maps = h.state.maps();
        if (outcome === 'reject') old.reject(new Error('Late network failure'));
        else
          old.resolve((port === 'list' ? [summary] : port === 'read' ? 'json' : summary) as never);
        await pending;
        expect(h.state.phase()).toBe(phase);
        expect(h.state.board()).toBe(board);
        expect(h.state.maps()).toBe(maps);
        expect(h.props.preparation.load).not.toHaveBeenCalled();
        expect(h.state.canStart()).toBe(false);
      }
    },
  );

  it('applies detached initialRef only before user work and retains detached ordered overrides', async () => {
    const h = harness();
    const result: CertifiedBoard = {
      ...certified(true),
      asset: {
        ...createReferenceAsset(),
        overrides: [
          { kind: 'rename', siteId: 'site1', name: 'First' },
          { kind: 'rename', siteId: 'site1', name: 'Second' },
        ],
      },
    };
    const originalOverrides = structuredClone(result.asset.overrides);
    vi.mocked(h.props.preparation.load).mockResolvedValue(result);
    h.props.initialRef = structuredClone(summary.ref);
    const opening = h.open();
    Object.assign(h.props.initialRef, { id: 'caller-change' });
    await opening;
    await flush();
    expect(h.props.catalog.read).toHaveBeenCalledWith(summary.ref, expect.any(AbortSignal));
    h.state.setSeed('42');
    h.state.setPreset('river-valley');
    h.state.setSize('10000');
    await h.state.generate();
    const recipe = vi.mocked(h.props.preparation.generate).mock.calls[0]![0];
    expect(recipe).toEqual({
      seed: 42,
      settings: { ...battlefieldPreset('river-valley').settings, widthM: 10000, heightM: 10000 },
      overrides: originalOverrides,
    });
    expect(recipe.overrides).not.toBe(result.asset.overrides);
    expect(recipe.settings).not.toBe(h.state.recipe().settings);
    expect(structuredClone(recipe)).toEqual(recipe);
    await h.state.dispose();
  });

  it('a rejected Start releases its lock while a destroyed Start cannot publish its rejection', async () => {
    const h = harness();
    vi.mocked(h.props.onStart).mockRejectedValueOnce(new Error('Precommit failure'));
    await h.open();
    await h.state.selectSaved(mapRefKey(summary.ref));
    await h.state.start();
    expect(h.state.canStart()).toBe(true);
    expect(h.state.phase()).toBe('Precommit failure');
    const old = deferred<void>();
    vi.mocked(h.props.onStart).mockReturnValue(old.promise);
    const starting = h.state.start();
    await flush();
    await h.state.start();
    await h.state.cancel();
    expect(h.props.onStart).toHaveBeenCalledTimes(2);
    expect(h.props.onCancel).not.toHaveBeenCalled();
    await h.state.dispose();
    const phase = h.state.phase();
    old.reject(new Error('Late owner failure'));
    await starting;
    expect(h.state.phase()).toBe(phase);
  });

  it('Start owner may await setup disposal inside its callback without a self-await deadlock', async () => {
    const h = harness();
    vi.mocked(h.props.onStart).mockImplementation(async () => {
      await h.state.dispose();
    });
    await h.open();
    await h.state.selectSaved(mapRefKey(summary.ref));
    await h.state.start();
    expect(h.state.closed()).toBe(true);
    expect(h.props.preparation.dispose).toHaveBeenCalledOnce();
  });

  it('refreshes callbacks without restarting setup, and isolates Start from callback mutation', async () => {
    const h = harness();
    await h.open();
    await h.state.selectSaved(mapRefKey(summary.ref));
    const retained = structuredClone(h.state.board());
    const callback = vi.fn(async (board: CertifiedBoard) => {
      Object.assign(board.asset, { name: 'Callback mutation' });
      Object.assign(board.summary.ref!, { id: 'callback-mutation' });
    });
    await h.state.configure({ ...h.props, onStart: callback });
    await h.state.start();
    expect(h.props.onStart).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledOnce();
    expect(h.state.board()).toEqual(retained);
    expect(h.props.catalog.list).toHaveBeenCalledOnce();
    await h.state.dispose();
  });

  it('new input ports await previous-owner retirement and cannot inherit a stale list', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate).mockReturnValue(old.promise);
    await h.open();
    const generating = h.state.generate();
    await flush();
    const next = harness();
    const configuring = h.state.configure(next.props);
    await flush();
    expect(h.props.preparation.dispose).toHaveBeenCalledOnce();
    expect(next.props.catalog.list).not.toHaveBeenCalled();
    old.resolve(certified());
    await Promise.all([generating, configuring]);
    await h.state.generate();
    expect(next.props.preparation.generate).toHaveBeenCalledOnce();
    expect(h.props.preparation.generate).toHaveBeenCalledOnce();
    await h.state.dispose();
  });

  it('route destruction suppresses pending cancel acknowledgement and cleanup reentry stays idempotent', async () => {
    const h = harness();
    const old = deferred<CertifiedBoard>();
    vi.mocked(h.props.preparation.generate).mockReturnValue(old.promise);
    vi.mocked(h.props.preparation.dispose).mockImplementation(() => {
      void h.state.dispose();
      throw new Error('Cleanup failed');
    });
    await h.open();
    const generating = h.state.generate();
    await flush();
    const cancelled = h.state.cancel();
    const retired = h.state.dispose();
    expect(h.state.dispose()).toBe(retired);
    old.reject(new Error('Cancelled'));
    await Promise.all([generating, cancelled, retired]);
    expect(h.props.onCancel).not.toHaveBeenCalled();
    expect(h.props.preparation.dispose).toHaveBeenCalledOnce();
  });
});
