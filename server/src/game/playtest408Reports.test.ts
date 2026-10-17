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
  TURN_REPORTS_SYSTEM,
  checkTurnNote,
  reportsOfTurn,
  turnReportsInput,
  writeTurnReports,
  type TurnReportsInput,
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

/** Each side-turn's first report call as logged: the input the model was given and its reply. */
function firstCalls(name: 'standard' | 'free') {
  const game = JSON.parse(
    readFileSync(new URL(`./playtest408/${name}.json`, import.meta.url), 'utf8'),
  ) as Logged;
  return game.entries.flatMap((e) => {
    const call = e.calls?.[0];
    if (e.command.kind !== 'turnReports' || !call) return [];
    const raw = call.rawOutput ?? '';
    const reply = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
      dispatches: { reportIds: string[]; text: string }[];
    };
    const rejected = (e.calls?.[1]?.input as { rejected?: string[] } | undefined)?.rejected ?? [];
    return [
      {
        key: `${name} t${e.command.turn} ${e.command.side}`,
        calls: e.calls?.length ?? 0,
        input: call.input as TurnReportsInput,
        reply,
        resent: rejected.map((r) => r.split(':')[0]!),
      },
    ];
  });
}

describe('the playtest’s second report calls (#537)', () => {
  const FIRST = [...firstCalls('standard'), ...firstCalls('free')];
  const RECITES = 'recites the unit’s condition instead of judging it';

  it('were made in every side-turn, mostly for reciting the condition, which the prompt now forbids', () => {
    expect(FIRST).toHaveLength(12);
    expect(FIRST.every((f) => f.calls === 2)).toBe(true);
    // The first replies against the input the model was given, with today's checks.
    const left = new Map(
      FIRST.map((f) => [
        f.key,
        f.input.reports.flatMap((entry) => {
          const note = f.reply.dispatches.find((d) => d.reportIds[0] === entry.id);
          if (!note) return [`${entry.id}: no note`];
          return checkTurnNote(note.text, entry).map((p) => `${entry.id}: ${p}`);
        }),
      ]),
    );
    const other = [...left].flatMap(([key, problems]) =>
      problems.filter((p) => !p.endsWith(RECITES)).map((p) => `${key} ${p}`),
    );
    // Three refusals were the checks' own mistakes and pass now: "no fresh orders reached my
    // squadron" is not the men's condition, "we have made out a small detachment" is a sighting,
    // and "my squadron rode round ... I found no ford" says what the unit did.
    const live = FIRST.flatMap((f) => f.resent.map((id) => `${f.key} ${id}`));
    for (const fixed of ['free t3 red red-r22', 'standard t1 red red-r10', 'free t1 red red-r7']) {
      expect(live).toContain(fixed);
      expect(other.some((o) => o.startsWith(`${fixed}:`))).toBe(false);
    }
    // Besides reciting, one report was given no note and one contact note read the place's radius
    // as a range (#532; turn-reports-v2 tells the model).
    expect(other).toEqual([
      'standard t2 blue blue-r12: no note',
      expect.stringMatching(/^free t2 red red-r16: states a distance \("twenty metres"\)/),
    ]);
    // Free turn 3's Red papers now pass as written: one call. Reciting is the rest, in 10 of the 12
    // side-turns; turn-reports-v3 tells the model not to list the condition back. With that
    // heeded, 10 of the 12 side-turns would need one call.
    expect(left.get('free t3 red')).toEqual([]);
    const reciting = [...left.values()].filter((p) => p.some((x) => x.endsWith(RECITES)));
    expect(reciting).toHaveLength(10);
    const oneCall = [...left.keys()].filter((key) => !other.some((o) => o.startsWith(`${key} `)));
    expect(oneCall).toHaveLength(10);
    expect(TURN_REPORTS_SYSTEM).toMatch(/never list it back/);
  });
});
