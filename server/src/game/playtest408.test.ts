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
import { overlapsBeyondTolerance, terrainAt, type GameState, type Unit } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { replayTurns } from '../admin/turnView.js';
import { createRegistry, loadScenarioById, replayLog, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';

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
