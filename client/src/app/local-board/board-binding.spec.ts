import { webcrypto } from 'node:crypto';
import {
  assetIdentity,
  canonicalizeAsset,
  canonicalGeometry,
  createReferenceAsset,
  type MapAsset,
} from '@kriegsspiel/maps';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import {
  createLocalBoardBinding,
  snapshotCertifiedBoard,
  validateLocalBinding,
  validateLocalPresentation,
} from './board-binding';
import type { LocalBoardBinding, LocalPresentation } from './contracts';

// Analytic contract fixture: complete certification belongs to A2, not these boundary tests.
let board: CertifiedBoard;
let binding: LocalBoardBinding;
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const asset = createReferenceAsset();
  board = {
    asset,
    canonicalJson: canonicalizeAsset(asset),
    assetIdentity: await assetIdentity(asset, 'asset'),
    bounds: asset.bounds,
    summary: {
      name: asset.name,
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
      ref: { kind: 'premade', id: 'analytic-test' },
    },
  };
  binding = await createLocalBoardBinding(board, new AbortController().signal);
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const presentation = (): LocalPresentation => ({
  binding,
  marks: [
    { id: 'fractional', label: '<Manual>', geometry: { kind: 'pin', at: { x: 12.25, y: 32.125 } } },
  ],
  gameMs: 0,
  rate: 0,
  pieces: [],
  roster: [],
  papers: [],
});

describe('fixed local board binding', () => {
  it('binds the full canonical identity and freezes detached geography and registration', async () => {
    const input = structuredClone(board);
    const pending = createLocalBoardBinding(input, new AbortController().signal);
    (input.asset as MapAsset).name = 'Caller mutation';
    const result = await pending;
    expect(result).toEqual({
      assetIdentity: board.assetIdentity,
      revision: board.assetIdentity,
      mapId: `local-map:${board.assetIdentity}`,
      bounds: board.bounds,
      registration: { origin: 'north-west', units: 'metres', xAxis: 'east', yAxis: 'south' },
    });
    expect(Object.isFrozen(result.bounds)).toBe(true);
    expect(Object.isFrozen(result.registration)).toBe(true);
    const snapshot = snapshotCertifiedBoard(board);
    expect(snapshot.asset).not.toBe(board.asset);
    expect(Object.isFrozen(snapshot.asset.layers.landmarks)).toBe(true);
  });
  it('rejects a label substitution even when the geometry identity is unchanged', async () => {
    const changed = structuredClone(board.asset) as MapAsset;
    changed.layers.landmarks[0]!.name = 'Different landmark';
    expect(canonicalGeometry(changed)).toBe(canonicalGeometry(board.asset as MapAsset));
    await expect(
      createLocalBoardBinding(
        { ...board, asset: changed, canonicalJson: canonicalizeAsset(changed) },
        new AbortController().signal,
      ),
    ).rejects.toThrow('identity');
  });
  it.each(['canonical', 'minX', 'maxY', 'summaryWidth', 'summaryName', 'identity'])(
    'rejects divergent %s before identity work',
    async (field) => {
      const input = structuredClone(board);
      if (field === 'canonical')
        Object.assign(input, { canonicalJson: input.canonicalJson + '\n' });
      if (field === 'minX') Object.assign(input.bounds, { minX: 1 });
      if (field === 'maxY') Object.assign(input.bounds, { maxY: 151 });
      if (field === 'summaryWidth') Object.assign(input.summary, { widthM: 149 });
      if (field === 'summaryName') Object.assign(input.summary, { name: 'Different name' });
      if (field === 'identity') Object.assign(input, { assetIdentity: 'not-full-hash' });
      const identity = vi.fn(async () => board.assetIdentity);
      await expect(
        createLocalBoardBinding(input, new AbortController().signal, identity),
      ).rejects.toThrow();
      expect(identity).not.toHaveBeenCalled();
    },
  );
  it('checks cancellation before hashing and after delayed hash success/rejection', async () => {
    const abort = new AbortController();
    abort.abort();
    const identity = vi.fn(async () => board.assetIdentity);
    await expect(createLocalBoardBinding(board, abort.signal, identity)).rejects.toThrow(
      'cancelled',
    );
    expect(identity).not.toHaveBeenCalled();
    let resolve!: (value: string) => void;
    const hash = new Promise<string>((r) => {
      resolve = r;
    });
    const next = new AbortController();
    const pending = createLocalBoardBinding(board, next.signal, () => hash);
    next.abort();
    resolve(board.assetIdentity);
    await expect(pending).rejects.toThrow('cancelled');
    const rejected = new AbortController();
    let reject!: (error: Error) => void;
    const failure = createLocalBoardBinding(
      board,
      rejected.signal,
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    rejected.abort();
    reject(new Error('late hash failure'));
    await expect(failure).rejects.toThrow('late hash failure');
  });
  it.each(['revision', 'mapId', 'origin', 'units', 'xAxis', 'yAxis', 'extra'])(
    'rejects malformed binding %s',
    (field) => {
      const value = structuredClone(binding);
      if (field === 'revision' || field === 'mapId') Object.assign(value, { [field]: 'wrong' });
      else if (field === 'extra') Object.assign(value, { capability: 'live' });
      else Object.assign(value.registration, { [field]: 'wrong' });
      expect(() => validateLocalBinding(value)).toThrow();
    },
  );
});

describe('render-only local presentation', () => {
  it('detaches and freezes marks without rounding metre positions', () => {
    const input = presentation();
    const parsed = validateLocalPresentation(input, binding);
    Object.assign(input.marks[0]!.geometry, { at: { x: 1, y: 1 } });
    expect(parsed.marks[0]!.geometry).toEqual({ kind: 'pin', at: { x: 12.25, y: 32.125 } });
    expect(Object.isFrozen(parsed.marks[0]!.geometry)).toBe(true);
    expect(parsed).toMatchObject({ gameMs: 0, rate: 0, pieces: [], roster: [], papers: [] });
  });
  it.each([
    'binding',
    'time',
    'rate',
    'pieces',
    'roster',
    'papers',
    'provenance',
    'duplicate',
    'outside',
    'extra',
    'missingMarks',
  ])('rejects %s', (field) => {
    const input = presentation();
    if (field === 'binding')
      Object.assign(input, {
        binding: {
          ...binding,
          assetIdentity: 'f'.repeat(64),
          revision: 'f'.repeat(64),
          mapId: `local-map:${'f'.repeat(64)}`,
        },
      });
    if (field === 'time') Object.assign(input, { gameMs: 1 });
    if (field === 'rate') Object.assign(input, { rate: 1 });
    if (['pieces', 'roster', 'papers'].includes(field)) Object.assign(input, { [field]: [{}] });
    if (field === 'provenance') Object.assign(input.marks[0]!, { source: { kind: 'manual' } });
    if (field === 'duplicate') Object.assign(input, { marks: [input.marks[0], input.marks[0]] });
    if (field === 'outside') Object.assign(input.marks[0]!.geometry, { at: { x: 150.001, y: 20 } });
    if (field === 'extra') Object.assign(input, { live: true });
    if (field === 'missingMarks') Object.assign(input, { marks: undefined });
    expect(() => validateLocalPresentation(input, binding)).toThrow();
  });
});
