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
import { windowAt } from '../api/umpireWindow.js';
import { accountSightProblem, ownTermsOf, sideSight } from '../umpire/accountSight.js';
import { sightProblems } from '../umpire/adjudicate.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import {
  TURN_REPORTS_MAX,
  reportsOfTurn,
  turnReportsInput,
  writeTurnReports,
} from '../umpire/turnReports.js';
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

/**
 * The world as it was played: the closing time-limit paper then read "on the High road,." (#538), a
 * stray comma the engine no longer writes. The hash is of that text, so a replay that differs from
 * the logged game anywhere else still fails.
 */
const PLAYED_COMMA = /(has not taken the objective [^.]*, on [^.,]*)(\. The game is over)/;
const asPlayed = (world: GameState): GameState => ({
  ...world,
  intel: Object.fromEntries(
    Object.entries(world.intel).map(([side, intel]) => [
      side,
      {
        ...intel,
        reports: intel.reports.map((r) =>
          r.from === "The umpire's ruling" && r.text && PLAYED_COMMA.test(r.text)
            ? { ...r, text: r.text.replace(PLAYED_COMMA, '$1,$2') }
            : r,
        ),
      },
    ]),
  ) as GameState['intel'],
});

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
  worldSha256: createHash('sha256')
    .update(JSON.stringify(asPlayed(state.world)))
    .digest('hex'),
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
      // No paper the game ends with has the stray comma (#538).
      for (const intel of Object.values(state.world.intel)) {
        for (const r of intel.reports) expect(r.text ?? '').not.toMatch(/,\s*\./);
      }
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
    // Live, the screen withheld 10 of 36 accounts, every one on a harmless word (#530); since
    // #530 it withholds none of them.
    expect(all.flatMap((r) => r.logged)).toHaveLength(10);
    expect(all.flatMap((r) => r.before)).toEqual([]);
    // Every final proposal's sightings stood, so the sight check withholds nothing more.
    for (const r of all) expect(r.after, `turn ${r.turn} ${r.side}`).toEqual(r.before);
  });
});

/** Each side's papers of each umpire turn with the turn reports' context, as `writeReports` builds them. */
function papers(name: 'standard' | 'free') {
  const game = load(name);
  const turns = replayTurns({
    header: game.header,
    world: loadScenarioById(game.header.scenarioId),
    entries: game.entries,
    registry: createRegistry(),
    init: startingState,
  });
  return turns.flatMap((t) => {
    const world = t.after.world;
    const output = t.turn.output as UmpireTurnOutput;
    const places = [...new Set(world.map.features.flatMap((f) => (f.name ? [f.name] : [])))];
    return world.sides.map((s) => {
      const side = s.id as SideId;
      const view = viewFor(world, side, t.after.time);
      const due = reportsOfTurn(view.reports, t.turn.startMs, t.after.time).slice(
        -TURN_REPORTS_MAX,
      );
      const ctx = turnReportsContext(world, view, t.turn, output.proposal, places);
      return { turn: t.turn.n, side, due, ctx };
    });
  });
}

describe('the playtest accounts and the screen (#530)', () => {
  it('shows every account the screen withheld live on a harmless word', () => {
    const shown = new Map<string, string>();
    for (const name of ['standard', 'free'] as const) {
      for (const p of papers(name)) {
        const { input, withheld } = turnReportsInput(p.side, p.turn, p.due, p.ctx);
        expect(withheld, `${name} turn ${p.turn} ${p.side}`).toEqual([]);
        for (const e of input.reports) {
          if (e.account) shown.set(`${name} ${e.id}`, e.account);
        }
      }
    }
    expect(shown.size).toBe(36);
    // The ten withheld live, by the words they were withheld on.
    expect(shown.get('standard blue-r5')).toMatch(/about 200 paces/);
    expect(shown.get('standard blue-r7')).toMatch(/behind the 1st Battalion/);
    expect(shown.get('standard blue-r14')).toMatch(/about 100 paces.*over 200 paces/);
    expect(shown.get('standard blue-r15')).toMatch(/1st Battalion's line .* bridge-head/);
    expect(shown.get('standard red-r14')).toMatch(/re-forming/);
    expect(shown.get('standard red-r15')).toMatch(/over 200 paces/);
    expect(shown.get('standard blue-r22')).toMatch(/in case the 1st gave way/);
    expect(shown.get('standard red-r21')).toMatch(/to re-form/);
    expect(shown.get('free blue-r20')).toMatch(/at the bridge-end/);
    expect(shown.get('free blue-r21')).toMatch(/at the bridge-end/);
  });

  it('with the test provider, every turn note is written from its account, so none contradicts it', async () => {
    const client = createUmpireClient({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      env: {},
    });
    const notes = new Map<string, string>();
    for (const name of ['standard', 'free'] as const) {
      for (const p of papers(name)) {
        const r = await writeTurnReports(client, p.side, p.turn, p.due, p.ctx);
        expect(r.withheld, `${name} turn ${p.turn} ${p.side}`).toEqual([]);
        const { input } = turnReportsInput(p.side, p.turn, p.due, p.ctx);
        for (const e of input.reports) {
          if (!e.account) continue;
          const note = r.dispatches.find((d) => d.reportIds[0] === e.id)?.text;
          expect(note, `${name} ${e.id}: ${JSON.stringify(r.fallbacks)}`).toBeDefined();
          expect(note).toContain(e.account.replace(/[.!?]+$/, ''));
          notes.set(`${name} ${e.id}`, note!);
        }
      }
    }
    expect(notes.size).toBe(36);
    // The cavalry case: back south of the river, not "crossing the bridge to scout north".
    const cavalry = notes.get('standard blue-r7')!;
    expect(cavalry).toMatch(/recrossed in good time/);
    expect(cavalry).not.toMatch(/\b(?:are crossing|mean to be back)\b/);
  });
});

describe("the playtest's umpire's window reads as a player would (#538)", () => {
  it.each(['standard', 'free'] as const)(
    '%s: the rulings name units, not ids, and no text has ",."',
    (name) => {
      const game = load(name);
      const world = loadScenarioById(game.header.scenarioId);
      const input = {
        header: game.header,
        world,
        entries: game.entries,
        registry: createRegistry(),
        init: startingState,
      };
      const frame = windowAt(input, game.final.time);
      const ids = world.units.map((u) => u.id);
      const turnRulings = frame.rulings.filter((r) => r.narrative.startsWith("The umpire's turn"));
      if (name === 'standard') expect(turnRulings.length).toBeGreaterThan(0);
      for (const r of frame.rulings) {
        for (const id of ids) {
          const token = new RegExp(`(?<![\\w-])${id}(?![\\w-])`);
          expect(r.narrative).not.toMatch(token);
          expect(r.rationale).not.toMatch(token);
        }
        expect(r.narrative).not.toMatch(/,\s*\./);
      }
      // The ruling keeps its id for the scene; only the words change.
      for (const r of turnRulings) {
        const unit = world.units.find((u) => u.id === r.unitId)!;
        expect(r.narrative).toContain(`corrected for ${unit.name} (`);
      }
    },
  );
});
