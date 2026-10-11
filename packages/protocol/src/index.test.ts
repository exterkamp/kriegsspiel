import { describe, expect, it } from 'vitest';
import {
  Command,
  Intent,
  PROTOCOL_VERSION,
  parseCommand,
  parseServerMessage,
  serializeCommand,
  serializeServerMessage,
  type ServerMessage,
  type SideView,
} from './index.js';
import { parseWith } from './messages.js';

const v = PROTOCOL_VERSION;
const clock = { gameMsAtAnchor: 0, wallMsAtAnchor: 1000, rate: 4, status: 'running' } as const;
const view: SideView = {
  side: 'red',
  atGame: 5000,
  ownUnits: [
    {
      id: 'u1',
      name: '1st Bde',
      position: { x: 1203.457, y: 2204.5 },
      facing: 0.6457718,
      formation: 'loose',
      footprint: { frontage: 250, depth: 40 },
      shape: [
        { x: -120.5, y: -3 },
        { x: 0, y: 11.25 },
        { x: 118, y: -2.5 },
      ],
      strength: 3000,
      morale: 0.8,
      supply: 1,
    },
  ],
  visibleEnemies: [
    {
      id: 'e1',
      position: { x: 5.5, y: 5.25 },
      facing: 3.14159,
      formation: 'line',
      footprint: { frontage: 80, depth: 10 },
      sizeEstimate: 'a battalion',
    },
  ],
  lastKnownContacts: [
    {
      id: 'c1',
      position: { x: 9.75, y: 9 },
      observedAtGame: 100,
      ageMs: 4900,
      uncertaintyRadius: 100,
    },
  ],
  dispatches: [],
  clock,
};

describe('Command', () => {
  const good: Command[] = [
    { v, kind: 'issueOrder', orderId: 'o1', draft: 'd1' },
    { v, kind: 'issueOrder', orderId: 'o2', text: 'Blue-1 march to the bridge' },
    { v, kind: 'setReady', ready: true },
    { v, kind: 'proposePause', reason: 'door' },
    { v, kind: 'proposeResume' },
    { v, kind: 'vote', proposal: 'p1', yes: false },
    { v, kind: 'draftEdit', draft: 'd1', ops: [] },
  ];
  it.each(good)('round-trips $kind', (c) => {
    const r = parseCommand(serializeCommand(c));
    expect(r).toEqual({ ok: true, value: c });
  });

  it.each([
    ['not json', '{'],
    ['wrong version', JSON.stringify({ v: 99, kind: 'setReady', ready: true })],
    ['missing version', JSON.stringify({ kind: 'setReady', ready: true })],
    ['unknown kind', JSON.stringify({ v, kind: 'cheat' })],
    ['bad field type', JSON.stringify({ v, kind: 'vote', proposal: 'p', yes: 'yes' })],
    [
      'issueOrder with neither draft nor text',
      JSON.stringify({ v, kind: 'issueOrder', orderId: 'o' }),
    ],
    [
      'issueOrder with both draft and text',
      JSON.stringify({ v, kind: 'issueOrder', orderId: 'o', draft: 'd', text: 'go' }),
    ],
    [
      'issueOrder with blank text',
      JSON.stringify({ v, kind: 'issueOrder', orderId: 'o', text: ' ' }),
    ],
    ['extra field', JSON.stringify({ v, kind: 'setReady', ready: true, admin: true })],
    ['reason too long', JSON.stringify({ v, kind: 'proposePause', reason: 'x'.repeat(201) })],
    ['resume with a reason', JSON.stringify({ v, kind: 'proposeResume', reason: 'x' })],
  ])('rejects %s', (_n, json) => {
    expect(parseCommand(json).ok).toBe(false);
  });

  it('refuses to serialise malformed commands', () => {
    expect(() => serializeCommand({ v, kind: 'vote', proposal: '', yes: true })).toThrow();
  });
});

describe('ServerMessage', () => {
  const good: ServerMessage[] = [
    { v, kind: 'viewUpdate', view },
    {
      v,
      kind: 'dispatch',
      dispatch: {
        id: 'd1',
        from: 'Scout',
        writtenAtGame: 1,
        receivedAtGame: 2,
        category: 'scouts',
        text: 'Cavalry east.',
      },
    },
    { v, kind: 'clockState', clock },
    { v, kind: 'pauseState', phase: 'running' },
    {
      v,
      kind: 'pauseState',
      phase: 'pause_proposed',
      proposal: {
        id: 'p1',
        kind: 'pause',
        bySide: 'red',
        byYou: false,
        reason: 'door',
        yes: 1,
        no: 0,
        voters: 2,
        msLeft: 30_000,
      },
    },
    { v, kind: 'pauseResult', outcome: 'cancelled', cause: 'no-vote', proposalKind: 'pause' },
    { v, kind: 'pauseResult', outcome: 'resumed', cause: 'max-pause' },
    { v, kind: 'staffAtWork', working: true, needAtMs: 5000 },
    { v, kind: 'staffAtWork', working: false },
    { v, kind: 'gameOver', winner: 'blue', reason: 'objective-held', atGame: 9000 },
    { v, kind: 'gameOver', winner: null, reason: 'eliminated', atGame: 9000 },
    {
      v,
      kind: 'notification',
      event: 'contact',
      title: 'Contact',
      text: 'A report of contact has arrived.',
    },
    { v, kind: 'error', code: 'bad_command', message: 'nope' },
  ];
  it.each(good)('round-trips $kind', (m) => {
    expect(parseServerMessage(serializeServerMessage(m))).toEqual({ ok: true, value: m });
  });

  it('rejects extra fields on a game-over notice', () => {
    const bad = { v, kind: 'gameOver', winner: 'blue', reason: 'eliminated', atGame: 1, units: [] };
    expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects hidden fields smuggled into a view', () => {
    const bad = { v, kind: 'viewUpdate', view: { ...view, masterState: {} } };
    expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
  });

  describe('rejects extra keys at every nesting level of a view', () => {
    const dispatch = {
      id: 'd1',
      from: 'staff',
      writtenAtGame: 0,
      receivedAtGame: 1,
      category: 'staff',
      text: 'hi',
    };
    const full = { ...view, dispatches: [dispatch] };
    const extra = { hiddenOrders: 'x' };
    const cases: [string, (x: typeof full) => unknown][] = [
      ['SideView', (x) => ({ ...x, ...extra })],
      ['OwnUnit', (x) => ({ ...x, ownUnits: [{ ...x.ownUnits[0], ...extra }] })],
      [
        'VisibleEnemyUnit',
        (x) => ({ ...x, visibleEnemies: [{ ...x.visibleEnemies[0], ...extra }] }),
      ],
      [
        'LastKnownContact',
        (x) => ({ ...x, lastKnownContacts: [{ ...x.lastKnownContacts[0], ...extra }] }),
      ],
      [
        'Footprint',
        (x) => ({
          ...x,
          ownUnits: [{ ...x.ownUnits[0], footprint: { ...x.ownUnits[0]!.footprint, ...extra } }],
        }),
      ],
      [
        'Shape',
        (x) => ({
          ...x,
          ownUnits: [{ ...x.ownUnits[0], shape: [{ x: 1, y: 2, z: 3 }] }],
        }),
      ],
      ['Dispatch', (x) => ({ ...x, dispatches: [{ ...x.dispatches[0], ...extra }] })],
      ['ClockState', (x) => ({ ...x, clock: { ...x.clock, ...extra } })],
      [
        'Coord',
        (x) => ({ ...x, ownUnits: [{ ...x.ownUnits[0], position: { x: 1, y: 2, z: 3 } }] }),
      ],
    ];
    it('accepts the unmodified view', () => {
      expect(parseServerMessage(JSON.stringify({ v, kind: 'viewUpdate', view: full })).ok).toBe(
        true,
      );
    });
    it.each(cases)('%s', (_name, mutate) => {
      const bad = { v, kind: 'viewUpdate', view: mutate(full) };
      expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
    });
  });

  describe('continuous space', () => {
    const send = (mutate: (x: typeof view) => unknown) =>
      parseServerMessage(JSON.stringify({ v, kind: 'viewUpdate', view: mutate(view) })).ok;
    const unit0 = (x: typeof view) => x.ownUnits[0]!;

    it('carries free positions, facings and footprints exactly', () => {
      const r = parseServerMessage(serializeServerMessage({ v, kind: 'viewUpdate', view }));
      expect(r).toEqual({ ok: true, value: { v, kind: 'viewUpdate', view } });
    });

    it('requires facing, formation, footprint and an uncertainty radius', () => {
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), facing: undefined }] }))).toBe(false);
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), formation: undefined }] }))).toBe(
        false,
      );
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), footprint: undefined }] }))).toBe(
        false,
      );
      expect(
        send((x) => ({
          ...x,
          visibleEnemies: [{ ...x.visibleEnemies[0], footprint: undefined }],
        })),
      ).toBe(false);
      expect(
        send((x) => ({
          ...x,
          lastKnownContacts: [{ ...x.lastKnownContacts[0], uncertaintyRadius: undefined }],
        })),
      ).toBe(false);
    });

    it('rejects a negative radius, a non-finite facing, a flat footprint and an unknown formation', () => {
      const lk = (r: number) => (x: typeof view) => ({
        ...x,
        lastKnownContacts: [{ ...x.lastKnownContacts[0], uncertaintyRadius: r }],
      });
      expect(send(lk(-1))).toBe(false);
      expect(send(lk(0))).toBe(true);
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), facing: null }] }))).toBe(false);
      expect(
        send((x) => ({ ...x, ownUnits: [{ ...unit0(x), footprint: { frontage: 0, depth: 5 } }] })),
      ).toBe(false);
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), formation: 'blob' }] }))).toBe(false);
      expect(send((x) => ({ ...x, ownUnits: [{ ...unit0(x), shape: [] }] }))).toBe(false);
    });
  });

  it('rejects an invalid clock', () => {
    const bad = { v, kind: 'clockState', clock: { ...clock, rate: 0 } };
    expect(parseServerMessage(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects unknown kind and malformed JSON', () => {
    expect(parseServerMessage(JSON.stringify({ v, kind: 'x' })).ok).toBe(false);
    expect(parseServerMessage('nope').ok).toBe(false);
  });
});

describe('Intent', () => {
  it('accepts nested conditional intents', () => {
    const i = {
      kind: 'when',
      trigger: { kind: 'contact' },
      then: [{ kind: 'at', gameTime: 10, then: [{ kind: 'withdraw', toward: { x: 0, y: 0 } }] }],
    };
    expect(Intent.safeParse(i).success).toBe(true);
  });
  it('accepts attack on a unit id or a coord', () => {
    expect(Intent.safeParse({ kind: 'attack', target: 'u1' }).success).toBe(true);
    expect(Intent.safeParse({ kind: 'attack', target: { x: 1, y: 1 } }).success).toBe(true);
  });
  it('parse helpers return a failure instead of throwing on a pathologically deep intent', () => {
    const n = 20000;
    const json =
      '{"kind":"when","trigger":{"kind":"attacked"},"then":['.repeat(n) +
      '{"kind":"report"}' +
      ']}'.repeat(n);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(parseWith(Intent, json).ok).toBe(false);
  });
  it('rejects bad intents', () => {
    expect(Intent.safeParse({ kind: 'move' }).success).toBe(false);
    expect(Intent.safeParse({ kind: 'move', to: { x: NaN, y: 0 } }).success).toBe(false);
    expect(Intent.safeParse({ kind: 'move', to: { x: 0, y: 0 }, pace: 'sprint' }).success).toBe(
      false,
    );
  });
});

describe('marks', () => {
  const base = { id: 'm1', madeAtGame: 1000 };
  const at = { x: 10, y: 20 };
  it.each([
    { ...base, kind: 'pin', at, label: 'bridge', sourceReport: 'd1' },
    { ...base, kind: 'line', points: [at, { x: 30, y: 40 }] },
    { ...base, kind: 'arrow', from: at, to: { x: 30, y: 40 } },
    { ...base, kind: 'ring', at, radius: 500 },
  ])('round-trips %j', (mark) => {
    const cmd = { v: PROTOCOL_VERSION, kind: 'putMark', mark } as const;
    expect(parseCommand(serializeCommand(cmd as never))).toEqual({ ok: true, value: cmd });
  });

  it.each([
    { ...base, kind: 'ring', at, radius: 0 },
    { ...base, kind: 'line', points: [at] },
    { ...base, kind: 'pin', at, extra: 1 },
    { ...base, kind: 'pin', at: { x: NaN, y: 1 } },
    { id: '', kind: 'pin', at, madeAtGame: 0 },
  ])('rejects %j', (mark) => {
    expect(parseCommand(JSON.stringify({ v: PROTOCOL_VERSION, kind: 'putMark', mark })).ok).toBe(
      false,
    );
  });

  it('carries marks to the client', () => {
    const m: ServerMessage = {
      v: PROTOCOL_VERSION,
      kind: 'marks',
      marks: [{ ...base, kind: 'pin', at }],
    };
    expect(parseServerMessage(serializeServerMessage(m))).toEqual({ ok: true, value: m });
  });
});

describe('issueOrder courier', () => {
  const base = { v, kind: 'issueOrder', orderId: 'o1', text: 'advance' };
  it('accepts a fast or safe courier, or none, and refuses any other', () => {
    for (const courier of ['fast', 'safe', undefined])
      expect(parseCommand(JSON.stringify({ ...base, courier })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ ...base, courier: 'pigeon' })).ok).toBe(false);
  });
});
