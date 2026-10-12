import { describe, expect, it, vi } from 'vitest';
import type { SceneMarkGeometry } from '../../legacy/table/types';
import type { LocalBoardBinding, LocalScope } from './contracts';
import {
  PersonalRepository,
  personalRecordKey,
  type PersonalResult,
  type PersonalStorage,
} from './personal-repository';
import { PersonalStore, type ManualTool } from './personal-store';

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
const pin: SceneMarkGeometry = { kind: 'pin', at: { x: 123.25, y: 456.75 } };
function value<T>(result: PersonalResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function code(result: PersonalResult<unknown>, expected: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(expected);
}
function harness() {
  const records = new Map<string, string>();
  let writes = 0,
    revision = 0,
    markId = 0;
  const storage: PersonalStorage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, raw) => {
      records.set(key, raw);
      writes++;
    },
  };
  const repository = new PersonalRepository(scope, binding, {
    storage: () => storage,
    revision: () => `r${++revision}`,
  });
  const store = new PersonalStore(scope, binding, repository, { markId: () => `m${++markId}` });
  return {
    records,
    storage,
    repository,
    store,
    writes: () => writes,
    marksKey: personalRecordKey('marks', scope, binding),
    notebookKey: personalRecordKey('notebook', scope, binding),
  };
}

describe('session store initialization and record state', () => {
  it('explicit initialization is idempotent, independently loads records, never autosaves', async () => {
    const h = harness();
    h.records.set(h.notebookKey, 'private broken');
    const marksLoad = vi.spyOn(h.repository, 'loadMarks'),
      notesLoad = vi.spyOn(h.repository, 'loadNotebook');
    expect(h.store.marks().writable).toBe(false);
    const first = h.store.initialize();
    expect(h.store.initialize()).toBe(first);
    await first;
    expect(marksLoad).toHaveBeenCalledTimes(1);
    expect(notesLoad).toHaveBeenCalledTimes(1);
    expect(h.store.marks().writable).toBe(true);
    expect(h.store.notebook().writable).toBe(false);
    expect(h.store.notebook().error?.code).toBe('invalid-data');
    value(h.store.createMark({ label: 'new', geometry: pin }));
    expect(h.store.marks().dirty).toBe(true);
    expect(h.writes()).toBe(0);
    await h.store.initialize();
    expect(h.store.marks().draft).toHaveLength(1);
  });
  it('rejects mismatched repository scope/binding before any load', () => {
    const h = harness(),
      load = vi.spyOn(h.repository, 'loadMarks');
    expect(() => new PersonalStore(otherScope, binding, h.repository)).toThrow();
    expect(
      () =>
        new PersonalStore(
          scope,
          { ...binding, bounds: { ...binding.bounds, maxX: 6000 } },
          h.repository,
        ),
    ).toThrow();
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps equal-valued session snapshots detached and immutable', async () => {
    const h = harness(),
      inputScope = structuredClone(scope),
      inputBinding = structuredClone(binding);
    const store = new PersonalStore(inputScope, inputBinding, h.repository, {
      markId: () => 'one',
    });
    await store.initialize();
    value(store.setNotebookText('unsaved'));
    Object.assign(inputScope, { gameId: otherScope.gameId });
    Object.assign(inputBinding.bounds, { maxX: 6 });
    expect(store.scope).toEqual(scope);
    expect(store.binding).toEqual(binding);
    expect(store.notebook().draft).toBe('unsaved');
    expect(Object.isFrozen(store.scope)).toBe(true);
    expect(() => Object.assign(store, { binding: inputBinding })).toThrow();
  });
  it('new session after a failed load never exposes previous draft/query/form/export', async () => {
    const h = harness();
    await h.store.initialize();
    value(h.store.setNotebookText('old private draft'));
    h.store.setNotebookQuery('private');
    h.store.setMarkFields({ label: 'old label', x: 'unfinished' });
    await h.store.dispose();
    const repo = new PersonalRepository(otherScope, binding, {
      storage: () => {
        throw new Error('private');
      },
    });
    const next = new PersonalStore(otherScope, binding, repo);
    await next.initialize();
    expect(next.notebook().draft).toBe('');
    expect(next.marks().draft).toEqual([]);
    expect(next.notebookQuery()).toBe('');
    expect(next.markForm().label).toBe('');
    expect(next.notebookExport()).not.toContain('old private');
    expect(h.store.notebookExport()).toBe('');
    expect(h.store.notebookQuery()).toBe('');
  });
  it('failed notebook reload preserves dirty text, matches and exact selectable export, then explicit recovery replaces it', async () => {
    const h = harness();
    await h.store.initialize();
    const text = '<script>literal</script>\n  Fractional \u0000 text\nFRACTIONAL again\n';
    value(h.store.setNotebookText(text));
    h.store.setNotebookQuery('  fractional  ');
    const exported = h.store.notebookExport();
    expect(exported).toContain('unsaved');
    expect(exported.endsWith(text)).toBe(true);
    expect(h.store.notebookMatches()).toEqual([
      { line: 2, text: '  Fractional \u0000 text' },
      { line: 3, text: 'FRACTIONAL again' },
    ]);
    h.records.set(h.notebookKey, '{ corrupt');
    code(await h.store.reloadNotebook(), 'invalid-data');
    expect(h.store.notebook()).toMatchObject({
      draft: text,
      dirty: true,
      writable: false,
      busy: false,
    });
    expect(h.store.notebookExport()).toBe(exported);
    code(h.store.setNotebookText('replacement'), 'not-ready');
    code(await h.store.saveNotebook(), 'not-ready');
    expect(h.writes()).toBe(0);
    h.records.delete(h.notebookKey);
    value(await h.store.reloadNotebook());
    expect(h.store.notebook()).toMatchObject({ draft: '', dirty: false, writable: true });
    expect(h.store.notebookMatches()).toEqual([]);
  });
  it('blocks edits during explicit reload and retains marks after failed reload', async () => {
    const h = harness();
    await h.store.initialize();
    const mark = value(h.store.createMark({ label: 'retained', geometry: pin }));
    h.records.set(h.marksKey, 'corrupt');
    const pending = h.store.reloadMarks();
    code(h.store.editMark(mark.id, { label: 'ambiguous', geometry: pin }), 'not-ready');
    code(h.store.removeMark(mark.id), 'not-ready');
    code(await pending, 'invalid-data');
    expect(h.store.marks()).toMatchObject({ dirty: true, writable: false, busy: false });
    expect(h.store.sceneMarks()[0]!.label).toBe('retained');
    value(h.store.editMark(mark.id, { label: 'still editable', geometry: pin }));
    expect(h.store.marks().dirty).toBe(true);
    h.records.delete(h.marksKey);
    value(await h.store.reloadMarks());
    expect(h.store.marks().draft).toEqual([]);
    const notes = h.store.reloadNotebook();
    code(h.store.setNotebookText('during reload'), 'not-ready');
    await notes;
  });
  it('cancelled initialization settles without writes and requires explicit recovery', async () => {
    const h = harness(),
      abort = new AbortController();
    const pending = h.store.initialize(abort.signal);
    abort.abort();
    await pending;
    expect(h.store.marks().error?.code).toBe('aborted');
    expect(h.store.notebook().error?.code).toBe('aborted');
    expect(h.store.initialize()).toBe(pending);
    expect(h.writes()).toBe(0);
    value(await h.store.reloadMarks());
    value(await h.store.reloadNotebook());
    expect(h.store.notebook().writable).toBe(true);
  });
});

describe('explicit saving, dirty snapshots and readonly projection', () => {
  it('creates edits/removes stopped-time marks and projects only the readonly render contract', async () => {
    const h = harness();
    await h.store.initialize();
    const created = value(h.store.createMark({ label: '<script>text</script>', geometry: pin }));
    expect(created).toMatchObject({
      placedAtGame: 0,
      editedAtGame: null,
      source: { kind: 'manual' },
    });
    const edited = value(
      h.store.editMark(created.id, {
        label: 'edited',
        geometry: { kind: 'symbol', at: { x: 5000, y: 3000 }, symbol: 'flag' },
      }),
    );
    expect(edited).toMatchObject({
      id: created.id,
      scope,
      binding,
      placedAtGame: 0,
      editedAtGame: 0,
      source: { kind: 'manual' },
    });
    expect(Object.keys(h.store.sceneMarks()[0]!).sort()).toEqual(['geometry', 'id', 'label']);
    expect(Object.isFrozen(h.store.sceneMarks())).toBe(true);
    value(await h.store.saveMarks());
    expect(h.store.marks().dirty).toBe(false);
    value(h.store.removeMark(created.id));
    expect(h.store.sceneMarks()).toEqual([]);
    expect(h.store.marks().dirty).toBe(true);
    value(await h.store.saveMarks());
    expect(h.writes()).toBe(2);
  });
  it('preserves newer marks/notebook edits during pending saves against the committed snapshots', async () => {
    const h = harness();
    await h.store.initialize();
    const created = value(h.store.createMark({ label: 'snapshot', geometry: pin }));
    value(h.store.setNotebookText('snapshot text'));
    const marksSave = h.store.saveMarks(),
      notebookSave = h.store.saveNotebook();
    value(h.store.editMark(created.id, { label: 'newer draft', geometry: pin }));
    value(h.store.setNotebookText('newer text'));
    value(await marksSave);
    value(await notebookSave);
    expect(JSON.parse(h.records.get(h.marksKey)!).marks[0].label).toBe('snapshot');
    expect(JSON.parse(h.records.get(h.notebookKey)!).text).toBe('snapshot text');
    expect(h.store.marks()).toMatchObject({ dirty: true, busy: false, writable: true });
    expect(h.store.notebook()).toMatchObject({ draft: 'newer text', dirty: true });
    value(await h.store.saveMarks());
    value(await h.store.saveNotebook());
    expect(h.store.marks().dirty).toBe(false);
    expect(h.store.notebook().dirty).toBe(false);
  });
  it('quota/write denial preserves editable dirty notebook and safe retry', async () => {
    const h = harness();
    await h.store.initialize();
    value(h.store.setNotebookText('draft'));
    const set = vi.spyOn(h.storage, 'setItem').mockImplementationOnce(() => {
      throw { name: 'QuotaExceededError', message: 'private secret' };
    });
    code(await h.store.saveNotebook(), 'quota-exceeded');
    expect(h.store.notebook()).toMatchObject({ draft: 'draft', dirty: true, writable: true });
    expect(h.store.notebookExport()).toContain('draft');
    expect(h.store.notebook().error?.message).not.toContain('secret');
    value(h.store.setNotebookText('edited retry'));
    value(await h.store.saveNotebook());
    expect(set).toHaveBeenCalledTimes(2);
    expect(h.store.notebook().dirty).toBe(false);
  });
  it('notebook external conflict blocks saving and editing without erasing dirty text', async () => {
    const h = harness();
    await h.store.initialize();
    value(h.store.setNotebookText('local draft'));
    h.records.set(h.notebookKey, 'external');
    code(await h.store.saveNotebook(), 'conflict');
    expect(h.store.notebook()).toMatchObject({
      draft: 'local draft',
      dirty: true,
      writable: false,
    });
    code(h.store.setNotebookText('blocked'), 'not-ready');
    expect(h.records.get(h.notebookKey)).toBe('external');
    expect(h.writes()).toBe(0);
  });
  it('one-over notebook edit retains exact prior draft and has no truncation or autosave', async () => {
    const h = harness();
    await h.store.initialize();
    const text = 'x'.repeat(16384);
    value(h.store.setNotebookText(text));
    code(h.store.setNotebookText(text + 'x'), 'invalid-data');
    expect(h.store.notebook().draft).toBe(text);
    expect(h.store.notebookExport().endsWith(text)).toBe(true);
    expect(h.writes()).toBe(0);
    value(await h.store.saveNotebook());
    expect(h.store.notebook().dirty).toBe(false);
  });
  it('oversized valid marks stay renderable/editable and reduction permits safe retry', async () => {
    const h = harness();
    await h.store.initialize();
    const geometry: SceneMarkGeometry = {
      kind: 'polyline',
      points: Array.from({ length: 256 }, () => ({ x: 1234.123456789123, y: 2345.234567891234 })),
    };
    for (let i = 0; i < 90; i++)
      value(h.store.createMark({ label: '\u0000'.repeat(256), geometry }));
    code(await h.store.saveMarks(), 'invalid-data');
    expect(h.writes()).toBe(0);
    expect(h.store.marks()).toMatchObject({ dirty: true, writable: true, busy: false });
    expect(h.store.sceneMarks()).toHaveLength(90);
    const ids = h.store.marks().draft.map((mark) => mark.id);
    for (const id of ids.slice(1)) value(h.store.removeMark(id));
    value(await h.store.saveMarks());
    expect(h.store.marks().dirty).toBe(false);
    expect(h.writes()).toBe(1);
  });
  it('reused generated IDs cannot revive deleted provenance', async () => {
    const h = harness();
    const store = new PersonalStore(scope, binding, h.repository, { markId: () => 'same' });
    await store.initialize();
    const created = value(store.createMark({ label: 'original', geometry: pin }));
    value(store.removeMark(created.id));
    code(store.createMark({ label: 'reuse', geometry: pin }), 'conflict');
    expect(store.marks().draft).toEqual([]);
  });
});

describe('manual tool state, numeric placement and canvas completion', () => {
  it.each(['pin', 'symbol', 'ring', 'polyline', 'arrow'] as ManualTool[])(
    'numeric fractional create/edit/delete for %s',
    async (tool) => {
      const h = harness();
      await h.store.initialize();
      h.store.beginTool(tool);
      h.store.setMarkFields({
        label: 'literal <b>label</b>',
        x: '123.25',
        y: '456.75',
        radiusM: '12.75',
        symbol: 'dot',
      });
      if (tool === 'polyline' || tool === 'arrow') {
        value(h.store.appendNumericPoint());
        h.store.setMarkFields({ x: '5000', y: '3000' });
        value(h.store.appendNumericPoint());
      }
      const created = value(h.store.commitMark());
      expect(created.geometry.kind).toBe(tool);
      expect(created.editedAtGame).toBe(null);
      value(h.store.beginEdit(created.id));
      h.store.setMarkFields({ label: 'changed', x: '987.5', y: '654.25' });
      const edited = value(h.store.commitMark());
      expect(edited.id).toBe(created.id);
      expect(edited.editedAtGame).toBe(0);
      expect(h.store.marks().draft).toHaveLength(1);
      value(h.store.removeMark(created.id));
      expect(h.store.marks().draft).toEqual([]);
      expect(h.store.markForm().editingId).toBeUndefined();
    },
  );
  it.each(['', '  ', 'NaN', 'Infinity', '5000.001', '-0.01'])(
    'retains invalid numeric x=%s for correction without clamping',
    async (x) => {
      const h = harness();
      await h.store.initialize();
      h.store.setMarkFields({ label: 'unfinished', x, y: '0' });
      code(h.store.commitMark(), 'invalid-data');
      expect(h.store.markForm().x).toBe(x);
      expect(h.store.sceneMarks()).toEqual([]);
    },
  );
  it('explicit arming locks camera, stale/unarmed canvas points are rejected, valid single point commits then stops', async () => {
    const h = harness();
    await h.store.initialize();
    code(h.store.acceptPoint({ key: scope.gameId, at: { x: 1, y: 2 } }), 'not-ready');
    h.store.setMarkFields({ label: 'from map' });
    value(h.store.startDrawing());
    expect(h.store.cameraEnabled()).toBe(false);
    code(h.store.acceptPoint({ key: otherScope.gameId, at: { x: 1, y: 2 } }), 'not-ready');
    expect(h.store.drawingActive()).toBe(true);
    value(h.store.acceptPoint({ key: scope.gameId, at: { x: 5000, y: 3000 } }));
    expect(h.store.marks().draft[0]!.geometry).toEqual({ kind: 'pin', at: { x: 5000, y: 3000 } });
    expect(h.store.cameraEnabled()).toBe(true);
    expect(h.store.drawingActive()).toBe(false);
    expect(h.writes()).toBe(0);
  });
  it('invalid radius/label keeps single-point drawing armed and unfinished form visible', async () => {
    const h = harness();
    await h.store.initialize();
    h.store.beginTool('ring');
    h.store.setMarkFields({ radiusM: 'bad' });
    value(h.store.startDrawing());
    code(h.store.acceptPoint({ key: scope.gameId, at: { x: 1, y: 2 } }), 'invalid-data');
    expect(h.store.drawingActive()).toBe(true);
    expect(h.store.markForm().radiusM).toBe('bad');
    h.store.setMarkFields({ radiusM: '20', label: 'x'.repeat(257) });
    code(h.store.acceptPoint({ key: scope.gameId, at: { x: 1, y: 2 } }), 'invalid-data');
    expect(h.store.marks().draft).toEqual([]);
    h.store.setMarkFields({ label: 'valid' });
    value(h.store.acceptPoint({ key: scope.gameId, at: { x: 1, y: 2 } }));
    expect(h.store.drawingActive()).toBe(false);
  });
  it.each(['polyline', 'arrow'] as ManualTool[])(
    '%s points preserve order/removal/Stop, require two, reject 257 and Finish restores camera',
    async (tool) => {
      const h = harness();
      await h.store.initialize();
      h.store.beginTool(tool);
      value(h.store.startDrawing());
      value(h.store.acceptPoint({ key: scope.gameId, at: { x: 1.25, y: 2.5 } }));
      code(h.store.finishDrawing(), 'invalid-data');
      h.store.stopDrawing();
      expect(h.store.markForm().points).toEqual([{ x: 1.25, y: 2.5 }]);
      expect(h.store.cameraEnabled()).toBe(true);
      value(h.store.startDrawing());
      for (let i = 1; i < 256; i++)
        value(h.store.acceptPoint({ key: scope.gameId, at: { x: i, y: i } }));
      code(h.store.acceptPoint({ key: scope.gameId, at: { x: 1, y: 2 } }), 'invalid-data');
      expect(h.store.markForm().points).toHaveLength(256);
      h.store.removeDraftPoint(1);
      expect(h.store.markForm().points[1]).toEqual({ x: 2, y: 2 });
      value(h.store.finishDrawing());
      expect(h.store.cameraEnabled()).toBe(true);
      expect(h.store.drawingActive()).toBe(false);
      expect(h.store.sceneMarks()).toHaveLength(1);
    },
  );
  it('interaction off preserves armed draft/points/text through Cancel and blocks mutations/writes/placement', async () => {
    const h = harness();
    await h.store.initialize();
    h.store.beginTool('arrow');
    h.store.setMarkFields({ label: 'draft', x: '1.25', y: '2.5' });
    value(h.store.appendNumericPoint());
    value(h.store.startDrawing());
    value(h.store.setNotebookText('notes'));
    h.store.setInteractionEnabled(false);
    const form = h.store.markForm();
    code(h.store.acceptPoint({ key: scope.gameId, at: { x: 3, y: 4 } }), 'not-ready');
    code(h.store.createMark({ label: 'blocked', geometry: pin }), 'not-ready');
    code(h.store.setNotebookText('blocked'), 'not-ready');
    code(await h.store.saveNotebook(), 'not-ready');
    h.store.beginTool('pin');
    h.store.setMarkFields({ label: 'blocked' });
    h.store.removeDraftPoint(0);
    h.store.stopDrawing();
    expect(h.store.markForm().label).toBe(form.label);
    expect(h.store.markForm().points).toEqual(form.points);
    expect(h.store.drawingActive()).toBe(true);
    h.store.setNotebookQuery(' NOTES ');
    expect(h.store.notebookMatches()).toHaveLength(1);
    expect(h.store.notebookExport()).toContain('notes');
    h.store.setInteractionEnabled(true);
    expect(h.store.cameraEnabled()).toBe(false);
    value(h.store.acceptPoint({ key: scope.gameId, at: { x: 3, y: 4 } }));
    value(h.store.finishDrawing());
    expect(h.store.notebook().draft).toBe('notes');
    expect(h.writes()).toBe(0);
  });
});

describe('store teardown and late completion', () => {
  it('idempotent disposal clears private RAM synchronously and queued operations cannot publish', async () => {
    const h = harness();
    await h.store.initialize();
    value(h.store.setNotebookText('private draft'));
    h.store.setNotebookQuery('private');
    h.store.setMarkFields({ label: 'private form' });
    const pending = h.store.saveNotebook();
    const disposal = h.store.dispose();
    expect(h.store.dispose()).toBe(disposal);
    expect(h.store.disposed()).toBe(true);
    expect(h.store.notebook().draft).toBe('');
    expect(h.store.markForm().label).toBe('');
    expect(h.store.notebookExport()).toBe('');
    code(await pending, 'disposed');
    await disposal;
    expect(h.writes()).toBe(0);
    expect(h.store.marks().busy).toBe(false);
    code(h.store.setNotebookText('late'), 'disposed');
    h.store.setNotebookQuery('late');
    expect(h.store.notebookQuery()).toBe('');
  });
  it('committed write followed by disposal returns success while disposed signals stay empty', async () => {
    const h = harness();
    await h.store.initialize();
    value(h.store.setNotebookText('committed'));
    const original = h.storage.setItem;
    vi.spyOn(h.storage, 'setItem').mockImplementation((key, raw) => {
      original(key, raw);
      void h.store.dispose();
    });
    expect(value(await h.store.saveNotebook()).text).toBe('committed');
    await h.store.dispose();
    expect(JSON.parse(h.records.get(h.notebookKey)!).text).toBe('committed');
    expect(h.store.notebook().draft).toBe('');
    expect(h.store.notebook().writable).toBe(false);
  });
});
