// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Dispatch, SideView } from '@kriegsspiel/protocol';
import type { PendingOrder } from '../net/state.js';
import {
  compass,
  loadTurnRecord,
  lossBand,
  menBand,
  moraleBand,
  papersOfTurn,
  saveTurnRecord,
  sightings,
  snapUnits,
  turnFights,
  turnOfPaper,
  turnSummary,
  unitStatuses,
} from './turnReport.js';

const MIN = 60_000;
const TURN = 20 * MIN;

const paper = (over: Partial<Dispatch> & { id: string }): Dispatch => ({
  from: '1st Battalion',
  writtenAtGame: 5 * MIN,
  receivedAtGame: 20 * MIN,
  category: 'subordinates',
  text: 'Sir, …',
  ...over,
});

const unit = (over: Partial<SideView['ownUnits'][number]> & { id: string; name: string }) => ({
  position: { x: 1000, y: 2000 },
  facing: 0,
  formation: 'line' as const,
  footprint: { frontage: 200, depth: 40 },
  strength: 600,
  morale: 0.9,
  ...over,
});

const view = (over: Partial<SideView> = {}): SideView =>
  ({
    side: 'blue',
    atGame: 20 * MIN,
    ownUnits: [
      unit({ id: 'b1', name: '1st Battalion', place: 'at the bridge, on the High road' }),
      unit({ id: 'b2', name: '2nd Battalion', position: { x: 1500, y: 2500 } }),
    ],
    visibleEnemies: [],
    lastKnownContacts: [],
    dispatches: [],
    clock: { gameMsAtAnchor: 0, wallMsAtAnchor: 0, rate: 1, status: 'paused' },
    ...over,
  }) as SideView;

describe('turn of a paper', () => {
  it('puts what is handed in at a turn end in that turn, and the opening papers in turn 1', () => {
    expect(turnOfPaper(0, TURN)).toBe(1);
    expect(turnOfPaper(4 * MIN, TURN)).toBe(1);
    expect(turnOfPaper(20 * MIN, TURN)).toBe(1);
    expect(turnOfPaper(20 * MIN + 1, TURN)).toBe(2);
    expect(turnOfPaper(32 * MIN, TURN)).toBe(2);
  });

  it('picks the papers of one turn', () => {
    const ps = [
      paper({ id: 'a', receivedAtGame: 0 }),
      paper({ id: 'b', receivedAtGame: 20 * MIN }),
      paper({ id: 'c', receivedAtGame: 40 * MIN }),
    ];
    expect(papersOfTurn(ps, 1, TURN).map((d) => d.id)).toEqual(['a', 'b']);
    expect(papersOfTurn(ps, 2, TURN).map((d) => d.id)).toEqual(['c']);
  });
});

describe('bands', () => {
  it('rounds men and words morale', () => {
    expect(menBand(612)).toBe('about 600 men');
    expect(menBand(30)).toBe('a handful of men');
    expect(menBand(0)).toBe('none left');
    expect(menBand(undefined)).toBe('not reported');
    expect(moraleBand(0.9)).toBe('steady');
    expect(moraleBand(0.6)).toBe('shaken');
    expect(moraleBand(0.3)).toBe('wavering');
    expect(moraleBand(0.1)).toBe('breaking');
    expect(moraleBand(undefined)).toBe('not reported');
  });

  it('bands a loss by its share of the unit, with a round figure', () => {
    expect(lossBand(600, 600)).toBe('none');
    expect(lossBand(600, 596)).toBe('light, a few men');
    expect(lossBand(600, 570)).toBe('moderate, about 30 men');
    expect(lossBand(600, 480)).toBe('heavy, about 120 men');
    expect(lossBand(600, 300)).toBe('very heavy, about 300 men');
  });

  it('gives a move a compass word, y running south', () => {
    expect(compass(0, -100)).toBe('north');
    expect(compass(100, -100)).toBe('north-east');
    expect(compass(-100, 0)).toBe('west');
  });
});

describe('sightings (#439)', () => {
  it('merges papers that saw the same strength at the same place, from any sender', () => {
    const ps = [
      paper({
        id: 'c3',
        kind: 'contact',
        writtenAtGame: 18 * MIN,
        sizeEstimate: 'about a battalion',
        place: 'near the bridge',
      }),
      paper({
        id: 'c1',
        kind: 'contact',
        writtenAtGame: 5 * MIN,
        sizeEstimate: 'about a battalion',
        place: 'near the bridge',
      }),
      paper({
        id: 'c2',
        kind: 'contact',
        from: 'Cavalry',
        writtenAtGame: 12 * MIN,
        sizeEstimate: 'about a battalion',
        place: 'near the bridge',
      }),
      paper({
        id: 'd',
        kind: 'contact',
        writtenAtGame: 12 * MIN,
        sizeEstimate: 'a small detachment',
        place: 'near the bridge',
      }),
      paper({ id: 'e', kind: 'engaged', writtenAtGame: 12 * MIN, place: 'near the bridge' }),
    ];
    const s = sightings(ps);
    expect(s.map((x) => x.papers.map((d) => d.id))).toEqual([['c1', 'c2', 'c3'], ['d']]);
    expect(s[0]).toMatchObject({ size: 'about a battalion', place: 'near the bridge' });
  });

  it('falls back to the sketch position when a paper names no place', () => {
    const ps = [
      paper({ id: 'a', kind: 'contact', sizeEstimate: 'x', location: { x: 0, y: 0 } }),
      paper({ id: 'b', kind: 'contact', sizeEstimate: 'x', location: { x: 200, y: 0 } }),
      paper({ id: 'c', kind: 'contact', sizeEstimate: 'x', location: { x: 900, y: 0 } }),
    ];
    expect(sightings(ps).map((x) => x.papers.length)).toEqual([2, 1]);
  });
});

describe('where the turn was fought (#439)', () => {
  it('marks each place once, with its times', () => {
    const ps = [
      paper({ id: 'a', kind: 'engaged', writtenAtGame: 12 * MIN, location: { x: 0, y: 0 } }),
      paper({ id: 'b', kind: 'heavyLosses', writtenAtGame: 18 * MIN, location: { x: 100, y: 0 } }),
      paper({ id: 'c', kind: 'broke', writtenAtGame: 15 * MIN, location: { x: 2000, y: 0 } }),
      paper({ id: 'd', kind: 'contact', writtenAtGame: 3 * MIN, location: { x: 5000, y: 0 } }),
      paper({ id: 'e', kind: 'engaged', writtenAtGame: 3 * MIN }),
    ];
    expect(turnFights(ps, 2)).toEqual([
      { id: 'fought-2-0', position: { x: 0, y: 0 }, label: 'Fought 00:12 to 00:18' },
      { id: 'fought-2-1', position: { x: 2000, y: 0 }, label: 'Fought 00:15' },
    ]);
  });
});

describe('unit status (#439)', () => {
  const sent: PendingOrder = {
    orderId: 't-1',
    text: 'March to the bridge and hold it.',
    sentAtGame: 0,
    toName: '1st Battalion',
  };

  it('says what each unit was told, where it is, what it does, its men and morale', () => {
    const ack = paper({
      id: 'ack',
      kind: 'orderDelivered',
      writtenAtGame: 4 * MIN,
      orderId: 't-1',
    });
    const fight = paper({ id: 'f', kind: 'engaged', writtenAtGame: 15 * MIN });
    const look = paper({ id: 'l', kind: 'contact', writtenAtGame: 18 * MIN });
    const [b1, b2] = unitStatuses({
      view: view({
        ownUnits: [
          ...view().ownUnits.slice(0, 1),
          unit({ id: 'b2', name: '2nd Battalion', strength: 0 }),
        ],
      }),
      held: [],
      pending: [sent],
      dispatches: [ack, fight, look],
      papers: [ack, fight, look],
      sent: false,
    });
    expect(b1).toEqual({
      id: 'b1',
      name: '1st Battalion',
      told: 'March to the bridge and hold it.',
      orderState: 'Delivered at 00:04; acted on',
      where: 'at the bridge, on the High road',
      // A sighting after the fight does not end it.
      doing: 'In action',
      men: 'about 600 men',
      morale: 'steady',
    });
    expect(b2).toMatchObject({
      told: 'No orders sent',
      where: 'not reported',
      doing: 'Destroyed',
      men: 'none left',
    });
    expect(b2).not.toHaveProperty('morale');
  });

  it('shows the held order while the turn is written, and the courier while no word has come', () => {
    const held = [{ orderId: 't-2', to: 'b1', text: 'Hold the bridge.' }];
    const writing = unitStatuses({
      view: view(),
      held,
      pending: [sent],
      dispatches: [],
      papers: [],
      sent: false,
    });
    expect(writing[0]).toMatchObject({
      told: 'Hold the bridge.',
      orderState: 'Held for this turn',
    });
    const riding = unitStatuses({
      view: view(),
      held: [],
      pending: [sent],
      dispatches: [],
      papers: [],
      sent: true,
    });
    expect(riding[0]).toMatchObject({ orderState: 'Sent at 00:00; with the courier' });
  });

  it('reads a planned route as on the march, and an enemy within fire as within range, not in action', () => {
    const v = view({
      orderRoutes: [
        {
          id: 'route-b1',
          unitId: 'b1',
          kind: 'route',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
      visibleEnemies: [
        {
          id: 'r1',
          position: { x: 1500, y: 2300 },
          facing: 0,
          formation: 'line',
          footprint: { frontage: 1, depth: 1 },
        },
      ],
    });
    const [b1, b2] = unitStatuses({
      view: v,
      held: [],
      pending: [],
      dispatches: [],
      papers: [],
      sent: false,
    });
    expect(b1!.doing).toBe('On the march');
    expect(b2!.doing).toBe('Enemy within range');
  });
});

describe('turn summary (#439)', () => {
  const before = snapUnits(
    view({
      ownUnits: [
        unit({ id: 'b1', name: '1st Battalion', position: { x: 1000, y: 2800 }, strength: 630 }),
        unit({ id: 'b2', name: '2nd Battalion', position: { x: 1500, y: 2500 } }),
      ],
    }),
  );
  const papers = [
    paper({
      id: 'c1',
      kind: 'contact',
      writtenAtGame: 12 * MIN,
      sizeEstimate: 'about a battalion',
      place: 'near the bridge',
    }),
    paper({
      id: 'c2',
      kind: 'contact',
      writtenAtGame: 17 * MIN,
      sizeEstimate: 'about a battalion',
      place: 'near the bridge',
    }),
    paper({ id: 'e', kind: 'engaged', writtenAtGame: 18 * MIN, place: 'at the bridge' }),
    paper({ id: 'x', kind: 'courierLost', from: 'Chief of staff', writtenAtGame: 19 * MIN }),
  ];

  it('says what moved, what was seen, what was fought and what it cost', () => {
    const d = turnSummary({ turn: 1, startsAt: 0, endsAt: 20 * MIN, view: view(), before, papers });
    expect(d).toMatchObject({
      id: 'turn-summary-1',
      from: 'Chief of staff',
      category: 'staff',
      writtenAtGame: 20 * MIN,
      receivedAtGame: 20 * MIN,
    });
    expect(d.text.split('\n')).toEqual([
      "Sir, the staff's summary of turn 1, 00:00 to 00:20.",
      'Moved: 1st Battalion about 800 m north, now at the bridge, on the High road.',
      'Seen: about a battalion near the bridge (2 reports, 00:12 to 00:17).',
      'Fought: 1st Battalion at the bridge, from 00:18.',
      'Losses: 1st Battalion light, about 30 men; and 2nd Battalion none. In all about 30 men.',
      'One courier was lost.',
      'The papers follow.',
    ]);
  });

  it('says so when it has no picture of the turn start, and when nothing happened', () => {
    const d = turnSummary({
      turn: 2,
      startsAt: 20 * MIN,
      endsAt: 40 * MIN,
      view: view(),
      papers: [],
    });
    expect(d.text).toContain('Where they stand: 1st Battalion at the bridge, on the High road.');
    expect(d.text).toContain('Seen: nothing of the enemy.');
    expect(d.text).toContain('Fought: no fighting reported.');
    expect(d.text).toContain('the staff cannot say what moved or what it cost');
    expect(d.text).not.toMatch(/Moved|Losses/);
  });

  it('reads movement, losses and fighting from the units’ papers on an umpire turn (11.9)', () => {
    const turnPaper = (id: string, from: string, facts: NonNullable<Dispatch['turn']>) =>
      paper({
        id,
        from,
        kind: 'turn',
        writtenAtGame: 40 * MIN,
        receivedAtGame: 40 * MIN,
        location: { x: 1000, y: 2000 },
        place: 'at the bridge',
        turn: facts,
      });
    const papers = [
      turnPaper('t1', '1st Battalion', { n: 2, lost: 120, movedM: 610, broke: true, orders: [] }),
      turnPaper('t2', '2nd Battalion', { n: 2, lost: 0, movedM: 0, orders: [] }),
    ];
    const d = turnSummary({ turn: 2, startsAt: 20 * MIN, endsAt: 40 * MIN, view: view(), papers });
    expect(d.text).toContain(
      'Moved: 1st Battalion about 600 m, now at the bridge, on the High road.',
    );
    expect(d.text).toContain('Fought: 1st Battalion at the bridge, from 00:40.');
    expect(d.text).toContain(
      'Losses: 1st Battalion heavy, about 120 men; and 2nd Battalion none. In all about 120 men.',
    );
    expect(d.text).not.toContain('cannot say');
    expect(turnFights(papers, 2)).toEqual([
      { id: 'fought-2-0', position: { x: 1000, y: 2000 }, label: 'Fought 00:40' },
    ]);
    const [first, second] = unitStatuses({
      view: view(),
      held: [],
      pending: [],
      dispatches: papers,
      papers,
      sent: false,
    });
    expect(first!.doing).toBe('Broken, falling back');
    expect(second!.doing).toBe('Standing');
  });
});

describe('turn record storage', () => {
  it('round-trips, and drops what is damaged', () => {
    const summary = turnSummary({
      turn: 1,
      startsAt: 0,
      endsAt: 20 * MIN,
      view: view(),
      papers: [],
    });
    saveTurnRecord('g1', { starts: { 1: snapUnits(view()) }, summaries: [summary] });
    expect(loadTurnRecord('g1')).toEqual({
      starts: { 1: snapUnits(view()) },
      summaries: [summary],
    });
    localStorage.setItem(
      'kriegsspiel.turns.g2',
      JSON.stringify({
        starts: { x: [], 2: [{ id: 1 }] },
        summaries: [{ id: 'not-a-summary', text: 'x' }],
      }),
    );
    expect(loadTurnRecord('g2')).toEqual({ starts: {}, summaries: [] });
    localStorage.setItem('kriegsspiel.turns.g3', '{');
    expect(loadTurnRecord('g3')).toEqual({ starts: {}, summaries: [] });
  });
});
