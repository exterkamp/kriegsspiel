import { describe, expect, it, vi } from 'vitest';
import type {
  HqSnapshot,
  MarkCreateInput,
  MarkGeometry,
  PersonalMark,
  PersonalMarksDocument,
  PersonalMarksRepository,
  PublicArtwork,
  Result,
  Scope,
} from '../../contracts/index.js';
import type { StoragePort } from '../repository.js';
import { failure, success } from '../common.js';
import {
  BrowserPersonalMarksRepository,
  createPersonalMark,
  createPersonalMarksController,
  editPersonalMark,
  validateMarks,
} from './index.js';

const scope: Scope = { gameId: 'game', sideId: 'blue', playerId: 'general' };
const artwork: PublicArtwork = {
  kind: 'public-artwork',
  id: 'hq-schematic',
  revision: '2',
  widthM: 4000,
  heightM: 3000,
  image: { url: '/hq-preview.svg', pixelWidth: 1200, pixelHeight: 900 },
  registration: 'full-image-nw-origin',
  credit: 'HQ fixture',
  licence: 'Project fixture',
  sourceUrl: null,
};
const input: MarkCreateInput = {
  label: 'Bridge',
  geometry: { kind: 'pin', at: { x: 2050.125, y: 1500.875 } },
  source: { kind: 'manual' },
};
const op = () => ({ signal: new AbortController().signal });
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function code(result: Result<unknown>, expected: string): void {
  expect(result).toMatchObject({ ok: false, error: { code: expected } });
}
function makeMark(id = 'mark', gameMs: number | null = 100): PersonalMark {
  return value(createPersonalMark(input, { scope, artwork, snapshot: null, gameMs }, () => id));
}
const document = (
  marks: readonly PersonalMark[] = [],
  revision = 'baseline',
): PersonalMarksDocument => ({
  schemaVersion: 1,
  scope,
  map: { id: artwork.id, revision: artwork.revision },
  revision,
  marks,
});
const key = (s = scope) =>
  JSON.stringify(['kriegsspiel.hq.personal-marks', s.gameId, s.sideId, s.playerId]);
class Memory implements StoragePort {
  values = new Map<string, string>();
  getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  setItem = vi.fn((key: string, text: string) => {
    this.values.set(key, text);
  });
}
function setup(storage = new Memory(), s = scope, a = artwork) {
  let revision = 0;
  return {
    storage,
    repo: new BrowserPersonalMarksRepository(
      s,
      a,
      () => storage,
      () => `revision-${++revision}`,
    ),
  };
}
function snapshot(): HqSnapshot {
  return {
    scope,
    epoch: 'fixture',
    ordinal: 1,
    authorityRevision: null,
    atGame: 300,
    clock: {
      authoritativeGameMs: 300,
      receivedMonotonicMs: 0,
      status: 'paused',
      mode: 'manual',
      rate: 1,
      barrier: { kind: 'clear' },
      coherence: 'fixture-atomic',
    },
    roster: [],
    pieces: [],
    papers: [
      {
        id: 'paper',
        from: 'Scout',
        category: 'scouts',
        writtenAtGame: 100,
        receivedAtGame: 200,
        observedAtGame: null,
        location: { x: 23, y: 45 },
        unitId: null,
        sizeEstimate: null,
        confidence: null,
        text: 'Public report '.repeat(100),
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fakeRepository() {
  const initial = deferred<Result<PersonalMarksDocument>>();
  const saved = deferred<Result<PersonalMarksDocument>>();
  const reloaded = deferred<Result<PersonalMarksDocument>>();
  const repo: PersonalMarksRepository = {
    scope,
    artwork,
    load: vi.fn().mockReturnValueOnce(initial.promise).mockReturnValue(reloaded.promise),
    save: vi.fn().mockReturnValue(saved.promise),
    dispose: vi.fn(),
  };
  return { repo, initial, saved, reloaded };
}

describe('strict mark helpers', () => {
  const shapes: MarkGeometry[] = [
    { kind: 'pin', at: { x: 0, y: 3000 } },
    {
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 4000, y: 3000 },
      ],
    },
    {
      kind: 'arrow',
      points: [
        { x: 300.125, y: 245.875 },
        { x: 800, y: 900 },
      ],
    },
    { kind: 'ring', centre: { x: 4000, y: 3000 }, radiusM: 5000 },
    { kind: 'symbol', at: { x: 4000, y: 0 }, symbol: 'flag' },
  ];
  it.each(shapes)('accepts finite inclusive metre geometry: $kind', (geometry) => {
    const mark = value(
      createPersonalMark(
        { ...input, geometry },
        { scope, artwork, snapshot: null, gameMs: null },
        () => 'id',
      ),
    );
    expect(mark.geometry).toEqual(geometry);
    expect(mark.placedAtGame).toBeNull();
    expect(Object.isFrozen(mark.geometry)).toBe(true);
  });
  it.each(['cross', 'dot', 'flag'] as const)(
    'accepts symbol %s without classifying a unit',
    (symbol) => {
      expect(
        value(
          validateMarks(
            [{ ...makeMark(), geometry: { kind: 'symbol', at: { x: 1, y: 2 }, symbol } }],
            scope,
            artwork,
          ),
        )[0]!.source,
      ).toEqual({ kind: 'manual' });
    },
  );
  it('enforces all geometry, ID, label and document limits without mutation', () => {
    const invalid = [
      { kind: 'pin', at: { x: -1e-6, y: 0 } },
      { kind: 'pin', at: { x: 4000 + 1e-6, y: 0 } },
      { kind: 'pin', at: { x: 0, y: NaN } },
      { kind: 'pin', at: { x: Infinity, y: 0 } },
      { kind: 'polyline', points: [{ x: 1, y: 2 }] },
      { kind: 'arrow', points: Array.from({ length: 257 }, () => ({ x: 1, y: 2 })) },
      { kind: 'ring', centre: { x: 1, y: 2 }, radiusM: 0 },
      { kind: 'ring', centre: { x: 1, y: 2 }, radiusM: 5000.001 },
      { kind: 'symbol', at: { x: 1, y: 2 }, symbol: 'enemy' },
      { kind: 'pin', at: { x: 1, y: 2, truth: true } },
    ];
    for (const geometry of invalid)
      code(validateMarks([{ ...makeMark(), geometry }], scope, artwork), 'invalid-data');
    for (const patch of [
      { id: '' },
      { id: 'x'.repeat(129) },
      { label: 'x'.repeat(257) },
      { hidden: 1 },
      { placedAtGame: -1 },
      { placedAtGame: Number.MAX_SAFE_INTEGER + 1 },
    ])
      code(validateMarks([{ ...makeMark(), ...patch }], scope, artwork), 'invalid-data');
    code(validateMarks([makeMark(), makeMark()], scope, artwork), 'invalid-data');
    code(
      validateMarks(
        Array.from({ length: 201 }, (_, i) => makeMark(`id-${i}`)),
        scope,
        artwork,
      ),
      'invalid-data',
    );
    expect(
      value(
        validateMarks(
          Array.from({ length: 200 }, (_, i) => makeMark(`id-${i}`)),
          scope,
          artwork,
        ),
      ),
    ).toHaveLength(200);
    expect(
      value(
        validateMarks(
          [
            {
              ...makeMark(),
              geometry: {
                kind: 'polyline',
                points: Array.from({ length: 256 }, () => ({ x: 1, y: 2 })),
              },
            },
          ],
          scope,
          artwork,
        ),
      ),
    ).toHaveLength(1);
  });
  it('rejects nested scope/artifact and unknown-field injection', () => {
    code(
      validateMarks([{ ...makeMark(), scope: { ...scope, playerId: 'other' } }], scope, artwork),
      'scope-mismatch',
    );
    code(
      validateMarks([{ ...makeMark(), map: { id: artwork.id, revision: '1' } }], scope, artwork),
      'conflict',
    );
    code(
      createPersonalMark(
        { ...input, source: { kind: 'manual', writtenAtGame: 10 } } as MarkCreateInput,
        { scope, artwork, snapshot: null, gameMs: null },
      ),
      'invalid-data',
    );
    code(
      editPersonalMark(
        makeMark(),
        { label: 'Changed', geometry: input.geometry, source: { kind: 'manual' } } as never,
        artwork,
        200,
      ),
      'invalid-data',
    );
  });
  it('returns a deeply immutable clone independent of input', () => {
    const raw = structuredClone(makeMark());
    const parsed = value(validateMarks([raw], scope, artwork));
    (raw.geometry as { at: { x: number } }).at.x = 999;
    expect((parsed[0]!.geometry as { at: { x: number } }).at.x).toBe(2050.125);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed[0]!.scope as { playerId: string }).playerId = 'other';
    }).toThrow();
  });
  it('copies paper provenance once and preserves it across geometry edits and fresh reports', () => {
    const snap = snapshot();
    const mark = value(
      createPersonalMark(
        { ...input, source: { kind: 'paper', paperId: 'paper' } },
        { scope, artwork, snapshot: snap, gameMs: 300 },
        () => 'paper-mark',
      ),
    );
    expect(mark.source).toMatchObject({
      kind: 'paper',
      observedAtGame: null,
      reportedLocation: { x: 23, y: 45 },
    });
    expect((mark.source as { excerpt: string }).excerpt).toHaveLength(512);
    (snap.papers[0] as { text: string }).text = 'A newer report';
    (snap.papers[0]!.location as { x: number }).x = 1000;
    const changed = value(
      editPersonalMark(
        mark,
        { label: 'Move belief', geometry: { kind: 'pin', at: { x: 99, y: 101 } } },
        artwork,
        400,
      ),
    );
    expect(changed.source).toEqual(mark.source);
    expect(changed.placedAtGame).toBe(300);
    expect(changed.editedAtGame).toBe(400);
    expect(changed.id).toBe(mark.id);
    code(
      editPersonalMark(changed, { label: 'Earlier', geometry: input.geometry }, artwork, 399),
      'invalid-data',
    );
    code(
      editPersonalMark(changed, { label: 'Erase date', geometry: input.geometry }, artwork, null),
      'invalid-data',
    );
  });
  it('fails missing, conflicting, wrong-scope and chronologically invalid papers', () => {
    const paperInput: MarkCreateInput = { ...input, source: { kind: 'paper', paperId: 'paper' } };
    const create = (snap: HqSnapshot | null, gameMs: number | null = 300) =>
      createPersonalMark(paperInput, { scope, artwork, snapshot: snap, gameMs });
    code(create(null), 'not-ready');
    code(create({ ...snapshot(), papers: [] }), 'not-found');
    code(create({ ...snapshot(), scope: { ...scope, sideId: 'red' } }), 'scope-mismatch');
    const snap = snapshot();
    code(create({ ...snap, papers: [snap.papers[0]!, snap.papers[0]!] }), 'conflict');
    code(create(snap, 199), 'invalid-data');
    for (const patch of [
      { writtenAtGame: 201 },
      { observedAtGame: 101 },
      { receivedAtGame: 301 },
      { writtenAtGame: -1 },
      { receivedAtGame: Infinity },
    ])
      code(create({ ...snap, papers: [{ ...snap.papers[0]!, ...patch }] }), 'invalid-data');
    code(
      createPersonalMark(
        { ...input, source: { kind: 'paper', paperId: 'paper', receivedAtGame: 1 } } as never,
        { scope, artwork, snapshot: snap, gameMs: 300 },
      ),
      'invalid-data',
    );
    code(
      createPersonalMark(input, { scope, artwork, snapshot: null, gameMs: null }, () => ''),
      'invalid-data',
    );
  });
});

describe('browser personal marks repository', () => {
  it('requires load, preserves absent revision, saves and reloads all shapes', async () => {
    const { repo, storage } = setup();
    code(await repo.save([], 'unknown', op()), 'not-ready');
    const loaded = value(await repo.load(op()));
    expect(value(await repo.load(op())).revision).toBe(loaded.revision);
    const shapes: MarkGeometry[] = [
      input.geometry,
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 40 },
        ],
      },
      {
        kind: 'arrow',
        points: [
          { x: 1, y: 1 },
          { x: 10, y: 20 },
        ],
      },
      { kind: 'ring', centre: { x: 100, y: 200 }, radiusM: 300 },
      { kind: 'symbol', at: { x: 1, y: 2 }, symbol: 'cross' },
    ];
    const marks = shapes.map((geometry, i) =>
      value(
        createPersonalMark(
          { ...input, geometry },
          { scope, artwork, snapshot: null, gameMs: null },
          () => `id-${i}`,
        ),
      ),
    );
    const saved = value(await repo.save(marks, loaded.revision, op()));
    expect(saved.revision).not.toBe(loaded.revision);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    repo.dispose();
    expect(value(await setup(storage).repo.load(op()))).toEqual(saved);
  });
  it('clones immutable binding and isolates game, side, player and artifact', async () => {
    const s = { ...scope },
      a = structuredClone(artwork);
    const { repo, storage } = setup(new Memory(), s, a);
    s.playerId = 'wrong';
    (a.image as { url: string }).url = '/private';
    expect(repo.scope).toEqual(scope);
    expect(repo.artwork.image.url).toBe('/hq-preview.svg');
    expect(Object.isFrozen(repo.artwork.image)).toBe(true);
    const base = value(await repo.load(op()));
    await repo.save([makeMark()], base.revision, op());
    for (const changed of [
      { ...scope, gameId: 'other' },
      { ...scope, sideId: 'red' },
      { ...scope, playerId: 'other' },
    ])
      expect(value(await setup(storage, changed).repo.load(op())).marks).toEqual([]);
    code(await setup(storage, scope, { ...artwork, revision: '3' }).repo.load(op()), 'conflict');
    const preserved = storage.values.get(key());
    code(await setup(storage, scope, { ...artwork, id: 'other' }).repo.load(op()), 'conflict');
    expect(storage.values.get(key())).toBe(preserved);
  });
  it.each([
    ['corrupt', '{bad', 'invalid-data'],
    ['future', JSON.stringify({ ...document(), schemaVersion: 2 }), 'migration-required'],
    ['oversized', ' '.repeat(1_048_577), 'invalid-data'],
    [
      'wrong-scope',
      JSON.stringify({ ...document(), scope: { ...scope, playerId: 'other' } }),
      'scope-mismatch',
    ],
    [
      'wrong-artifact',
      JSON.stringify({ ...document(), map: { id: artwork.id, revision: '1' } }),
      'conflict',
    ],
    ['unknown-field', JSON.stringify({ ...document(), truth: {} }), 'invalid-data'],
  ])('preserves %s records and refuses saving', async (_name, raw, expected) => {
    const { repo, storage } = setup();
    storage.values.set(key(), raw);
    code(await repo.load(op()), expected);
    code(await repo.save([], 'baseline', op()), 'not-ready');
    expect(storage.values.get(key())).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('detects exact raw changes even with equal revision and requires reload', async () => {
    const { repo, storage } = setup();
    storage.values.set(key(), JSON.stringify(document([makeMark()])));
    const initial = value(await repo.load(op()));
    storage.values.set(key(), JSON.stringify(document([makeMark()]), null, 2));
    code(await repo.save(initial.marks, initial.revision, op()), 'conflict');
    code(await repo.save(initial.marks, initial.revision, op()), 'conflict');
    const reloaded = value(await repo.load(op()));
    expect(value(await repo.save(reloaded.marks, reloaded.revision, op())).revision).not.toBe(
      reloaded.revision,
    );
  });
  it('detects external deletion, then explicitly reloads a new empty revision', async () => {
    const { repo, storage } = setup();
    const initial = value(await repo.load(op()));
    const persisted = value(await repo.save([makeMark()], initial.revision, op()));
    storage.values.delete(key());
    code(await repo.save(persisted.marks, persisted.revision, op()), 'conflict');
    expect(storage.values.has(key())).toBe(false);
    const empty = value(await repo.load(op()));
    expect(empty.marks).toEqual([]);
    expect(empty.revision).not.toBe(persisted.revision);
    expect(value(await repo.load(op())).revision).toBe(empty.revision);
  });
  it.each(['QuotaExceededError', 'SecurityError'])(
    'preserves baseline after %s and allows same-revision retry',
    async (name) => {
      const { repo, storage } = setup();
      const baseline = value(await repo.load(op()));
      storage.setItem.mockImplementationOnce(() => {
        throw Object.assign(new Error('secret storage detail'), { name });
      });
      const failed = await repo.save([makeMark()], baseline.revision, op());
      code(failed, name === 'QuotaExceededError' ? 'quota-exceeded' : 'storage-unavailable');
      expect(JSON.stringify(failed)).not.toContain('secret');
      expect(storage.values.has(key())).toBe(false);
      expect(value(await repo.save([makeMark()], baseline.revision, op())).marks).toHaveLength(1);
    },
  );
  it('preserves baseline on read denial and rejects oversized outgoing serialized records', async () => {
    const { repo, storage } = setup();
    const baseline = value(await repo.load(op()));
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('access denied');
    });
    code(await repo.save([makeMark()], baseline.revision, op()), 'storage-unavailable');
    const large = Array.from({ length: 200 }, (_, i) => ({
      ...makeMark(`mark-${i}`),
      geometry: {
        kind: 'polyline' as const,
        points: Array.from({ length: 256 }, () => ({
          x: 1234.123456789012,
          y: 2345.123456789012,
        })),
      },
    }));
    code(await repo.save(large, baseline.revision, op()), 'invalid-data');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(value(await repo.save([makeMark()], baseline.revision, op())).marks).toHaveLength(1);
  });
  it('rejects cloned rewrites of immutable provenance and backward edit dates', async () => {
    const { repo } = setup();
    const baseline = value(await repo.load(op()));
    const mark = makeMark();
    const saved = value(await repo.save([mark], baseline.revision, op()));
    const rewritten = structuredClone(mark);
    (rewritten.source as { kind: string }).kind = 'paper';
    code(await repo.save([{ ...mark, placedAtGame: 101 }], saved.revision, op()), 'conflict');
    await repo.load(op());
    const edit = value(
      editPersonalMark(mark, { label: 'Changed', geometry: input.geometry }, artwork, 200),
    );
    const edited = value(await repo.save([edit], saved.revision, op()));
    code(await repo.save([{ ...edit, editedAtGame: 199 }], edited.revision, op()), 'invalid-data');
    expect(value(await repo.load(op())).marks[0]!.source).toEqual(mark.source);
  });
  it('captures save inputs at submission and serializes competing requests', async () => {
    const { repo, storage } = setup();
    const baseline = value(await repo.load(op()));
    const marks = [structuredClone(makeMark())];
    const first = repo.save(marks, baseline.revision, op());
    const second = repo.save([], baseline.revision, op());
    (marks[0]! as { label: string }).label = 'Mutated caller';
    const saved = value(await first);
    expect(saved.marks[0]!.label).toBe('Bridge');
    code(await second, 'conflict');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it('rejects cancellation at queue entry and immediately before the browser write', async () => {
    const { repo, storage } = setup();
    const baseline = value(await repo.load(op()));
    const queued = new AbortController();
    const pending = repo.save([makeMark()], baseline.revision, { signal: queued.signal });
    queued.abort();
    code(await pending, 'aborted');
    const boundary = new AbortController();
    storage.getItem.mockImplementationOnce(() => {
      boundary.abort();
      return null;
    });
    code(await repo.save([makeMark()], baseline.revision, { signal: boundary.signal }), 'aborted');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(['abort', 'dispose'])(
    'reports committed success if %s fires inside a successful write',
    async (action) => {
      const { repo, storage } = setup();
      const baseline = value(await repo.load(op()));
      const abort = new AbortController();
      storage.setItem.mockImplementationOnce((key, text) => {
        storage.values.set(key, text);
        if (action === 'abort') abort.abort();
        else repo.dispose();
      });
      const saved = value(
        await repo.save([makeMark()], baseline.revision, { signal: abort.signal }),
      );
      expect(JSON.parse(storage.values.get(key())!)).toEqual(saved);
      if (action === 'dispose') {
        code(await repo.load(op()), 'disposed');
        code(await repo.save([], saved.revision, op()), 'disposed');
      }
    },
  );
  it('does not accept a canceled load or reuse the same generated revision', async () => {
    const storage = new Memory();
    const abort = new AbortController();
    storage.getItem.mockImplementationOnce(() => {
      abort.abort();
      return null;
    });
    const repo = new BrowserPersonalMarksRepository(
      scope,
      artwork,
      () => storage,
      () => 'fixed',
    );
    code(await repo.load({ signal: abort.signal }), 'aborted');
    code(await repo.save([], 'fixed', op()), 'not-ready');
    const loaded = value(await repo.load(op()));
    code(await repo.save([], loaded.revision, op()), 'internal');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('explicit-save personal marks controller', () => {
  it('guards delayed initialization, isolates listeners, and validates late load results', async () => {
    const fake = fakeRepository();
    const controller = createPersonalMarksController(fake.repo);
    expect(controller.getState()).toMatchObject({ phase: 'loading', busy: true, writable: false });
    controller.subscribe(() => {
      throw new Error('bad listener');
    });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    const pending = controller.initialize();
    code(controller.create(input, null, null), 'conflict');
    code(controller.remove('mark'), 'conflict');
    code(await controller.save(), 'conflict');
    code(await controller.reload(), 'conflict');
    code(await controller.initialize(), 'conflict');
    fake.initial.resolve(success(document()));
    value(await pending);
    expect(controller.getState()).toMatchObject({ phase: 'ready', busy: false, writable: true });
    unsubscribe();
    const count = listener.mock.calls.length;
    value(controller.create(input, null, null));
    expect(listener).toHaveBeenCalledTimes(count);
    expect(Object.isFrozen(controller.getState().marks)).toBe(true);
  });
  it('updates RAM only, rejects all mutations during save, and clears dirty on confirmed commit', async () => {
    const fake = fakeRepository();
    const controller = createPersonalMarksController(fake.repo);
    const initialized = controller.initialize();
    fake.initial.resolve(success(document()));
    await initialized;
    value(controller.create(input, snapshot(), 300));
    const mark = controller.getState().marks[0]!;
    value(controller.edit(mark.id, { label: 'Local edit', geometry: input.geometry }, 400));
    expect(fake.repo.save).not.toHaveBeenCalled();
    const captured = controller.getState().marks;
    const saving = controller.save();
    code(controller.create(input, snapshot(), 500), 'conflict');
    code(controller.edit(mark.id, { label: 'Newer', geometry: input.geometry }, 500), 'conflict');
    code(controller.remove(mark.id), 'conflict');
    code(await controller.reload(), 'conflict');
    code(await controller.save(), 'conflict');
    const refreshed = snapshot();
    (refreshed.papers[0] as { text: string }).text = 'Changed source during save';
    fake.saved.resolve(success(document(captured, 'saved')));
    value(await saving);
    expect(controller.getState()).toMatchObject({
      phase: 'ready',
      dirty: false,
      busy: false,
      marks: captured,
    });
    value(controller.remove(mark.id));
    expect(controller.getState()).toMatchObject({ dirty: true, marks: [] });
  });
  it('retains dirty edits across quota/save failure and retries using the valid revision', async () => {
    const { repo, storage } = setup();
    const controller = createPersonalMarksController(repo);
    value(await controller.initialize());
    value(controller.create(input, null, null));
    const edits = controller.getState().marks;
    storage.setItem.mockImplementationOnce(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    code(await controller.save(), 'quota-exceeded');
    expect(controller.getState()).toMatchObject({
      marks: edits,
      dirty: true,
      writable: true,
      busy: false,
    });
    value(await controller.save());
    expect(controller.getState().dirty).toBe(false);
  });
  it('keeps conflict blocking until successful reload, even when reload fails with access denial', async () => {
    const { repo, storage } = setup();
    const controller = createPersonalMarksController(repo);
    value(await controller.initialize());
    value(controller.create(input, null, null));
    const edits = controller.getState().marks;
    storage.values.set(key(), JSON.stringify(document([], 'external')));
    code(await controller.save(), 'conflict');
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('access denied');
    });
    code(await controller.reload(), 'storage-unavailable');
    expect(controller.getState()).toMatchObject({
      marks: edits,
      dirty: true,
      writable: false,
      phase: 'blocked',
    });
    code(await controller.save(), 'not-ready');
    value(await controller.reload());
    expect(controller.getState()).toMatchObject({ marks: [], dirty: false, writable: true });
  });
  it('preserves RAM when reload encounters corrupt/future records and blocks further editing', async () => {
    const { repo, storage } = setup();
    const controller = createPersonalMarksController(repo);
    await controller.initialize();
    controller.create(input, null, null);
    const edits = controller.getState().marks;
    storage.values.set(key(), JSON.stringify({ ...document(), schemaVersion: 2 }));
    code(await controller.reload(), 'migration-required');
    expect(controller.getState()).toMatchObject({ marks: edits, dirty: true, writable: false });
    code(controller.create(input, null, null), 'not-ready');
    code(controller.remove(edits[0]!.id), 'not-ready');
  });
  it('rejects invalid scope/artifact load and mismatched save response before reconciliation', async () => {
    const fake = fakeRepository();
    const controller = createPersonalMarksController(fake.repo);
    const initial = controller.initialize();
    fake.initial.resolve(success({ ...document(), scope: { ...scope, playerId: 'other' } }));
    code(await initial, 'scope-mismatch');
    expect(controller.getState().marks).toEqual([]);
    const reload = controller.reload();
    fake.reloaded.resolve(success(document()));
    await reload;
    controller.create(input, null, null);
    const marks = controller.getState().marks;
    const saved = controller.save();
    fake.saved.resolve(success(document([], 'new')));
    code(await saved, 'invalid-data');
    expect(controller.getState()).toMatchObject({ marks, dirty: true, writable: false });
  });
  it.each(['success', 'failure', 'throw'])(
    'ignores late initial-load %s after terminal disposal',
    async (outcome) => {
      const fake = fakeRepository();
      const controller = createPersonalMarksController(fake.repo);
      const listener = vi.fn();
      controller.subscribe(listener);
      const loading = controller.initialize();
      controller.dispose();
      controller.dispose();
      const count = listener.mock.calls.length;
      if (outcome === 'success') fake.initial.resolve(success(document([makeMark()])));
      else if (outcome === 'failure')
        fake.initial.resolve(failure('storage-unavailable', 'No storage'));
      else fake.initial.reject(new Error('late failure'));
      code(await loading, 'disposed');
      expect(listener).toHaveBeenCalledTimes(count);
      expect(fake.repo.dispose).toHaveBeenCalledTimes(1);
      expect(controller.getState()).toMatchObject({
        phase: 'disposed',
        marks: [],
        writable: false,
      });
      const final = vi.fn();
      controller.subscribe(final);
      expect(final).toHaveBeenCalledTimes(1);
      code(controller.create(input, null, null), 'disposed');
      code(await controller.reload(), 'disposed');
    },
  );
  it.each(['success', 'failure'])(
    'does not revive the controller after late save %s',
    async (outcome) => {
      const fake = fakeRepository();
      const controller = createPersonalMarksController(fake.repo);
      const init = controller.initialize();
      fake.initial.resolve(success(document()));
      await init;
      controller.create(input, null, null);
      const marks = controller.getState().marks;
      const saving = controller.save();
      controller.dispose();
      fake.saved.resolve(
        outcome === 'success'
          ? success(document(marks, 'committed'))
          : failure('quota-exceeded', 'Full'),
      );
      const result = await saving;
      if (outcome === 'success') value(result);
      else code(result, 'disposed');
      expect(controller.getState()).toMatchObject({
        phase: 'disposed',
        marks,
        dirty: true,
        writable: false,
      });
    },
  );
  it('does not let a busy notification subscriber start a concurrent mutation or revive disposed state', async () => {
    const fake = fakeRepository();
    const controller = createPersonalMarksController(fake.repo);
    const init = controller.initialize();
    fake.initial.resolve(success(document()));
    await init;
    controller.subscribe((state) => {
      if (state.phase === 'saving') {
        code(controller.create(input, null, null), 'conflict');
        controller.dispose();
      }
    });
    code(await controller.save(), 'disposed');
    expect(fake.repo.save).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe('disposed');
  });
});

describe('marks boundary and lifetime repairs', () => {
  it('keeps an oversized valid draft editable and saves after edit/removal recovery', async () => {
    const { repo, storage } = setup();
    const controller = createPersonalMarksController(repo);
    value(await controller.initialize());
    value(controller.create(input, null, null));
    value(await controller.save());
    const persisted = storage.values.get(key());
    storage.setItem.mockClear();
    const geometry: MarkGeometry = {
      kind: 'polyline',
      points: Array.from({ length: 256 }, () => ({
        x: 1234.123456789012,
        y: 2345.123456789012,
      })),
    };
    for (let i = 0; i < 100; i++) value(controller.create({ ...input, geometry }, null, null));
    const draft = controller.getState().marks;
    expect(value(validateMarks(draft, scope, artwork))).toHaveLength(101);
    expect(JSON.stringify(document(draft)).length).toBeGreaterThan(1_048_576);
    code(await controller.save(), 'invalid-data');
    expect(controller.getState()).toMatchObject({
      phase: 'ready',
      busy: false,
      writable: true,
      dirty: true,
      marks: draft,
    });
    expect(controller.getState().marks).toBe(draft);
    expect(storage.values.get(key())).toBe(persisted);
    expect(storage.setItem).not.toHaveBeenCalled();
    value(controller.edit(draft[1]!.id, { label: 'Reduced', geometry: input.geometry }, null));
    for (const mark of draft.slice(2, 26)) value(controller.remove(mark.id));
    const recovered = controller.getState().marks;
    value(await controller.save());
    expect(controller.getState()).toMatchObject({ dirty: false, writable: true });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.values.get(key())!).marks).toEqual(recovered);
    value(await controller.reload());
    expect(controller.getState().marks).toEqual(recovered);
  });

  it('counts the document header and generated revision in the exact record budget', async () => {
    const marks = Array.from({ length: 100 }, (_, i) => ({
      ...makeMark(`mark-${i}`),
      geometry: {
        kind: 'polyline' as const,
        points: Array.from({ length: 256 }, () => ({
          x: 1234.123456789012,
          y: 2345.123456789012,
        })),
      },
    }));
    let removed = marks.pop()!;
    while (JSON.stringify(document(marks, 'a')).length > 1_048_576) removed = marks.pop()!;
    marks.push(removed);
    while (JSON.stringify(document(marks, 'a')).length > 1_048_576) removed.geometry.points.pop();
    removed.label += ' '.repeat(1_048_576 - JSON.stringify(document(marks, 'a')).length);
    expect(JSON.stringify(document(marks, 'a')).length).toBe(1_048_576);
    expect(JSON.stringify(marks).length).toBeLessThan(1_048_576);
    value(validateMarks(marks, scope, artwork));
    const storage = new Memory();
    const revision = vi.fn().mockReturnValueOnce('a').mockReturnValue('r'.repeat(128));
    const repo = new BrowserPersonalMarksRepository(scope, artwork, () => storage, revision);
    const baseline = value(await repo.load(op()));
    code(await repo.save(marks, baseline.revision, op()), 'invalid-data');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
    const exactStorage = new Memory();
    const exactRevision = vi.fn().mockReturnValueOnce('b').mockReturnValue('a');
    const exactRepo = new BrowserPersonalMarksRepository(
      scope,
      artwork,
      () => exactStorage,
      exactRevision,
    );
    const exactBaseline = value(await exactRepo.load(op()));
    value(await exactRepo.save(marks, exactBaseline.revision, op()));
    expect(exactStorage.values.get(key())!.length).toBe(1_048_576);
    expect(value(await exactRepo.load(op())).marks).toEqual(marks);
  });

  it.each(['abort', 'dispose'])(
    'honors %s inside a storage-mutating revision callback',
    async (action) => {
      const storage = new Memory();
      storage.values.set(key(), JSON.stringify(document([makeMark()])));
      const external = JSON.stringify(document([], 'external'));
      const abort = new AbortController();
      const repo = new BrowserPersonalMarksRepository(
        scope,
        artwork,
        () => storage,
        () => {
          storage.values.set(key(), external);
          if (action === 'abort') abort.abort();
          else repo.dispose();
          return 'new';
        },
      );
      const baseline = value(await repo.load(op()));
      code(
        await repo.save([], baseline.revision, { signal: abort.signal }),
        action === 'abort' ? 'aborted' : 'disposed',
      );
      expect(storage.values.get(key())).toBe(external);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it.each(['replacement', 'deletion', 'same-revision formatting'])(
    'preserves external %s from a revision callback instead of overwriting it',
    async (action) => {
      const storage = new Memory();
      const original = JSON.stringify(document([makeMark()]));
      storage.values.set(key(), original);
      const external =
        action === 'deletion'
          ? null
          : action === 'replacement'
            ? JSON.stringify(document([], 'external'))
            : `${original} `;
      const repo = new BrowserPersonalMarksRepository(
        scope,
        artwork,
        () => storage,
        () => {
          if (external === null) storage.values.delete(key());
          else storage.values.set(key(), external);
          return 'new';
        },
      );
      const baseline = value(await repo.load(op()));
      code(await repo.save([], baseline.revision, op()), 'conflict');
      expect(storage.values.get(key()) ?? null).toBe(external);
      expect(storage.setItem).not.toHaveBeenCalled();
      code(await repo.save([], baseline.revision, op()), 'conflict');
    },
  );

  it.each(['abort', 'dispose', 'access failure'])(
    'honors %s at the final raw-read boundary without writing',
    async (action) => {
      const { repo, storage } = setup();
      const baseline = value(await repo.load(op()));
      const abort = new AbortController();
      storage.getItem
        .mockImplementationOnce(() => null)
        .mockImplementationOnce(() => {
          if (action === 'abort') abort.abort();
          else if (action === 'dispose') repo.dispose();
          else throw new Error('private storage failure');
          return null;
        });
      code(
        await repo.save([makeMark()], baseline.revision, { signal: abort.signal }),
        action === 'access failure'
          ? 'storage-unavailable'
          : action === 'abort'
            ? 'aborted'
            : 'disposed',
      );
      expect(storage.setItem).not.toHaveBeenCalled();
      if (action !== 'dispose') {
        value(await repo.save([makeMark()], baseline.revision, op()));
        expect(storage.setItem).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('checks cancellation after a revision factory runs, immediately before writing', async () => {
    const storage = new Memory();
    const abort = new AbortController();
    let count = 0;
    const repo = new BrowserPersonalMarksRepository(
      scope,
      artwork,
      () => storage,
      () => {
        count++;
        if (count === 2) abort.abort();
        return `revision-${count}`;
      },
    );
    const baseline = value(await repo.load(op()));
    code(await repo.save([makeMark()], baseline.revision, { signal: abort.signal }), 'aborted');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(value(await repo.save([makeMark()], baseline.revision, op())).marks).toHaveLength(1);
  });

  it('rejects altered provenance when a known deleted ID is reused without a reload', async () => {
    const { repo } = setup();
    const baseline = value(await repo.load(op()));
    const saved = value(await repo.save([makeMark()], baseline.revision, op()));
    const removed = value(await repo.save([], saved.revision, op()));
    code(
      await repo.save(
        [
          {
            ...makeMark(),
            source: {
              kind: 'paper',
              paperId: 'different',
              writtenAtGame: 0,
              receivedAtGame: 0,
              observedAtGame: null,
              reportedLocation: null,
              excerpt: '',
            },
          },
        ],
        removed.revision,
        op(),
      ),
      'conflict',
    );
    expect(value(await repo.load(op())).marks).toEqual([]);
  });

  it('exposes immutable binding properties on both the repository and controller', () => {
    const { repo } = setup();
    const controller = createPersonalMarksController(repo);
    expect(() => {
      (repo as { scope: Scope }).scope = { ...scope, playerId: 'other' };
    }).toThrow();
    expect(() => {
      (repo as { artwork: PublicArtwork }).artwork = { ...artwork, revision: 'other' };
    }).toThrow();
    expect(Object.isFrozen(controller)).toBe(true);
    expect(controller.scope).not.toBe(repo.scope);
    controller.dispose();
  });

  it.each(['success', 'failure', 'throw'])(
    'retains dirty RAM through disposal of a delayed reload: %s',
    async (outcome) => {
      const fake = fakeRepository();
      const controller = createPersonalMarksController(fake.repo);
      const init = controller.initialize();
      fake.initial.resolve(success(document()));
      await init;
      value(controller.create(input, null, null));
      const marks = controller.getState().marks;
      const reload = controller.reload();
      code(controller.create(input, null, null), 'conflict');
      code(
        controller.edit(marks[0]!.id, { label: 'late', geometry: input.geometry }, null),
        'conflict',
      );
      code(controller.remove(marks[0]!.id), 'conflict');
      controller.dispose();
      const final = controller.getState();
      if (outcome === 'success') fake.reloaded.resolve(success(document([], 'new')));
      else if (outcome === 'failure')
        fake.reloaded.resolve(failure('storage-unavailable', 'Late failure'));
      else fake.reloaded.reject(new Error('Late throw'));
      code(await reload, 'disposed');
      expect(controller.getState()).toBe(final);
      expect(final).toMatchObject({ marks, dirty: true, phase: 'disposed' });
    },
  );

  it('keeps captured paper provenance unchanged while its save and source refresh overlap', async () => {
    const fake = fakeRepository();
    const controller = createPersonalMarksController(fake.repo);
    const init = controller.initialize();
    fake.initial.resolve(success(document()));
    await init;
    const snap = snapshot();
    value(controller.create({ ...input, source: { kind: 'paper', paperId: 'paper' } }, snap, 300));
    const marks = controller.getState().marks;
    const saving = controller.save();
    (snap.papers[0]! as { text: string }).text = 'New paper version';
    (snap.papers[0]!.location as { x: number }).x = 777;
    code(
      controller.create({ ...input, source: { kind: 'paper', paperId: 'paper' } }, snap, 400),
      'conflict',
    );
    fake.saved.resolve(success(document(marks, 'saved')));
    value(await saving);
    expect(controller.getState().marks[0]!.source).toMatchObject({
      kind: 'paper',
      reportedLocation: { x: 23, y: 45 },
    });
    expect(controller.getState().dirty).toBe(false);
  });
});

describe('frozen marks API and commit guidance', () => {
  it('exports exactly the five runtime entry points', async () => {
    expect(Object.keys(await import('./index.js')).sort()).toEqual(
      [
        'BrowserPersonalMarksRepository',
        'createPersonalMark',
        'createPersonalMarksController',
        'editPersonalMark',
        'validateMarks',
      ].sort(),
    );
  });
  it('rejects a queued save after disposal without any write', async () => {
    const { repo, storage } = setup();
    const baseline = value(await repo.load(op()));
    const pending = repo.save([makeMark()], baseline.revision, op());
    repo.dispose();
    code(await pending, 'disposed');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps write failures retryable and read failures read-only', async () => {
    const { repo, storage } = setup();
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(await repo.load(op())).toMatchObject({ ok: false, error: { retry: 'read-only' } });
    const baseline = value(await repo.load(op()));
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(await repo.save([makeMark()], baseline.revision, op())).toMatchObject({
      ok: false,
      error: { retry: 'same-request' },
    });
  });
});
