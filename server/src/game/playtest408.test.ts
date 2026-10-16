/**
 * The 11.12 playtest (#408): three games of Hold the Bridge in 20-minute turns, played on the server
 * by two human seats, with Claude Code's Sonnet as the umpire through the host bridge
 * (`docs/turn-playtest.md`). Their input logs are the fixtures in `playtest408/`, exported from the
 * server's SQLite store with the state each game ended in. Replay needs no model: the umpire's turns
 * are applied from the logged proposals, rolls and rulings, and a courier pass, roll or ruling that
 * differed from the log would throw. This test replays each game to its recorded outcome and checks,
 * at every turn end, that the world the turn left is valid.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  overlapsBeyondTolerance,
  terrainAt,
  validateProposal,
  viewFor,
  type GameState,
  type SideId,
  type Unit,
} from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { TurnProposal } from '@kriegsspiel/protocol';
import { replayTurns } from '../admin/turnView.js';
import { accountSightProblem, ownTermsOf, sideSight } from '../umpire/accountSight.js';
import { sightProblems } from '../umpire/adjudicate.js';
import { TURN_REPORTS_MAX, reportsOfTurn, turnReportsInput } from '../umpire/turnReports.js';
import { createRegistry, loadScenarioById, replayLog, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';
import { turnReportsContext, type UmpireTurnOutput } from './umpireTurn.js';

interface Final {
  time: number;
  rng: number;
  outcome: GameState['outcome'];
  units: { id: string; x: number; y: number; strength: number; status: string }[];
  worldSha256: string;
}
type Logged = { header: InputLogHeader; entries: InputLogEntry[]; final: Final };

const load = (name: string): Logged =>
  JSON.parse(
    readFileSync(new URL(`./playtest408/${name}.json`, import.meta.url), 'utf8'),
  ) as Logged;

const GAMES = {
  standard: { adjudicators: ['umpire', 'umpire', 'umpire'], reason: 'objective-held' },
  rigid: { adjudicators: ['engine', 'engine', 'engine'], reason: 'objective-held' },
  free: { adjudicators: ['umpire', 'umpire', 'umpire'], reason: 'attack-broken' },
} as const;

const summary = (state: { time: number; rng: number; world: GameState }): Final => ({
  time: state.time,
  rng: state.rng,
  outcome: state.world.outcome,
  units: state.world.units.map((u) => ({
    id: u.id,
    x: u.center.x,
    y: u.center.y,
    strength: u.strength,
    status: u.status,
  })),
  worldSha256: createHash('sha256').update(JSON.stringify(state.world)).digest('hex'),
});

/** What would make a turn's end state invalid: the hard limits of D39, checked from outside. */
function problems(before: GameState, after: GameState): string[] {
  const out: string[] = [];
  const prev = new Map(before.units.map((u) => [u.id, u]));
  const standing = (u: Unit) => u.status !== 'destroyed';
  for (const u of after.units) {
    const p = prev.get(u.id);
    if (!p) out.push(`${u.id} appeared`);
    else if (u.strength > p.strength + 1e-9) out.push(`${u.id} gained men`);
    if (u.strength < 0) out.push(`${u.id} has ${u.strength} men`);
    for (const k of ['morale', 'fatigue', 'ammo'] as const) {
      if (!(u[k] >= 0 && u[k] <= 100)) out.push(`${u.id} ${k} ${u[k]}`);
    }
    if (p?.status === 'destroyed' && u.status !== 'destroyed') out.push(`${u.id} came back`);
    if (standing(u) && terrainAt(after.map, u.center)?.attrs.passable !== true) {
      out.push(`${u.id} stands on impassable ground at ${u.center.x},${u.center.y}`);
    }
  }
  const alive = after.units.filter(standing);
  for (const a of alive) {
    for (const b of alive) {
      if (a.id < b.id && a.side === b.side && overlapsBeyondTolerance(a, b)) {
        out.push(`${a.id} and ${b.id} overlap`);
      }
    }
  }
  return out;
}

describe('the 11.12 playtest games (#408) replay with no model', () => {
  it.each(Object.keys(GAMES) as (keyof typeof GAMES)[])(
    '%s: replays to the outcome it was played to',
    (name) => {
      const game = load(name);
      expect(game.header.settings).toMatchObject({ mode: 'turns', turnMinutes: 20, dial: name });
      expect(game.header.rules).toBe(3);
      const world = loadScenarioById(game.header.scenarioId);
      const { state } = replayLog(
        game.header,
        world,
        game.entries,
        createRegistry(),
        undefined,
        startingState,
      );
      expect(summary(state)).toEqual(game.final);
      expect(state.world.outcome).toMatchObject({
        winner: 'blue',
        reason: GAMES[name].reason,
        time: 50 * 60_000,
      });
    },
  );

  it.each(Object.keys(GAMES) as (keyof typeof GAMES)[])(
    '%s: no turn left the world invalid',
    (name) => {
      const game = load(name);
      const turns = replayTurns({
        header: game.header,
        world: loadScenarioById(game.header.scenarioId),
        entries: game.entries,
        registry: createRegistry(),
        init: startingState,
      });
      expect(turns.map((t) => t.turn.adjudicator)).toEqual(GAMES[name].adjudicators);
      expect(turns.map((t) => t.turn.fallback)).toEqual([undefined, undefined, undefined]);
      for (const t of turns) {
        expect(problems(t.before.world, t.after.world), `turn ${t.turn.n}`).toEqual([]);
      }
    },
  );
});

const units = (world: GameState, side: string) => world.units.filter((u) => u.side === side);

/**
 * Every account of the two umpire games screened again, with and without the sight check (#533),
 * as `UmpireTurnResolver.writeReports` screens them: each side's view at each turn's end.
 */
function screened(name: 'standard' | 'free') {
  const game = load(name);
  const turns = replayTurns({
    header: game.header,
    world: loadScenarioById(game.header.scenarioId),
    entries: game.entries,
    registry: createRegistry(),
    init: startingState,
  });
  const out: Array<{
    turn: number;
    side: string;
    logged: string[];
    before: string[];
    after: string[];
  }> = [];
  for (const t of turns) {
    const world = t.after.world;
    const output = t.turn.output as UmpireTurnOutput;
    const places = [...new Set(world.map.features.flatMap((f) => (f.name ? [f.name] : [])))];
    for (const s of world.sides) {
      const view = viewFor(world, s.id as SideId, t.after.time);
      const due = reportsOfTurn(view.reports, t.turn.startMs, t.after.time).slice(
        -TURN_REPORTS_MAX,
      );
      const ctx = turnReportsContext(world, view, t.turn, output.proposal, places);
      const ids = (w: { reportId: string; reason: string }[]) =>
        w.map((x) => `${x.reportId}: ${x.reason}`);
      const reports = game.entries.find(
        (e) =>
          e.command.kind === 'turnReports' &&
          e.command.side === s.id &&
          e.command.turn === t.turn.n,
      ) as { error?: string } | undefined;
      out.push({
        turn: t.turn.n,
        side: s.id,
        logged: [...(reports?.error ?? '').matchAll(/(\S+): account withheld/g)].map((m) => m[1]!),
        before: ids(
          turnReportsInput(s.id as SideId, t.turn.n, due, { ...ctx, sight: undefined }).withheld,
        ),
        after: ids(turnReportsInput(s.id as SideId, t.turn.n, due, ctx).withheld),
      });
    }
  }
  return out;
}

describe('the playtest accounts and sight (#533)', () => {
  it('turn 1: the Hussars’ first account, whose every sighting was refused, is sent back and would be withheld', () => {
    const game = load('standard');
    const [t1] = replayTurns({
      header: game.header,
      world: loadScenarioById(game.header.scenarioId),
      entries: game.entries,
      registry: createRegistry(),
      init: startingState,
    });
    const output = t1!.turn.output as UmpireTurnOutput;
    const first = TurnProposal.parse(JSON.parse(t1!.entry.calls![0]!.rawOutput!));
    const world = t1!.before.world;
    const validation = validateProposal(world, first, output.context);
    // The first reply put the Hussars back where the projection had them (no departure reason),
    // 1 km from the river, and the sight check refused all three of their sightings.
    expect(validation.problems).toEqual(
      expect.arrayContaining([
        "red-3: observation dropped: red-3 could not see blue-1 at the turn's end",
        "red-3: observation dropped: red-3 could not see blue-3 at the turn's end",
      ]),
    );
    const problems = sightProblems(world, first, validation);
    expect(problems).toEqual([
      'red-3: the account describes the enemy ("infantry") though the sight check refused every ' +
        'sighting of this unit; tell only what the unit could see, or list a sighting it could make',
    ]);
    // Had that reply been applied, Red's papers would not have carried its account.
    const red = units(world, 'red');
    const sight = sideSight('red', first.observations, validation.observations, true);
    const account = first.units.find((u) => u.unitId === 'red-3')!.account;
    expect(accountSightProblem(account, 'red-3', sight, ownTermsOf(red))).toMatch(
      /^describes the enemy \("infantry"\)/,
    );
    // The resend gave the ride its reason: the Hussars stand at the river, their sightings stand,
    // and the final account ("He saw infantry in line at the south end of the bridge, ...") is
    // what they could see.
    const final = validateProposal(world, output.proposal, output.context);
    expect(final.observations.filter((o) => o.by === 'red-3')).toHaveLength(3);
    expect(sightProblems(world, output.proposal, final)).toEqual([]);
  });

  it('withholds no account of the two umpire games that the screen kept before (accounts whose sightings stood)', () => {
    const all = [...screened('standard'), ...screened('free')];
    // Without the sight check the screen withholds what it withheld live: 10 of 36.
    for (const r of all) {
      expect(
        r.before.map((w) => w.split(':')[0]),
        `turn ${r.turn} ${r.side}`,
      ).toEqual(r.logged);
    }
    expect(all.flatMap((r) => r.before)).toHaveLength(10);
    // Every final proposal's sightings stood, so the check withholds nothing more (#530 not worse).
    for (const r of all) expect(r.after, `turn ${r.turn} ${r.side}`).toEqual(r.before);
  });
});
