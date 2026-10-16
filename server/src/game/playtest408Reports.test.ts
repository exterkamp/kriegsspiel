/**
 * The 11.12 playtest's turn notes (#408, `docs/turn-playtest.md`) against the turn reports' input
 * and checks (#532): an acknowledgement written in a turn's first minutes speaks for its unit as it
 * stood then, not after the turn's fight, and a contact note does not turn its place's radius into
 * a distance from the writer. The notes are the ones the players read, from each side's
 * `turnReports` entry; the input is rebuilt from the replayed turn, as `UmpireTurnResolver` builds
 * it, with no model.
 */
import { readFileSync } from 'node:fs';
import { viewFor, type SideId } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import { replayTurns } from '../admin/turnView.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import {
  TURN_REPORTS_MAX,
  checkTurnNote,
  reportsOfTurn,
  turnReportsInput,
  writeTurnReports,
} from '../umpire/turnReports.js';
import { createRegistry, loadScenarioById, startingState } from './index.js';
import type { InputLogEntry, InputLogHeader } from './store.js';
import { turnReportsContext, type UmpireTurnOutput } from './umpireTurn.js';

type Logged = { header: InputLogHeader; entries: InputLogEntry[] };
type Narrated = { narrated?: { reportId: string; text: string }[] };

/** Each side's papers of each umpire turn: the input as built today, and the notes read live. */
function papers(name: 'standard' | 'free') {
  const game = JSON.parse(
    readFileSync(new URL(`./playtest408/${name}.json`, import.meta.url), 'utf8'),
  ) as Logged;
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
      const ctx = turnReportsContext(world, view, t.turn, output.proposal, places, {
        world: t.before.world,
        time: t.before.time,
      });
      const logged = game.entries.find(
        (e) =>
          e.command.kind === 'turnReports' &&
          e.command.side === side &&
          e.command.turn === t.turn.n,
      ) as Narrated | undefined;
      const { input } = turnReportsInput(side, t.turn.n, due, ctx);
      return {
        game: name,
        turn: t.turn.n,
        side,
        due,
        ctx,
        input,
        notes: logged?.narrated ?? [],
        startMs: t.turn.startMs,
        endMs: t.after.time,
      };
    });
  });
}

const ALL = [...papers('standard'), ...papers('free')];

describe('the playtest’s papers and the time they were written (#532)', () => {
  it('gives an acknowledgement the condition its unit had before the turn’s fight', () => {
    const acks = ALL.flatMap((p) =>
      p.input.reports
        .filter((e) => e.kind === 'orderDelivered')
        .map((e) => ({ key: `${p.game} t${p.turn} ${e.id} ${e.from}`, condition: e.condition })),
    );
    expect(acks.length).toBeGreaterThan(20);
    const of = (key: string) => acks.find((a) => a.key === key)?.condition;
    // Blue's 1st Battalion read "shaken and short of powder" at 00:01:48, and Red's Vanguard the same
    // at 00:00:33: their condition at 00:20. Before the fire fight they were steady and supplied.
    expect(of('standard t1 blue-r3 1st Battalion')).toBe('steady, fresh, well supplied');
    expect(of('standard t1 red-r3 Vanguard Battalion')).toBe('steady, fresh, well supplied');
    // The Vanguard's turn 2 acknowledgement (00:21) is as the Vanguard stood at 00:20, after turn
    // 1, not as at 00:40 ("ammunition nearly gone").
    expect(of('standard t2 red-r12 Vanguard Battalion')).not.toMatch(/nearly gone/);
    // A paper written at the turn's end keeps the end's condition.
    for (const p of ALL) {
      for (const e of p.input.reports.filter((x) => x.kind === 'turn')) {
        const unit = p.ctx.ownUnits.find((u) => u.name === e.from);
        if (unit && unit.strength > 0) expect(e.condition, `${p.game} ${e.id}`).toBeDefined();
      }
    }
  });

  it('refuses the live notes that reported the future or read the radius as a range, and only those', () => {
    const refused = ALL.flatMap((p) =>
      p.notes.flatMap((n) => {
        const entry = p.input.reports.find((e) => e.id === n.reportId);
        if (!entry) return [];
        const problems = checkTurnNote(n.text, entry, p.ctx.hidden);
        return problems.length > 0 ? [[`${p.game} t${p.turn} ${n.reportId}`, problems]] : [];
      }),
    );
    expect(ALL.flatMap((p) => p.notes).length).toBeGreaterThan(40);
    expect(Object.fromEntries(refused)).toEqual({
      // Acknowledgements written in the turn's first minutes with the condition at its end.
      'standard t1 blue-r3': [
        'ammunition "short of powder" is not the unit’s when it wrote',
        'condition "shaken" is not the unit’s',
      ],
      'standard t1 red-r3': [
        'ammunition "ammunition is running low" is not the unit’s when it wrote',
        'condition "shaken" is not the unit’s',
        'condition "running low" is not the unit’s',
      ],
      'standard t2 red-r12': [
        'condition "wavering" is not the unit’s',
        'condition "nearly gone" is not the unit’s',
      ],
      'free t3 red-r18': ['condition "wavering" is not the unit’s'],
      'free t3 red-r19': ['condition "wavering" is not the unit’s'],
      // Contact notes that read the radius as a range: "I put them within about 40 metres of the
      // bridge", "It lies within twenty metres of us" (the enemy was 200 m off).
      'standard t1 red-r10': [expect.stringMatching(/^states a distance \("40 metres"\)/)],
      'free t2 red-r16': [expect.stringMatching(/^states a distance \("twenty metres"\)/)],
    });
    // The notes that word it as how sure the place is stand: "the position may be out by some 30
    // metres", "good to within some 40 paces", "within some twenty metres of that spot".
  });

  it('words every place radius as how sure the place is, never as a number to read as a range', () => {
    for (const p of ALL) {
      for (const e of p.input.reports) {
        expect(e, `${p.game} ${e.id}`).not.toHaveProperty('radiusM');
        if (e.kind === 'contact') expect(e.placeAccuracy).toMatch(/^good to about \d+ m$/);
      }
    }
  });

  it('with the test provider, every acknowledgement and contact paper of the two games is written and passes', async () => {
    const client = createUmpireClient({
      config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }),
      env: {},
    });
    let contacts = 0;
    for (const p of ALL) {
      const r = await writeTurnReports(client, p.side, p.turn, p.due, p.ctx);
      const kindOf = (id: string) => p.input.reports.find((e) => e.id === id)?.kind;
      expect(
        r.fallbacks.filter((f) => ['orderDelivered', 'contact'].includes(kindOf(f.reportId)!)),
        `${p.game} t${p.turn} ${p.side}`,
      ).toEqual([]);
      for (const d of r.dispatches) {
        if (kindOf(d.reportIds[0]!) !== 'contact') continue;
        contacts++;
        expect(d.text).toMatch(/The place is good to about \d+ m\./);
      }
    }
    expect(contacts).toBeGreaterThan(5);
  });
});
