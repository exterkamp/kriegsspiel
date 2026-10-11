import { describe, expect, it, vi } from 'vitest';
import type { Result } from '../../contracts';
import { createReportPlacementController } from './controller';
import { artwork, capture, deferred, fail, ok, pointer, scope, setup, value } from './fakes';

async function started(s = setup(), p: ReturnType<typeof pointer> | null = null) {
  const r = value(s.controller.begin(capture(), p));
  expect(await r.ready).toEqual(ok(undefined));
  return { ...s, r };
}
describe('frozen report placement', () => {
  it('report refresh/removal and clock mutation after settlement cannot rewrite pending provenance', async () => {
    const s = setup();
    const raw = capture();
    const r = value(s.controller.begin(raw, null));
    await r.ready;
    Object.assign(raw.snapshot.papers[0]!, { text: 'Fresh report', receivedAtGame: 250 });
    Object.assign(raw.snapshot.clock, { authoritativeGameMs: 9999 });
    Object.assign(raw.snapshot, { papers: [], atGame: 9999 });
    value(s.controller.place(r.id, { x: 1, y: 2 }, 'Captured'));
    expect(s.ports.createPin.mock.calls[0]![0]).toMatchObject({
      gameMs: 450,
      snapshot: {
        atGame: 300,
        clock: { authoritativeGameMs: 300 },
        papers: [{ receivedAtGame: 200, text: 'Supplied report <img src=x>.' }],
      },
    });
  });
  it.each(['check', 'acquireControls', 'capturePointer'] as const)(
    'start failure at %s releases prior acquisitions without navigation',
    (port) => {
      const s = setup();
      s.ports[port].mockReturnValue(fail('Unavailable'));
      expect(s.controller.begin(capture(), pointer())).toMatchObject({ ok: false });
      expect(s.controller.getState().phase).toBe('finished');
      expect(s.ports.enterTable).not.toHaveBeenCalled();
      expect(s.releaseControls).toHaveBeenCalledTimes(port === 'capturePointer' ? 1 : 0);
      expect(s.releasePointer).not.toHaveBeenCalled();
    },
  );
  it('navigation and settlement-readiness failures resolve ready with the actual error and release', async () => {
    const s = setup();
    s.ports.enterTable.mockResolvedValueOnce(fail('Rollback'));
    const first = value(s.controller.begin(capture(), pointer()));
    expect(await first.ready).toMatchObject({ ok: false, error: { message: 'Rollback' } });
    s.ports.check.mockImplementation((stage) =>
      stage === 'place' ? fail('Presentation unsettled') : ok(undefined),
    );
    const next = value(s.controller.begin(capture(), pointer()));
    expect(await next.ready).toMatchObject({
      ok: false,
      error: { message: 'Presentation unsettled' },
    });
    expect(s.releasePointer).toHaveBeenCalledTimes(2);
    expect(s.releaseControls).toHaveBeenCalledTimes(2);
    expect(s.ports.createPin).not.toHaveBeenCalled();
  });
  it.each(['acquireControls', 'capturePointer'] as const)(
    'late %s releaser from reentrant begin cannot release successor resources',
    async (port) => {
      const s = setup();
      const oldRelease = vi.fn();
      const newRelease = vi.fn();
      let nextId = 0;
      s.ports[port].mockImplementationOnce(() => {
        s.ports[port].mockReturnValue(ok(newRelease));
        nextId = value(s.controller.begin(capture(), pointer())).id;
        return ok(oldRelease);
      });
      expect(s.controller.begin(capture(), pointer()).ok).toBe(false);
      await Promise.resolve();
      await Promise.resolve();
      expect(s.controller.getState()).toMatchObject({ requestId: nextId, phase: 'placing' });
      expect(oldRelease).toHaveBeenCalledTimes(1);
      expect(newRelease).not.toHaveBeenCalled();
      s.controller.dispose();
      expect(newRelease).toHaveBeenCalledTimes(1);
    },
  );
  it('reentrant enterTable supersedes before return; old rejection stays observed and cannot publish', async () => {
    const s = setup();
    const late = deferred<Result<void>>();
    let nextId = 0;
    s.ports.enterTable.mockImplementationOnce(() => {
      nextId = value(s.controller.begin(capture(), null)).id;
      return late.promise;
    });
    expect(s.controller.begin(capture(), null).ok).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    const settled = s.controller.getState();
    expect(settled.requestId).toBe(nextId);
    late.reject(Error('Late old navigation'));
    await Promise.resolve();
    expect(s.controller.getState()).toBe(settled);
  });
  it.each(['pickAt', 'project'] as const)(
    'reentrant %s begin prevents old preview/drop from entering successor',
    async (port) => {
      const s = await started(setup(), pointer());
      let nextId = 0;
      if (port === 'pickAt') {
        s.ports.pickAt.mockImplementation(() => {
          nextId = value(s.controller.begin(capture(), null)).id;
          return ok({ kind: 'map', at: { x: 1, y: 2 } });
        });
        expect(s.controller.pointer(s.r.id, 'up', pointer()).ok).toBe(false);
      } else {
        s.ports.project.mockImplementation(() => {
          nextId = value(s.controller.begin(capture(), null)).id;
          return ok({ clientXCssPx: 1, clientYCssPx: 2 });
        });
        expect(s.controller.preview(s.r.id, { x: 1, y: 2 }, 'Old').ok).toBe(false);
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(s.controller.getState()).toMatchObject({
        requestId: nextId,
        preview: null,
        label: 'Scout: report',
      });
      expect(s.ports.createPin).not.toHaveBeenCalled();
    },
  );
  it('reentrant notification stops old listener delivery; newly acquired leases precede notifications', async () => {
    const s = setup();
    const seen: number[] = [];
    let superseded = false;
    s.controller.subscribe((state) => {
      if (state.phase === 'navigating' && !superseded) {
        expect(s.ports.acquireControls).toHaveBeenCalledTimes(1);
        expect(s.ports.capturePointer).toHaveBeenCalledTimes(1);
        superseded = true;
        s.controller.begin(capture(), null);
      }
    });
    s.controller.subscribe((state) => {
      if (state.requestId !== null) seen.push(state.requestId);
    });
    expect(s.controller.begin(capture(), pointer()).ok).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).not.toContain(1);
    expect(seen).toEqual([2, 2]);
  });
  it('terminal late navigation success and late ready listener cannot revive state or resources', async () => {
    const s = setup();
    const d = deferred<Result<void>>();
    s.ports.enterTable.mockReturnValue(d.promise);
    const r = value(s.controller.begin(capture(), pointer()));
    s.controller.dispose();
    expect(await r.ready).toMatchObject({ ok: false });
    const dead = s.controller.getState();
    d.resolve(ok(undefined));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.controller.getState()).toBe(dead);
    expect(s.ports.createPin).not.toHaveBeenCalled();
    expect(s.releasePointer).toHaveBeenCalledTimes(1);
    expect(s.releaseControls).toHaveBeenCalledTimes(1);
  });
  it('clones binding/full capture before callbacks; reported location is distinct from chosen point', async () => {
    const s = setup();
    const raw = capture();
    s.ports.acquireControls.mockImplementation(() => {
      Object.assign(raw, { gameMs: 999 });
      Object.assign(raw.snapshot.papers[0]!, {
        from: 'Changed',
        text: 'Changed',
        location: { x: 9, y: 9 },
      });
      return ok(s.releaseControls);
    });
    const r = value(s.controller.begin(raw, null));
    await r.ready;
    expect(s.controller.getState()).toMatchObject({
      gameMs: 450,
      paper: { from: 'Scout', location: null },
    });
    value(s.controller.place(r.id, { x: 1000.5, y: 0 }, '<script>plain</script>'));
    const [saved, at, label] = s.ports.createPin.mock.calls[0]!;
    expect(saved.snapshot.papers[0]).toMatchObject({
      from: 'Scout',
      location: null,
      text: 'Supplied report <img src=x>.',
    });
    expect(saved.gameMs).toBe(450);
    expect(at).toEqual({ x: 1000.5, y: 0 });
    expect(label).toBe('<script>plain</script>');
    expect(Object.isFrozen(saved.snapshot.clock.barrier)).toBe(true);
    expect(Object.isFrozen(saved.snapshot.papers[0])).toBe(true);
  });
  it('deeply freezes exposed state, scope and complete artwork without freezing caller objects', async () => {
    const s = setup();
    const input = capture();
    const r = value(s.controller.begin(input, null));
    await r.ready;
    expect(Object.isFrozen(s.controller.scope)).toBe(true);
    expect(Object.isFrozen(s.controller.artwork.image)).toBe(true);
    expect(Object.isFrozen(s.controller.getState().paper)).toBe(true);
    expect(Object.isFrozen(input.snapshot)).toBe(false);
  });
  it.each([
    'missing',
    'duplicate',
    'scope',
    'date',
    'future',
    'location',
    'time',
    'metadata',
    'malformed',
  ])('rejects %s before acquiring or navigating', (mode) => {
    const s = setup();
    const raw = structuredClone(capture());
    if (mode === 'missing') Object.assign(raw, { paperId: 'missing' });
    if (mode === 'duplicate')
      Object.assign(raw.snapshot, { papers: [...raw.snapshot.papers, raw.snapshot.papers[0]] });
    if (mode === 'scope') Object.assign(raw.snapshot.scope, { playerId: 'other' });
    if (mode === 'date') Object.assign(raw.snapshot.papers[0]!, { observedAtGame: 101 });
    if (mode === 'future') Object.assign(raw.snapshot.papers[0]!, { receivedAtGame: 301 });
    if (mode === 'location')
      Object.assign(raw.snapshot.papers[0]!, { location: { x: 4000.000001, y: 0 } });
    if (mode === 'time') Object.assign(raw, { gameMs: 199 });
    if (mode === 'metadata') Object.assign(raw.snapshot.papers[0]!, { confidence: 'invented' });
    if (mode === 'malformed') Object.assign(raw.snapshot, { papers: null });
    expect(s.controller.begin(raw, null).ok).toBe(false);
    expect(s.ports.acquireControls).not.toHaveBeenCalled();
    expect(s.ports.enterTable).not.toHaveBeenCalled();
  });
  it('preserves nullable location/observed and unavailable placement time', async () => {
    const s = setup();
    const raw = { ...capture(), gameMs: null };
    const r = value(s.controller.begin(raw, null));
    await r.ready;
    value(s.controller.place(r.id, { x: 0, y: 3000 }, 'Unknown source position'));
    expect(s.ports.createPin.mock.calls[0]![0]).toMatchObject({
      gameMs: null,
      snapshot: { papers: [{ location: null, observedAtGame: null }] },
    });
  });
  it.each([
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 0, y: 3000 },
    { x: 4000, y: 3000 },
    { x: 351.12345, y: 210.23456 },
  ])('places inclusive exact metre point %j', async (at) => {
    const s = await started();
    expect(s.controller.place(s.r.id, at, 'Pin')).toEqual(ok({ kind: 'created', warning: null }));
    expect(s.ports.createPin.mock.calls[0]![1]).toEqual(at);
  });
  it.each([
    { x: -0.000001, y: 0 },
    { x: 4000.000001, y: 0 },
    { x: 0, y: 3000.000001 },
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ])('rejects off-map/nonfinite point %j recoverably', async (at) => {
    const s = await started();
    expect(s.controller.place(s.r.id, at, 'Pin').ok).toBe(false);
    expect(s.controller.getState().phase).toBe('placing');
    expect(s.ports.createPin).not.toHaveBeenCalled();
    expect(s.controller.place(s.r.id, { x: 0, y: 0 }, 'Recovered').ok).toBe(true);
  });
  it('projects numeric preview; null means valid offscreen; malformed or throwing projection cannot commit', async () => {
    const s = await started();
    s.ports.project.mockReturnValue(ok(null));
    value(s.controller.preview(s.r.id, { x: 4000, y: 3000 }, 'Offscreen'));
    expect(s.controller.getState().preview).toEqual({ at: { x: 4000, y: 3000 }, css: null });
    s.ports.project.mockImplementation(() => {
      throw Error('secret');
    });
    expect(s.controller.preview(s.r.id, { x: 1, y: 1 }, 'label').ok).toBe(false);
    expect(s.controller.getState().preview).toBeNull();
    expect(s.ports.createPin).not.toHaveBeenCalled();
  });
  it.each(['mouse', 'touch', 'pen'] as const)(
    'owns primary %s pointer, uses actual piece hit and fresh up coordinates',
    async (pointerType) => {
      const s = await started(setup(), pointer({ pointerType }));
      s.ports.pickAt
        .mockReturnValueOnce(ok({ kind: 'map', at: { x: 11, y: 22 } }))
        .mockReturnValueOnce(
          ok({ kind: 'piece', key: 'own:p', unitId: 'p', at: { x: 32.5, y: 42.75 } }),
        );
      value(s.controller.pointer(s.r.id, 'move', pointer({ pointerType })));
      value(
        s.controller.pointer(
          s.r.id,
          'up',
          pointer({ pointerType, clientXCssPx: 900, clientYCssPx: 800 }),
        ),
      );
      expect(s.ports.pickAt.mock.calls).toEqual([
        [350.125, 250.875],
        [900, 800],
      ]);
      expect(s.ports.createPin.mock.calls[0]![1]).toEqual({ x: 32.5, y: 42.75 });
      expect(s.releaseControls).toHaveBeenCalledTimes(1);
      expect(s.releasePointer).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['none', 'error', 'offmap'])(
    'offmap/panel %s up releases contact but retains captured request for retry',
    async (mode) => {
      const s = await started(setup(), pointer());
      s.ports.pickAt.mockReturnValue(
        mode === 'none'
          ? ok({ kind: 'none' })
          : mode === 'error'
            ? fail()
            : ok({ kind: 'map', at: { x: -1, y: 0 } }),
      );
      expect(s.controller.pointer(s.r.id, 'up', pointer())).toEqual(ok(null));
      expect(s.controller.getState()).toMatchObject({
        phase: 'placing',
        pointerId: null,
        preview: null,
        paper: { id: 'paper' },
      });
      expect(s.releasePointer).toHaveBeenCalledTimes(1);
      expect(s.releaseControls).not.toHaveBeenCalled();
      value(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Numeric retry'));
    },
  );
  it.each(['numeric', 'pointer'] as const)(
    'readiness lost between move/up releases contact and permits %s retry with the same frozen capture',
    async (retry) => {
      const s = setup();
      const raw = capture();
      const r = value(s.controller.begin(raw, pointer()));
      await r.ready;
      const paper = s.controller.getState().paper;
      value(s.controller.pointer(r.id, 'move', pointer()));
      expect(s.controller.getState().preview?.at).toEqual({ x: 350.125, y: 250.875 });
      Object.assign(raw.snapshot.papers[0]!, { text: 'Changed after capture' });
      s.ports.check.mockReturnValue(fail('Map apply pending'));
      s.releasePointer.mockImplementation(() => {
        value(s.controller.pointer(r.id, 'lost-capture', pointer()));
      });
      expect(s.controller.pointer(r.id, 'up', pointer())).toMatchObject({
        ok: false,
        error: { code: 'not-ready', message: 'Map apply pending' },
      });
      expect(s.controller.getState()).toMatchObject({
        requestId: r.id,
        phase: 'placing',
        pointerId: null,
        preview: null,
        outcome: 'none',
      });
      expect(s.controller.getState().paper).toEqual(paper);
      expect(s.releasePointer).toHaveBeenCalledTimes(1);
      expect(s.releaseControls).not.toHaveBeenCalled();
      expect(s.ports.pickAt).toHaveBeenCalledTimes(1);
      expect(s.ports.createPin).not.toHaveBeenCalled();
      s.ports.check.mockReturnValue(ok(undefined));
      if (retry === 'numeric') value(s.controller.place(r.id, { x: 100, y: 200 }, 'Retry'));
      else {
        value(s.controller.pointer(r.id, 'down', pointer()));
        value(s.controller.pointer(r.id, 'up', pointer()));
      }
      expect(s.ports.createPin).toHaveBeenCalledTimes(1);
      expect(s.ports.createPin.mock.calls[0]![0].snapshot.papers[0]!.text).toBe(
        'Supplied report <img src=x>.',
      );
      expect(s.releasePointer).toHaveBeenCalledTimes(retry === 'numeric' ? 1 : 2);
      expect(s.releaseControls).toHaveBeenCalledTimes(1);
    },
  );
  it('readiness lost inside fresh up pick releases contact before the second readiness rejection', async () => {
    const s = await started(setup(), pointer());
    value(s.controller.pointer(s.r.id, 'move', pointer()));
    s.ports.pickAt.mockImplementation(() => {
      s.ports.check.mockReturnValue(fail('Map apply pending'));
      return ok({ kind: 'map', at: { x: 1, y: 2 } });
    });
    expect(s.controller.pointer(s.r.id, 'up', pointer())).toMatchObject({ ok: false });
    expect(s.controller.getState()).toMatchObject({
      phase: 'placing',
      requestId: s.r.id,
      pointerId: null,
      preview: null,
    });
    expect(s.releasePointer).toHaveBeenCalledTimes(1);
    expect(s.ports.createPin).not.toHaveBeenCalled();
    s.ports.check.mockReturnValue(ok(undefined));
    value(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Numeric retry'));
  });
  it.each(['dispose', 'successor'] as const)(
    'refused-drop release callback %s prevents old state publication and duplicate cleanup',
    async (action) => {
      const s = await started(setup(), pointer());
      value(s.controller.pointer(s.r.id, 'move', pointer()));
      s.ports.check.mockReturnValueOnce(fail('Map apply pending'));
      const nextRelease = vi.fn();
      let nextId = 0;
      s.releasePointer.mockImplementation(() => {
        if (action === 'dispose') s.controller.dispose();
        else {
          s.ports.capturePointer.mockReturnValue(ok(nextRelease));
          nextId = value(s.controller.begin(capture(), pointer())).id;
        }
      });
      expect(s.controller.pointer(s.r.id, 'up', pointer())).toMatchObject({
        ok: false,
        error: { code: 'aborted' },
      });
      expect(s.releasePointer).toHaveBeenCalledTimes(1);
      expect(s.ports.createPin).not.toHaveBeenCalled();
      if (action === 'dispose') {
        expect(s.controller.getState()).toMatchObject({
          phase: 'disposed',
          preview: null,
          paper: null,
        });
      } else {
        await Promise.resolve();
        await Promise.resolve();
        expect(s.controller.getState()).toMatchObject({
          requestId: nextId,
          phase: 'placing',
          pointerId: 7,
          preview: null,
          error: null,
        });
        expect(nextRelease).not.toHaveBeenCalled();
        value(s.controller.pointer(nextId, 'up', pointer()));
        expect(nextRelease).toHaveBeenCalledTimes(1);
        expect(s.ports.createPin).toHaveBeenCalledTimes(1);
      }
    },
  );
  it('cancel before navigation settles is prompt, never buffers a release; late failure cannot publish', async () => {
    const s = setup();
    const d = deferred<Result<void>>();
    s.ports.enterTable.mockReturnValue(d.promise);
    const r = value(s.controller.begin(capture(), pointer()));
    expect(s.controller.pointer(r.id, 'move', pointer()).ok).toBe(false);
    expect(s.ports.pickAt).not.toHaveBeenCalled();
    value(s.controller.pointer(r.id, 'up', pointer()));
    expect(await r.ready).toMatchObject({ ok: false, error: { code: 'aborted' } });
    const state = s.controller.getState();
    d.reject(Error('late'));
    await Promise.resolve();
    expect(s.controller.getState()).toBe(state);
    expect(s.ports.createPin).not.toHaveBeenCalled();
  });
  it('new request settles old ready and recycled pointer IDs cannot revive old request', async () => {
    const s = setup();
    const d = deferred<Result<void>>();
    s.ports.enterTable.mockReturnValueOnce(d.promise);
    const old = value(s.controller.begin(capture(), pointer()));
    const next = value(s.controller.begin(capture(), pointer()));
    await next.ready;
    expect(await old.ready).toMatchObject({ ok: false });
    expect(s.controller.pointer(old.id, 'up', pointer()).ok).toBe(false);
    d.resolve(ok(undefined));
    await Promise.resolve();
    expect(s.controller.getState().requestId).toBe(next.id);
    value(s.controller.pointer(next.id, 'up', pointer()));
    expect(s.ports.createPin).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'lost-capture'] as const)(
    'owner %s cancels; non-owner packets cannot place/cancel',
    async (event) => {
      const s = await started(setup(), pointer());
      value(s.controller.pointer(s.r.id, event, pointer({ pointerId: 8 })));
      expect(s.controller.getState().phase).toBe('placing');
      value(s.controller.pointer(s.r.id, 'up', pointer({ pointerId: 8 })));
      value(s.controller.pointer(s.r.id, event, pointer()));
      expect(s.controller.getState().phase).toBe('finished');
      expect(s.ports.createPin).not.toHaveBeenCalled();
    },
  );
  it('secondary touch cancels instead of pinching/placing', async () => {
    const s = await started(setup(), pointer({ pointerType: 'touch' }));
    value(
      s.controller.pointer(
        s.r.id,
        'down',
        pointer({ pointerId: 9, pointerType: 'touch', isPrimary: false }),
      ),
    );
    expect(s.controller.getState().phase).toBe('finished');
    expect(s.ports.createPin).not.toHaveBeenCalled();
  });
  it('released offmap contact can be reacquired; synchronous deliberate capture-loss is ignored', async () => {
    const s = await started(setup(), pointer());
    s.releasePointer.mockImplementation(() => {
      s.controller.pointer(s.r.id, 'lost-capture', pointer());
    });
    s.ports.pickAt.mockReturnValueOnce(ok({ kind: 'none' }));
    value(s.controller.pointer(s.r.id, 'up', pointer()));
    value(s.controller.pointer(s.r.id, 'down', pointer()));
    value(s.controller.pointer(s.r.id, 'up', pointer()));
    expect(s.ports.createPin).toHaveBeenCalledTimes(1);
    expect(s.releasePointer).toHaveBeenCalledTimes(2);
  });
  it('returned creation failure is recoverable; check place busy guards reject before creation', async () => {
    const s = await started();
    s.ports.check.mockReturnValueOnce(fail('Busy'));
    expect(s.controller.place(s.r.id, { x: 0, y: 0 }, 'Pin').ok).toBe(false);
    s.ports.createPin.mockReturnValueOnce(fail('Quota'));
    expect(s.controller.place(s.r.id, { x: 0, y: 0 }, 'Pin').ok).toBe(false);
    expect(s.controller.getState().phase).toBe('placing');
    value(s.controller.place(s.r.id, { x: 0, y: 0 }, 'Retry'));
    expect(s.ports.createPin).toHaveBeenCalledTimes(2);
  });
  it('consumes request before create; double/reentrant place and begin cannot create twice', async () => {
    const s = await started();
    s.ports.createPin.mockImplementation(() => {
      expect(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Nested').ok).toBe(false);
      expect(s.controller.begin(capture(), null)).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      });
      return ok(undefined);
    });
    value(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Once'));
    expect(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Twice').ok).toBe(false);
    expect(s.ports.createPin).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'dispose'] as const)(
    'committing subscriber %s before invocation creates nothing',
    async (mode) => {
      const s = await started();
      s.controller.subscribe((state) => {
        if (state.phase === 'committing')
          if (mode === 'dispose') s.controller.dispose();
          else s.controller.cancel(s.r.id);
      });
      expect(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Pin').ok).toBe(false);
      expect(s.ports.createPin).not.toHaveBeenCalled();
    },
  );
  it.each(['cancel', 'dispose'] as const)(
    'successful create after reentrant %s remains created, with cleanup warning',
    async (mode) => {
      const s = await started();
      s.releaseControls.mockImplementation(() => {
        throw Error('cleanup');
      });
      s.ports.createPin.mockImplementation(() => {
        if (mode === 'dispose') s.controller.dispose();
        else s.controller.cancel(s.r.id);
        return ok(undefined);
      });
      const receipt = value(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Pin'));
      expect(receipt).toMatchObject({
        kind: 'created',
        warning: { message: 'Created locally; unsaved. Placement cleanup failed.' },
      });
      expect(s.controller.getState().phase).toBe(mode === 'dispose' ? 'disposed' : 'finished');
      expect(s.releaseControls).toHaveBeenCalledTimes(1);
    },
  );
  it('thrown after RAM mutation is outcome-unknown, never retryable on same request', async () => {
    const s = await started();
    const ram: string[] = [];
    s.ports.createPin.mockImplementation(() => {
      ram.push('created');
      throw Error('secret');
    });
    expect(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Pin')).toMatchObject({
      ok: false,
      error: { code: 'outcome-unknown' },
    });
    expect(s.controller.getState()).toMatchObject({ phase: 'finished', outcome: 'unknown' });
    expect(s.controller.place(s.r.id, { x: 1, y: 2 }, 'Retry').ok).toBe(false);
    expect(ram).toEqual(['created']);
  });
  it.each(['check', 'acquireControls', 'capturePointer', 'pickAt', 'project'] as const)(
    'reentrant dispose in %s prevents revival and releases late resources',
    async (port) => {
      const s = setup();
      if (port === 'check')
        s.ports.check.mockImplementation(() => {
          s.controller.dispose();
          return ok(undefined);
        });
      if (port === 'acquireControls')
        s.ports.acquireControls.mockImplementation(() => {
          s.controller.dispose();
          return ok(s.releaseControls);
        });
      if (port === 'capturePointer')
        s.ports.capturePointer.mockImplementation(() => {
          s.controller.dispose();
          return ok(s.releasePointer);
        });
      if (port === 'pickAt' || port === 'project') {
        const r = value(s.controller.begin(capture(), pointer()));
        await r.ready;
        if (port === 'pickAt') {
          s.ports.pickAt.mockImplementation(() => {
            s.controller.dispose();
            return ok({ kind: 'map', at: { x: 1, y: 2 } });
          });
          s.controller.pointer(r.id, 'up', pointer());
        } else {
          s.ports.project.mockImplementation(() => {
            s.controller.dispose();
            return ok(null);
          });
          s.controller.preview(r.id, { x: 1, y: 2 }, 'Pin');
        }
      } else expect(s.controller.begin(capture(), pointer()).ok).toBe(false);
      expect(s.controller.getState()).toMatchObject({
        phase: 'disposed',
        paper: null,
        preview: null,
      });
      expect(s.ports.createPin).not.toHaveBeenCalled();
      if (port === 'acquireControls') expect(s.releaseControls).toHaveBeenCalledTimes(1);
      if (port === 'capturePointer') expect(s.releasePointer).toHaveBeenCalledTimes(1);
    },
  );
  it('release callbacks may start successor; late old cleanup does not release successor', async () => {
    const s = await started();
    const nextRelease = vi.fn();
    s.ports.acquireControls.mockReturnValue(ok(nextRelease));
    s.releaseControls.mockImplementation(() => {
      s.controller.begin(capture(), null);
    });
    value(s.controller.cancel(s.r.id));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.controller.getState().phase).toBe('placing');
    expect(nextRelease).not.toHaveBeenCalled();
    s.controller.dispose();
    expect(nextRelease).toHaveBeenCalledTimes(1);
  });
  it('isolates observers, stops old delivery after reentrant begin, unsubscribes idempotently and disposes terminally', async () => {
    const s = setup();
    const listener = vi.fn();
    const stop = s.controller.subscribe(listener);
    s.controller.subscribe(() => {
      throw Error('subscriber');
    });
    await started(s);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    stop();
    stop();
    const count = listener.mock.calls.length;
    s.controller.dispose();
    s.controller.dispose();
    expect(listener).toHaveBeenCalledTimes(count);
    const dead = vi.fn();
    s.controller.subscribe(dead);
    expect(dead).toHaveBeenCalledTimes(1);
    expect(s.controller.begin(capture(), null).ok).toBe(false);
    expect(Object.keys(s.ports).sort()).toEqual([
      'acquireControls',
      'capturePointer',
      'check',
      'createPin',
      'enterTable',
      'pickAt',
      'project',
    ]);
  });
  it('rejects malformed binding and invalid/secondary initiating pointers', () => {
    const s = setup();
    expect(() =>
      createReportPlacementController({
        scope,
        artwork: { ...artwork, widthM: 0 },
        ports: s.ports,
      }),
    ).toThrow();
    for (const p of [
      pointer({ button: 2 }),
      pointer({ isPrimary: false }),
      pointer({ clientXCssPx: NaN }),
    ])
      expect(s.controller.begin(capture(), p).ok).toBe(false);
  });
});
