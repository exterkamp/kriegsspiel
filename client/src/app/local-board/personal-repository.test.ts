import { describe, expect, it } from 'vitest';
import type { SceneMarkGeometry } from '../../legacy/table/types';
import type { LocalBoardBinding, LocalScope } from './contracts';
import {
  PERSONAL_MARKS_RECORD_LIMIT,
  PERSONAL_NOTEBOOK_RECORD_LIMIT,
  PERSONAL_NOTEBOOK_TEXT_LIMIT,
  PersonalRepository,
  personalRecordKey,
  projectSceneMarks,
  validatePersonalMarks,
  type PersonalMark,
  type PersonalResult,
  type PersonalStorage,
} from './personal-repository';

const scope: LocalScope = {
  gameId: 'local-11111111-1111-4111-8111-111111111111',
  sideId: 'blue',
  playerId: 'local-general',
};
const otherScope: LocalScope = { ...scope, gameId: 'local-22222222-2222-4222-8222-222222222222' };
const binding: LocalBoardBinding = {
  assetIdentity: 'a'.repeat(64),
  revision: 'a'.repeat(64),
  mapId: `local-map:${'a'.repeat(64)}`,
  bounds: { minX: 0, minY: 0, maxX: 5000, maxY: 3000 },
  registration: { origin: 'north-west', units: 'metres', xAxis: 'east', yAxis: 'south' },
};
function mark(
  id = 'mark',
  geometry: SceneMarkGeometry = { kind: 'pin', at: { x: 5000, y: 3000 } },
): PersonalMark {
  return {
    id,
    scope,
    binding,
    source: { kind: 'manual' },
    placedAtGame: 0,
    editedAtGame: null,
    label: 'manual',
    geometry,
  };
}
function value<T>(result: PersonalResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function code(result: PersonalResult<unknown>, expected: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(expected);
}
const signal = () => new AbortController().signal;
function harness(options: { storage?: () => PersonalStorage; revision?: () => string } = {}) {
  const records = new Map<string, string>();
  const writes: string[] = [];
  const storage: PersonalStorage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, raw) => {
      writes.push(raw);
      records.set(key, raw);
    },
  };
  let revision = 0;
  const repository = new PersonalRepository(scope, binding, {
    storage: () => storage,
    revision: () => `revision-${++revision}`,
    ...options,
  });
  return {
    repository,
    storage,
    records,
    writes,
    marksKey: personalRecordKey('marks', scope, binding),
    notebookKey: personalRecordKey('notebook', scope, binding),
  };
}
const marksDocument = (marks: readonly PersonalMark[] = [mark()]) => ({
  schemaVersion: 1,
  scope,
  binding,
  revision: 'old',
  marks,
});
const notebookDocument = (text = 'private notebook') => ({
  schemaVersion: 1,
  scope,
  binding,
  text,
});

describe('strict personal validation and namespace', () => {
  it('accepts exact mark/label/point limits and inclusive rectangular southeast geometry', () => {
    const marks = Array.from({ length: 200 }, (_, i) => ({
      ...mark(`m${i}`, {
        kind: 'arrow',
        points: Array.from({ length: 256 }, () => ({ x: 5000, y: 3000 })),
      }),
      label: 'x'.repeat(256),
    }));
    expect(value(validatePersonalMarks(marks, scope, binding))).toHaveLength(200);
    const ring = mark('ring', {
      kind: 'ring',
      centre: { x: 5000, y: 3000 },
      radiusM: Math.hypot(5000, 3000),
    });
    expect(value(validatePersonalMarks([ring], scope, binding))).toHaveLength(1);
  });
  it.each([
    ['count', Array.from({ length: 201 }, (_, i) => mark(`m${i}`))],
    ['label', [{ ...mark(), label: 'x'.repeat(257) }]],
    ['id length', [{ ...mark(), id: 'x'.repeat(129) }]],
    ['id empty', [{ ...mark(), id: '' }]],
    ['duplicate', [mark(), mark()]],
    ['one point', [mark('a', { kind: 'polyline', points: [{ x: 1, y: 2 }] })]],
    [
      '257 points',
      [mark('a', { kind: 'arrow', points: Array.from({ length: 257 }, () => ({ x: 1, y: 2 })) })],
    ],
    ['east outside', [mark('a', { kind: 'pin', at: { x: 5000.001, y: 3000 } })]],
    ['south outside', [mark('a', { kind: 'pin', at: { x: 1, y: 3000.001 } })]],
    ['negative', [mark('a', { kind: 'pin', at: { x: -0.001, y: 0 } })]],
    ['nonfinite', [mark('a', { kind: 'pin', at: { x: Infinity, y: NaN } })]],
    [
      'radius',
      [
        mark('a', {
          kind: 'ring',
          centre: { x: 0, y: 0 },
          radiusM: Math.hypot(5000, 3000) + 0.001,
        }),
      ],
    ],
    ['zero radius', [mark('a', { kind: 'ring', centre: { x: 0, y: 0 }, radiusM: 0 })]],
    [
      'wrong symbol',
      [{ ...mark(), geometry: { kind: 'symbol', at: { x: 1, y: 2 }, symbol: 'horse' } }],
    ],
    ['unknown mark field', [{ ...mark(), secret: 1 }]],
    ['unknown source field', [{ ...mark(), source: { kind: 'manual', atWall: 1 } }]],
    ['wrong source', [{ ...mark(), source: { kind: 'paper' } }]],
    ['unknown point field', [{ ...mark(), geometry: { kind: 'pin', at: { x: 1, y: 2, z: 3 } } }]],
    [
      'unknown geometry field',
      [{ ...mark(), geometry: { kind: 'pin', at: { x: 1, y: 2 }, report: 1 } }],
    ],
    ['placed wall time', [{ ...mark(), placedAtGame: 123 }]],
    ['edited wall time', [{ ...mark(), editedAtGame: 123 }]],
    ['unknown scope field', [{ ...mark(), scope: { ...scope, secret: 1 } }]],
    [
      'unknown bounds field',
      [{ ...mark(), binding: { ...binding, bounds: { ...binding.bounds, hidden: 1 } } }],
    ],
    [
      'unknown registration field',
      [
        {
          ...mark(),
          binding: { ...binding, registration: { ...binding.registration, zAxis: 'up' } },
        },
      ],
    ],
  ])('rejects %s', (_name, marks) =>
    code(validatePersonalMarks(marks, scope, binding), 'invalid-data'),
  );
  it('detaches and deeply freezes documents and render-only projection', () => {
    const original = mark();
    const validated = value(validatePersonalMarks([original], scope, binding));
    const projected = projectSceneMarks(validated, scope, binding);
    expect(Object.keys(projected[0]!).sort()).toEqual(['geometry', 'id', 'label']);
    Object.assign(original, { label: 'changed' }); // runtime input is intentionally mutable
    expect(validated[0]!.label).toBe('manual');
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected[0]!.geometry)).toBe(true);
    expect(() =>
      projectSceneMarks([{ ...mark(), placedAtGame: 1 } as never], scope, binding),
    ).toThrow();
  });
  it('includes complete scope/binding and full identity in deterministic keys', () => {
    const key = personalRecordKey('marks', scope, binding);
    expect(personalRecordKey('marks', structuredClone(scope), structuredClone(binding))).toBe(key);
    expect(personalRecordKey('marks', otherScope, binding)).not.toBe(key);
    expect(personalRecordKey('notebook', scope, binding)).not.toBe(key);
    expect(
      personalRecordKey('marks', scope, {
        ...binding,
        bounds: { ...binding.bounds, maxX: 5000.5 },
      }),
    ).not.toBe(key);
    const digest = `${'a'.repeat(63)}b`;
    expect(
      personalRecordKey('marks', scope, {
        ...binding,
        assetIdentity: digest,
        revision: digest,
        mapId: `local-map:${digest}`,
      }),
    ).not.toBe(key);
    expect(JSON.parse(key)).toEqual([
      'kriegsspiel.local-board.personal.v1',
      'marks',
      scope.gameId,
      'blue',
      'local-general',
      binding.assetIdentity,
      binding.revision,
      binding.mapId,
      0,
      0,
      5000,
      3000,
      'north-west',
      'metres',
      'east',
      'south',
    ]);
    expect(() => new PersonalRepository({ ...scope, gameId: 'local-not-uuid' }, binding)).toThrow();
  });
});

describe('safe load, versions, isolation and budgets', () => {
  it('touches no storage at construction, blocks save-before-load, and freezes scope/binding', async () => {
    let calls = 0;
    const h = harness({
      storage: () => {
        calls++;
        throw new Error('private detail');
      },
    });
    expect(calls).toBe(0);
    code(await h.repository.saveNotebook('text', signal()), 'not-ready');
    code(await h.repository.saveMarks([mark()], 'old', signal()), 'not-ready');
    expect(calls).toBe(0);
    expect(Object.isFrozen(h.repository.scope)).toBe(true);
    expect(() => Object.assign(h.repository, { scope: otherScope })).toThrow();
    code(await h.repository.loadNotebook(signal()), 'storage-unavailable');
    expect(calls).toBe(1);
  });
  it.each(['marks', 'notebook'] as const)(
    'preserves corrupt %s until a successful explicit reload',
    async (kind) => {
      const h = harness(),
        key = kind === 'marks' ? h.marksKey : h.notebookKey;
      h.records.set(key, '{ private broken');
      code(
        await (kind === 'marks'
          ? h.repository.loadMarks(signal())
          : h.repository.loadNotebook(signal())),
        'invalid-data',
      );
      code(
        await (kind === 'marks'
          ? h.repository.saveMarks([], 'old', signal())
          : h.repository.saveNotebook('new', signal())),
        'conflict',
      );
      expect(h.records.get(key)).toBe('{ private broken');
      expect(h.writes).toHaveLength(0);
      h.records.set(key, '{ still broken');
      code(
        await (kind === 'marks'
          ? h.repository.loadMarks(signal())
          : h.repository.loadNotebook(signal())),
        'invalid-data',
      );
      h.records.delete(key);
      if (kind === 'marks') {
        const loaded = value(await h.repository.loadMarks(signal()));
        value(await h.repository.saveMarks([mark()], loaded.revision, signal()));
      } else {
        value(await h.repository.loadNotebook(signal()));
        value(await h.repository.saveNotebook('new', signal()));
      }
      expect(h.writes).toHaveLength(1);
    },
  );
  it.each([0, -1, null, '1', true, 1.5, 2, Number.MAX_SAFE_INTEGER + 1])(
    'retains distinct version policy for %s',
    async (version) => {
      const h = harness();
      h.records.set(h.marksKey, JSON.stringify({ ...marksDocument(), schemaVersion: version }));
      h.records.set(
        h.notebookKey,
        JSON.stringify({ ...notebookDocument(), schemaVersion: version }),
      );
      code(
        await h.repository.loadMarks(signal()),
        typeof version === 'number' && version > 1 && Number.isSafeInteger(version)
          ? 'future-version'
          : 'invalid-data',
      );
      code(
        await h.repository.loadNotebook(signal()),
        typeof version === 'number' && version > 1 ? 'future-version' : 'invalid-data',
      );
      expect(h.writes).toHaveLength(0);
    },
  );
  it.each([
    [
      'scope',
      { ...marksDocument(), scope: otherScope },
      { ...notebookDocument(), scope: otherScope },
      'scope-mismatch',
    ],
    [
      'binding',
      { ...marksDocument(), binding: { ...binding, bounds: { ...binding.bounds, maxX: 6000 } } },
      { ...notebookDocument(), binding: { ...binding, bounds: { ...binding.bounds, maxX: 6000 } } },
      'binding-mismatch',
    ],
    [
      'nested scope',
      marksDocument([{ ...mark(), scope: otherScope }]),
      notebookDocument(),
      'scope-mismatch',
    ],
    [
      'nested binding',
      marksDocument([
        { ...mark(), binding: { ...binding, bounds: { ...binding.bounds, maxY: 4000 } } },
      ]),
      notebookDocument(),
      'binding-mismatch',
    ],
    [
      'envelope extra',
      { ...marksDocument(), private: 1 },
      { ...notebookDocument(), private: 1 },
      'invalid-data',
    ],
  ])('rejects %s without returning private labels/text', async (name, marks, notebook, error) => {
    const h = harness();
    const raw = JSON.stringify(marks);
    h.records.set(h.marksKey, raw);
    const result = await h.repository.loadMarks(signal());
    code(result, error);
    expect(JSON.stringify(result)).not.toContain('manual');
    expect(h.records.get(h.marksKey)).toBe(raw);
    if (!name.startsWith('nested')) {
      h.records.set(h.notebookKey, JSON.stringify(notebook));
      code(await h.repository.loadNotebook(signal()), error);
    }
  });
  it.each(['marks', 'notebook'] as const)(
    'accepts exact %s raw load budget and rejects one-over',
    async (kind) => {
      const h = harness(),
        key = kind === 'marks' ? h.marksKey : h.notebookKey;
      const limit = kind === 'marks' ? PERSONAL_MARKS_RECORD_LIMIT : PERSONAL_NOTEBOOK_RECORD_LIMIT;
      const raw = JSON.stringify(kind === 'marks' ? marksDocument() : notebookDocument()).padEnd(
        limit,
        ' ',
      );
      h.records.set(key, raw);
      value<unknown>(
        await (kind === 'marks'
          ? h.repository.loadMarks(signal())
          : h.repository.loadNotebook(signal())),
      );
      h.records.set(key, raw + ' ');
      code(
        await (kind === 'marks'
          ? h.repository.loadMarks(signal())
          : h.repository.loadNotebook(signal())),
        'invalid-data',
      );
      expect(h.records.get(key)).toBe(raw + ' ');
      expect(h.writes).toHaveLength(0);
    },
  );
  it('persists maximum escaped notebook exactly and rejects one-over without truncation', async () => {
    const h = harness();
    value(await h.repository.loadNotebook(signal()));
    const text = '\u0000'.repeat(PERSONAL_NOTEBOOK_TEXT_LIMIT);
    expect(value(await h.repository.saveNotebook(text, signal())).text).toBe(text);
    expect(h.records.get(h.notebookKey)!.length).toBeLessThanOrEqual(
      PERSONAL_NOTEBOOK_RECORD_LIMIT,
    );
    expect(JSON.parse(h.records.get(h.notebookKey)!).text).toBe(text);
    const raw = h.records.get(h.notebookKey);
    code(await h.repository.saveNotebook(text + 'a', signal()), 'invalid-data');
    expect(h.records.get(h.notebookKey)).toBe(raw);
    expect(h.writes).toHaveLength(1);
  });
  it('counts the full marks envelope, repeated binding, escaping and generated revision then permits reduction', async () => {
    const h = harness({
      revision: (() => {
        let i = 0;
        return () => `${++i}`.padEnd(128, 'r');
      })(),
    });
    const loaded = value(await h.repository.loadMarks(signal()));
    const saved = value(await h.repository.saveMarks([mark()], loaded.revision, signal()));
    const prior = h.records.get(h.marksKey);
    const marks = Array.from({ length: 200 }, (_, i) => ({
      ...mark(`m${i}`, {
        kind: 'polyline',
        points: Array.from({ length: 256 }, () => ({ x: 1234.123456789123, y: 2345.234567891234 })),
      }),
      label: '\u0000'.repeat(256),
    }));
    const candidate = value(validatePersonalMarks(marks, scope, binding));
    expect(JSON.stringify({ ...saved, marks: candidate }).length).toBeGreaterThan(
      PERSONAL_MARKS_RECORD_LIMIT,
    );
    code(await h.repository.saveMarks(candidate, saved.revision, signal()), 'invalid-data');
    expect(h.records.get(h.marksKey)).toBe(prior);
    expect(h.writes).toHaveLength(1);
    value(await h.repository.saveMarks(candidate.slice(0, 1), saved.revision, signal()));
    expect(h.writes).toHaveLength(2);
  });
  it('records fail independently and same map with fresh scope has empty records', async () => {
    const h = harness();
    h.records.set(h.marksKey, 'broken');
    h.records.set(h.notebookKey, JSON.stringify(notebookDocument()));
    code(await h.repository.loadMarks(signal()), 'invalid-data');
    expect(value(await h.repository.loadNotebook(signal())).text).toBe('private notebook');
    const fresh = new PersonalRepository(otherScope, binding, {
      storage: () => h.storage,
      revision: () => 'fresh',
    });
    expect(value(await fresh.loadMarks(signal())).marks).toEqual([]);
    expect(value(await fresh.loadNotebook(signal())).text).toBe('');
  });
});

describe('observed conflicts, history and callback boundaries', () => {
  it.each(['replace', 'delete', 'format', 'revision'] as const)(
    'blocks marks %s conflict',
    async (change) => {
      let changeOnRevision = false;
      const h = harness({
        revision: (() => {
          let i = 0;
          return () => {
            if (changeOnRevision) h.records.set(h.marksKey, 'external');
            return `r${++i}`;
          };
        })(),
      });
      const initial = value(await h.repository.loadMarks(signal()));
      const saved = value(await h.repository.saveMarks([mark()], initial.revision, signal()));
      if (change === 'replace')
        h.records.set(h.marksKey, JSON.stringify({ ...saved, revision: 'external' }));
      if (change === 'delete') h.records.delete(h.marksKey);
      if (change === 'format') h.records.set(h.marksKey, JSON.stringify(saved, null, 2));
      if (change === 'revision') changeOnRevision = true;
      const before = h.records.get(h.marksKey);
      code(await h.repository.saveMarks(saved.marks, saved.revision, signal()), 'conflict');
      expect(h.writes).toHaveLength(1);
      expect(h.records.get(h.marksKey)).toBe(change === 'revision' ? 'external' : before);
      code(await h.repository.saveMarks(saved.marks, saved.revision, signal()), 'conflict');
    },
  );
  it('checks expected revision and requires new revision for save', async () => {
    const h = harness({ revision: () => 'same' });
    const loaded = value(await h.repository.loadMarks(signal()));
    code(await h.repository.saveMarks([mark()], loaded.revision, signal()), 'internal');
    code(await h.repository.saveMarks([mark()], 'wrong', signal()), 'conflict');
    expect(h.writes).toHaveLength(0);
  });
  it.each(['replace', 'delete', 'format'] as const)(
    'blocks notebook %s conflict and preserves foreign raw',
    async (change) => {
      const h = harness();
      value(await h.repository.loadNotebook(signal()));
      value(await h.repository.saveNotebook('old', signal()));
      if (change === 'replace')
        h.records.set(h.notebookKey, JSON.stringify(notebookDocument('external')));
      if (change === 'delete') h.records.delete(h.notebookKey);
      if (change === 'format')
        h.records.set(h.notebookKey, JSON.stringify(notebookDocument('old'), null, 2));
      const raw = h.records.get(h.notebookKey);
      code(await h.repository.saveNotebook('new', signal()), 'conflict');
      expect(h.records.get(h.notebookKey)).toBe(raw);
      expect(h.writes).toHaveLength(1);
    },
  );
  it('preserves edited provenance through removal and reload, rejecting rollback/reuse and unflagged edits', async () => {
    const h = harness();
    let document = value(await h.repository.loadMarks(signal()));
    document = value(await h.repository.saveMarks([mark()], document.revision, signal()));
    code(
      await h.repository.saveMarks([{ ...mark(), label: 'changed' }], document.revision, signal()),
      'conflict',
    );
    document = value(await h.repository.loadMarks(signal()));
    document = value(
      await h.repository.saveMarks(
        [{ ...mark(), label: 'changed', editedAtGame: 0 }],
        document.revision,
        signal(),
      ),
    );
    document = value(await h.repository.saveMarks([], document.revision, signal()));
    document = value(await h.repository.loadMarks(signal()));
    const before = h.records.get(h.marksKey);
    code(await h.repository.saveMarks([mark()], document.revision, signal()), 'conflict');
    expect(h.records.get(h.marksKey)).toBe(before);
    h.records.set(h.marksKey, JSON.stringify(marksDocument()));
    code(await h.repository.loadMarks(signal()), 'conflict');
    h.records.set(
      h.marksKey,
      JSON.stringify(marksDocument([{ ...mark(), label: 'changed', editedAtGame: 0 }])),
    );
    value(await h.repository.loadMarks(signal()));
  });
  it.each(['factory', 'getter', 'revision'] as const)(
    'nested operations from %s interrupt the outer save with zero writes',
    async (callback) => {
      const h = harness();
      let armed = false,
        nested: Promise<PersonalResult<unknown>> | undefined,
        counter = 0;
      const repository = new PersonalRepository(scope, binding, {
        storage: () => {
          if (armed && callback === 'factory') nested = repository.loadNotebook(signal());
          return {
            getItem: (key) => {
              if (armed && callback === 'getter')
                nested = repository.saveNotebook('nested', signal());
              return h.storage.getItem(key);
            },
            setItem: h.storage.setItem,
          };
        },
        revision: () => {
          if (armed && callback === 'revision') nested = repository.loadMarks(signal());
          return `r${++counter}`;
        },
      });
      const loaded = value(await repository.loadMarks(signal()));
      value(await repository.loadNotebook(signal()));
      armed = true;
      code(await repository.saveMarks([mark()], loaded.revision, signal()), 'conflict');
      expect(nested).toBeDefined();
      code(await nested!, 'conflict');
      expect(h.writes).toHaveLength(0);
      armed = false;
      code(await repository.saveMarks([mark()], loaded.revision, signal()), 'conflict');
      const reloaded = value(await repository.loadMarks(signal()));
      value(await repository.saveMarks([mark()], reloaded.revision, signal()));
    },
  );
  it('nested notebook factory/load blocks load and later save until reload', async () => {
    const h = harness();
    let armed = true,
      nested: Promise<PersonalResult<unknown>> | undefined;
    const repository = new PersonalRepository(scope, binding, {
      storage: () => {
        if (armed) nested = repository.loadNotebook(signal());
        return h.storage;
      },
    });
    code(await repository.loadNotebook(signal()), 'conflict');
    code(await nested!, 'conflict');
    armed = false;
    code(await repository.saveNotebook('new', signal()), 'conflict');
    value(await repository.loadNotebook(signal()));
    value(await repository.saveNotebook('new', signal()));
  });
  it('snapshots save candidates before queuing', async () => {
    const h = harness();
    const loaded = value(await h.repository.loadMarks(signal()));
    const input = structuredClone(mark());
    const pending = h.repository.saveMarks([input], loaded.revision, signal());
    Object.assign(input, { label: 'late' });
    expect(value(await pending).marks[0]!.label).toBe('manual');
  });
});

describe('exact serialized save budget and callback edge cases', () => {
  it('accepts marks serialized exactly at the budget and rejects exactly one-over including generated revision', async () => {
    let revisions = 0;
    const h = harness({ revision: () => `${++revisions}`.padEnd(128, 'r') });
    const loaded = value(await h.repository.loadMarks(signal()));
    // Empty labels plus fixed high-precision points leave room for escaped label padding.
    const marks = Array.from({ length: 200 }, (_, i) => ({
      ...mark(`m${i}`, {
        kind: 'polyline',
        points: Array.from({ length: 72 }, () => ({ x: 1234.123456789123, y: 2345.234567891234 })),
      }),
      label: '',
      editedAtGame: 0 as const,
    }));
    const envelope = { ...loaded, revision: '2'.padEnd(128, 'r'), marks };
    let remaining = PERSONAL_MARKS_RECORD_LIMIT - JSON.stringify(envelope).length;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(200 * 256 * 6);
    for (const mark of marks) {
      const escapes = Math.min(256, Math.floor(remaining / 6));
      mark.label = '\u0000'.repeat(escapes);
      remaining -= escapes * 6;
      const plain = Math.min(256 - escapes, remaining);
      mark.label += 'x'.repeat(plain);
      remaining -= plain;
    }
    expect(remaining).toBe(0);
    expect(JSON.stringify(envelope).length).toBe(PERSONAL_MARKS_RECORD_LIMIT);
    const saved = value(await h.repository.saveMarks(marks, loaded.revision, signal()));
    expect(h.records.get(h.marksKey)!.length).toBe(PERSONAL_MARKS_RECORD_LIMIT);
    const oneOver = structuredClone(saved.marks);
    const target = oneOver.find((mark) => mark.label.length < 256)!;
    Object.assign(target, { label: target.label + 'x', editedAtGame: 0 });
    expect(JSON.stringify({ ...saved, marks: oneOver }).length).toBe(
      PERSONAL_MARKS_RECORD_LIMIT + 1,
    );
    const prior = h.records.get(h.marksKey);
    code(await h.repository.saveMarks(oneOver, saved.revision, signal()), 'invalid-data');
    expect(h.records.get(h.marksKey)).toBe(prior);
    expect(h.writes).toHaveLength(1);
  });
  it('writer accessor cancellation/reentrancy is checked before the final read and write', async () => {
    for (const action of ['abort', 'nested'] as const) {
      const h = harness(),
        abort = new AbortController();
      let armed = false;
      let nested: Promise<PersonalResult<unknown>> | undefined;
      const storage: PersonalStorage = {
        getItem: h.storage.getItem,
        get setItem() {
          if (armed) {
            if (action === 'abort') abort.abort();
            else nested = repository.saveNotebook('nested', signal());
          }
          return h.storage.setItem;
        },
      };
      const repository = new PersonalRepository(scope, binding, { storage: () => storage });
      value(await repository.loadNotebook(signal()));
      armed = true;
      code(
        await repository.saveNotebook('outer', abort.signal),
        action === 'abort' ? 'aborted' : 'conflict',
      );
      if (nested) code(await nested, 'conflict');
      expect(h.writes).toHaveLength(0);
    }
  });
  it('writer getter storage replacement is compared after retrieving the writer', async () => {
    const h = harness();
    let armed = false;
    const storage: PersonalStorage = {
      getItem: h.storage.getItem,
      get setItem() {
        if (armed) h.records.set(h.notebookKey, 'replacement');
        return h.storage.setItem;
      },
    };
    const repository = new PersonalRepository(scope, binding, { storage: () => storage });
    value(await repository.loadNotebook(signal()));
    armed = true;
    code(await repository.saveNotebook('new', signal()), 'conflict');
    expect(h.records.get(h.notebookKey)).toBe('replacement');
    expect(h.writes).toHaveLength(0);
  });
  it('missing marks load checks revision callback storage changes before publishing empty state', async () => {
    const h = harness();
    const repository = new PersonalRepository(scope, binding, {
      storage: () => h.storage,
      revision: () => {
        h.records.set(h.marksKey, JSON.stringify(marksDocument()));
        return 'new';
      },
    });
    code(await repository.loadMarks(signal()), 'conflict');
    code(await repository.saveMarks([], 'new', signal()), 'conflict');
    expect(h.writes).toHaveLength(0);
  });
  it('per-record queues preserve sequential notebook baselines without autosaving or losing edits', async () => {
    const h = harness();
    value(await h.repository.loadNotebook(signal()));
    const first = h.repository.saveNotebook('first', signal()),
      second = h.repository.saveNotebook('second', signal());
    expect(value(await first).text).toBe('first');
    expect(value(await second).text).toBe('second');
    expect(JSON.parse(h.records.get(h.notebookKey)!).text).toBe('second');
    expect(h.writes).toHaveLength(2);
  });
  it('invalid generated revisions fail without writes and revision exceptions remain sanitized', async () => {
    for (const invalid of ['', 'r'.repeat(129), 'throw'] as const) {
      const h = harness({
        revision: () => {
          if (invalid === 'throw') throw new Error('private revision detail');
          return invalid;
        },
      });
      const result = await h.repository.loadMarks(signal());
      code(result, 'internal');
      expect(JSON.stringify(result)).not.toContain('private');
      expect(h.writes).toHaveLength(0);
    }
  });
});

describe('storage failures, cancellation and retirement', () => {
  it.each(['QuotaExceededError', 'SecurityError', 'Error'])(
    'sanitizes %s write failure and safely retries',
    async (name) => {
      const h = harness();
      let fail = false;
      const repository = new PersonalRepository(scope, binding, {
        storage: () => ({
          getItem: h.storage.getItem,
          setItem: (key, raw) => {
            if (fail) {
              const error = new Error('private content secret');
              error.name = name;
              throw error;
            }
            h.storage.setItem(key, raw);
          },
        }),
      });
      value(await repository.loadNotebook(signal()));
      value(await repository.saveNotebook('old', signal()));
      fail = true;
      const result = await repository.saveNotebook('draft', signal());
      code(result, name === 'QuotaExceededError' ? 'quota-exceeded' : 'storage-unavailable');
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(h.writes).toHaveLength(1);
      if (!result.ok) expect(result.error.retry).toBe('same-request');
      fail = false;
      value(await repository.saveNotebook('draft', signal()));
      expect(h.writes).toHaveLength(2);
    },
  );
  it.each(['factory', 'getter'] as const)(
    'denied %s load blocks saving, successful reload recovers',
    async (callback) => {
      const h = harness();
      let deny = true;
      const repository = new PersonalRepository(scope, binding, {
        storage: () => {
          if (deny && callback === 'factory') throw new Error('private denied');
          return {
            getItem: (key) => {
              if (deny) throw new Error('private denied');
              return h.storage.getItem(key);
            },
            setItem: h.storage.setItem,
          };
        },
      });
      code(await repository.loadNotebook(signal()), 'storage-unavailable');
      deny = false;
      code(await repository.saveNotebook('new', signal()), 'conflict');
      expect(h.writes).toHaveLength(0);
      value(await repository.loadNotebook(signal()));
      value(await repository.saveNotebook('new', signal()));
    },
  );
  it('write retry rechecks raw and rejects deletion after quota failure', async () => {
    const h = harness();
    let quota = false;
    const repository = new PersonalRepository(scope, binding, {
      storage: () => ({
        getItem: h.storage.getItem,
        setItem: (key, raw) => {
          if (quota) throw { name: 'QuotaExceededError' };
          h.storage.setItem(key, raw);
        },
      }),
    });
    value(await repository.loadNotebook(signal()));
    value(await repository.saveNotebook('old', signal()));
    quota = true;
    code(await repository.saveNotebook('draft', signal()), 'quota-exceeded');
    quota = false;
    h.records.delete(h.notebookKey);
    code(await repository.saveNotebook('draft', signal()), 'conflict');
    expect(h.writes).toHaveLength(1);
  });
  it('queued cancellation and synchronous disposal settle with zero writes', async () => {
    const h = harness();
    const loaded = value(await h.repository.loadMarks(signal()));
    const abort = new AbortController();
    const cancelled = h.repository.saveMarks([mark()], loaded.revision, abort.signal);
    abort.abort();
    code(await cancelled, 'aborted');
    const queued = h.repository.saveNotebook('new', signal());
    const first = h.repository.dispose();
    expect(h.repository.dispose()).toBe(first);
    code(await queued, 'disposed');
    await first;
    code(await h.repository.loadMarks(signal()), 'disposed');
    expect(h.writes).toHaveLength(0);
  });
  it.each(['factory', 'revision', 'final read'] as const)(
    'cancellation in %s immediately before writing makes zero writes',
    async (callback) => {
      const h = harness();
      const abort = new AbortController();
      let armed = false,
        reads = 0,
        revisions = 0;
      const repository = new PersonalRepository(scope, binding, {
        storage: () => {
          if (armed && callback === 'factory') abort.abort();
          return {
            getItem: (key) => {
              if (armed && callback === 'final read' && ++reads === 2) abort.abort();
              return h.storage.getItem(key);
            },
            setItem: h.storage.setItem,
          };
        },
        revision: () => {
          if (armed && callback === 'revision') abort.abort();
          return `r${++revisions}`;
        },
      });
      const loaded = value(await repository.loadMarks(signal()));
      armed = true;
      code(await repository.saveMarks([mark()], loaded.revision, abort.signal), 'aborted');
      expect(h.writes).toHaveLength(0);
    },
  );
  it.each(['abort', 'dispose'] as const)(
    'synchronous commit survives %s triggered by setItem',
    async (action) => {
      const h = harness();
      const abort = new AbortController();
      const repository = new PersonalRepository(scope, binding, {
        storage: () => ({
          getItem: h.storage.getItem,
          setItem: (key, raw) => {
            h.storage.setItem(key, raw);
            if (action === 'abort') abort.abort();
            else void repository.dispose();
          },
        }),
      });
      value(await repository.loadNotebook(signal()));
      expect(value(await repository.saveNotebook('committed', abort.signal)).text).toBe(
        'committed',
      );
      expect(JSON.parse(h.records.get(h.notebookKey)!).text).toBe('committed');
      await repository.dispose();
    },
  );
});
