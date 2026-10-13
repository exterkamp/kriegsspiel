import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  viewFor,
  type GameState,
  type Seat,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { seatKey, sideViewOf } from '../api/sideView.js';
import type { OrderParser } from '../orders/index.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/index.js';
import {
  NARRATE_WINDOW_BASE_MS,
  STAFF_OVERLOADED_NOTICE,
  UmpireError,
  staffOfficerFor,
} from '../umpire/index.js';
import type { TraceSink } from '../debug/trace.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import type { StaffAtWork } from './actor.js';
import { GameHost, MemoryGameStore } from './index.js';
import { FakeTime } from './testing.js';

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

const BRIDGE = { x: 2_050_000, y: 1_500_000 };
const parser: OrderParser = {
  parse: async (text) => ({
    kind: 'intents',
    text,
    unitId: 'blue-1',
    intents: [{ kind: 'move', to: BRIDGE }],
  }),
};

/** What the stub's note says happened, by report kind: a field note that passes `checkNarration` (#419). */
const HAPPENED: Record<string, string> = {
  orderDelivered: 'we have your orders',
  contact: 'we see enemy troops',
  engaged: 'we are engaged',
  heavyLosses: 'we are taking heavy losses',
  broke: 'we have broken and fall back',
  lowAmmo: 'we are short of ammunition',
  exhausted: 'we are exhausted',
  destroyed: 'we have destroyed them',
  situation: 'we are in position',
};

/** Narrates each report on its own, quoting the officer, once the gate (if any) opens. */
class StubUmpire implements UmpireClient {
  requests: UmpireRequest[] = [];
  gate: Promise<void> | undefined;
  /** What the staff stage says in answer to a question; undefined makes it give nothing usable. */
  staffText: string | undefined = 'The bridge holds, sir; 1st Battalion is forward.';
  /** Refuse every narrate call the way a capped `GameUmpireClient` does. */
  refuse: 'budget' | 'rate-limit' | undefined;
  /** Replaces the text of every dispatch the narrate stage writes. */
  narrateText: ((from: string) => string) | undefined;
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.requests.push(request);
    if (this.refuse && request.stage === 'narrate') {
      throw new UmpireError('capped', this.refuse, 0);
    }
    await this.gate;
    let output: unknown;
    if (request.stage === 'staff') {
      output = {
        messages: this.staffText === undefined ? [] : [{ kind: 'advice', text: this.staffText }],
      };
    } else {
      const { reports } = request.input as {
        reports: { id: string; from: string; kind: string }[];
      };
      output = {
        dispatches: reports.map((r) => ({
          reportIds: [r.id],
          text:
            this.narrateText?.(r.from) ??
            `Sir, ${r.from} writes: ${HAPPENED[r.kind] ?? 'we hold, and it is lost'}.`,
        })),
      };
    }
    return {
      output: output as T,
      record: {
        stage: request.stage,
        model: 'stub',
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
        attempts: 1,
      },
    };
  }
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function newGame(
  umpire?: UmpireClient,
  extra: {
    narrateTimeoutMs?: number;
    scriptedOpponents?: boolean;
    trace?: TraceSink;
    onStaffAtWork?: (gameId: string, state: StaffAtWork) => void;
  } = {},
) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser,
    registry: registry(),
    wallNow: time.now,
    timers: time,
    narrator: umpire && (() => umpire),
    ...extra,
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 1 });
  return { time, store, game };
}

/** Sign an order and run on until it is delivered, which gives blue a report. */
async function runUntilReport(time: FakeTime, game: Awaited<ReturnType<typeof newGame>>['game']) {
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
  for (let i = 0; i < 60; i++) {
    await time.advance(NARRATE_WINDOW_BASE_MS);
    // Any command brings the world up to "now"; without a narrator nothing else does.
    await game.submit({ kind: 'setRate', rate: 1 });
    if (viewFor(game.state.world, 'blue', game.state.time).reports.length > 0) return 'blue';
  }
  throw new Error('no report in 60 windows');
}

describe('narrate stage in the actor', () => {
  it('narrates a side once per window, logs the calls and shows the text', async () => {
    const umpire = new StubUmpire();
    const { time, store, game } = await newGame(umpire);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);

    expect(umpire.requests.length).toBeGreaterThan(0);
    const view = sideViewOf(
      game.state,
      side as 'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor(side),
    );
    const narrated = view.dispatches.filter((d) => d.text.startsWith('Sir, '));
    expect(narrated.length).toBeGreaterThan(0);

    const log = await store.inputLog('g1');
    const entries = log.filter((e) => e.command.kind === 'narrate');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.calls?.[0]).toMatchObject({ stage: 'narrate', model: 'stub' });
  });

  it('tells the model who sent each report, his manner and his unit’s condition (#390)', async () => {
    const umpire = new StubUmpire();
    const { time, game } = await newGame(umpire);
    await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);

    const units = viewFor(game.state.world, 'blue', game.state.time).ownUnits;
    const sent = umpire.requests
      .filter((r) => r.stage === 'narrate')
      .flatMap((r) => (r.input as { reports: Record<string, unknown>[] }).reports);
    const fromUnit = sent.find((r) => units.some((u) => u.name === r.from && u.commander));
    expect(fromUnit).toBeDefined();
    const unit = units.find((u) => u.name === fromUnit!.from)!;
    expect(fromUnit).toMatchObject({ commander: unit.commander, trait: unit.trait });
    expect(fromUnit!.condition).toMatch(/^(steady|shaken|wavering), /);
  });

  it('holds game time while the model works', async () => {
    const umpire = new StubUmpire();
    let open!: () => void;
    umpire.gate = new Promise((r) => (open = r));
    const { time, game } = await newGame(umpire);
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 60 && !game.staffAtWork.working; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(game.staffAtWork.working).toBe(true);
    expect(umpire.requests).toHaveLength(1);
    const at = game.gameClock.now();
    await time.advance(30_000);
    expect(game.gameClock.now()).toBe(at);
    open();
    await time.flush();
    expect(game.staffAtWork.working).toBe(false);
  });

  it('shows the staff-overloaded notice, with no figures, once the game cap refuses narration', async () => {
    const umpire = new StubUmpire();
    umpire.refuse = 'budget';
    const { time, game } = await newGame(umpire);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);
    expect(umpire.requests.length).toBeGreaterThan(0);
    const view = sideViewOf(
      game.state,
      side as 'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor(side),
      [],
      game.overloadedFor(side),
    );
    expect(view.staffOverloaded).toBe(STAFF_OVERLOADED_NOTICE);
    expect(JSON.stringify(view)).not.toMatch(/budget|usd|token/i);
    // Reports still arrive as the engine wrote them.
    expect(view.dispatches.length).toBeGreaterThan(0);
  });

  it('clears the staff-overloaded notice once a later narration succeeds', async () => {
    const umpire = new StubUmpire();
    umpire.refuse = 'budget';
    const { time, game } = await newGame(umpire);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);
    expect(game.overloadedFor(side)).toBe(STAFF_OVERLOADED_NOTICE);
    umpire.refuse = undefined;
    await game.submit({ kind: 'order', side: side as 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 60 && game.overloadedFor(side); i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(game.overloadedFor(side)).toBeUndefined();
  });

  it('never narrates a side a scripted agent plays (#419)', async () => {
    const umpire = new StubUmpire();
    const { time, game } = await newGame(umpire, { scriptedOpponents: true });
    await runUntilReport(time, game);
    for (let i = 0; i < 12; i++) await time.advance(NARRATE_WINDOW_BASE_MS);

    const sides = umpire.requests
      .filter((r) => r.stage === 'narrate')
      .map((r) => (r.input as { side: string }).side);
    expect(sides).toContain('blue');
    expect(sides).not.toContain('red');
    // Red had reports to narrate: nobody reads them, so no model was asked.
    expect(viewFor(game.state.world, 'red', game.state.time).reports.length).toBeGreaterThan(0);
    expect(game.narrationFor('red')).toBeUndefined();
  });

  it('stops calling a failing model for a cooling-off in game time, logs why, and tries again after (#419)', async () => {
    const umpire = new StubUmpire();
    // An officer the reports never name: every reply fails the checks.
    umpire.narrateText = () => 'Sir, Colonel Zorn writes.';
    const llmRows: Record<string, unknown>[] = [];
    const trace: TraceSink = {
      enabled: true,
      record: (_id, kind, data) => {
        if (kind === 'llm') llmRows.push(data as Record<string, unknown>);
      },
    };
    const atWork: StaffAtWork[] = [];
    const { time, store, game } = await newGame(umpire, {
      trace,
      onStaffAtWork: (_id, state) => atWork.push(state),
    });
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march on' });
    const narrateCalls = () => umpire.requests.filter((r) => r.stage === 'narrate').length;
    for (let i = 0; i < 60 && game.narrationBreaker.pausedUntil === undefined; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    const pausedUntil = game.narrationBreaker.pausedUntil!;
    expect(pausedUntil).toBeDefined();
    expect(game.narrationBreaker.failed).toBeGreaterThanOrEqual(3);

    // Cooling off: windows close with reports due, but the model is not asked and game time is not held.
    const before = narrateCalls();
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 hold' });
    await time.flush();
    atWork.length = 0;
    llmRows.length = 0;
    while (game.state.time + NARRATE_WINDOW_BASE_MS < pausedUntil) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(narrateCalls()).toBe(before);
    expect(atWork.filter((s) => s.working)).toEqual([]);
    expect(llmRows).toContainEqual(
      expect.objectContaining({
        provider: 'narration breaker',
        error: expect.stringMatching(/blue window skipped/),
      }),
    );
    const log = (await store.inputLog('g1')).filter((e) => e.command.kind === 'narrate');
    const skipped = log.filter((e) => e.calls?.length === 0);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]!.error).toMatch(/model narration paused: \d+ of \d+ failed/);
    expect(skipped[0]!.narrateBreaker?.pausedUntil).toBe(pausedUntil);

    // After it the model is asked again, and its good text is shown.
    umpire.narrateText = undefined;
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 20 && narrateCalls() === before; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(narrateCalls()).toBeGreaterThan(before);
    expect(game.state.time).toBeGreaterThanOrEqual(pausedUntil);
    expect([...(game.narrationFor('blue')?.values() ?? [])]).toContain(
      'Sir, 1st Battalion writes: we have your orders.',
    );
    expect(game.narrationBreaker.pausedUntil).toBeUndefined();
  });

  it('restores the breaker from the input log when a game is reopened (#419)', async () => {
    const umpire = new StubUmpire();
    umpire.narrateText = () => 'Sir, Colonel Zorn writes.';
    const { time, store, game } = await newGame(umpire);
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march on' });
    for (let i = 0; i < 60 && game.narrationBreaker.pausedUntil === undefined; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    const state = structuredClone(game.narrationBreaker);
    expect(state.pausedUntil).toBeDefined();
    await host!.close('g1');
    host = new GameHost({
      store,
      parser,
      registry: registry(),
      wallNow: time.now,
      timers: time,
      narrator: () => umpire,
    });
    expect((await host.open('g1')).narrationBreaker).toEqual(state);
  });

  it('keeps template text when no umpire is set', async () => {
    const { time, game } = await newGame();
    const side = await runUntilReport(time, game);
    expect(game.narrationFor(side)).toBeUndefined();
  });
});

const asked = (
  questionId: string,
  askedAtGame = 0,
): {
  questionId: string;
  askedAtGame: number;
  answerAtGame: number;
  askedBy?: string;
} => ({
  questionId,
  askedAtGame,
  answerAtGame: askedAtGame + 10 * 60_000,
});

type Game = Awaited<ReturnType<typeof newGame>>['game'];

/**
 * Put a question and let the actor take it (the exchange is listed and logged as asked). Resolves once it
 * is taken, with `answer`, which settles when the officer has written at the due time.
 */
async function ask(game: Game, role: string, question: string, at: ReturnType<typeof asked>) {
  const answer = game.answerStaff('blue', role, question, at);
  // Queued behind the question, so it is registered once this settles.
  await game.submit({ kind: 'setRate', rate: 1 });
  return { answer };
}

/** Run game time on to `gameMs` (rate 1) and bring the world up to it. */
async function runTo(time: FakeTime, game: Game, gameMs: number) {
  await time.advance(gameMs - game.gameClock.now());
  await game.submit({ kind: 'setRate', rate: 1 });
}

const staffEntries = async (store: MemoryGameStore) =>
  (await store.inputLog('g1')).filter((e) => e.command.kind === 'staffAnswer');

describe('staff answers in the actor', () => {
  it('keeps the conference per side, files one dispatch when due, and restores both after a restart', async () => {
    const umpire = new StubUmpire();
    const { time, store, game } = await newGame(umpire);
    const { answer: pending } = await ask(game, 'intelligence', 'Where is the enemy?', asked('q1'));
    // Asked, not yet due: listed without words, and the model has not been called.
    expect(game.staffHistoryFor('blue')[0]?.text).toBeUndefined();
    expect(umpire.requests.filter((r) => r.stage === 'staff')).toHaveLength(0);
    await runTo(time, game, 11 * 60_000);
    expect((await pending)?.text).toBe('The bridge holds, sir; 1st Battalion is forward.');
    const history = game.staffHistoryFor('blue');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      questionId: 'q1',
      role: 'intelligence',
      text: 'The bridge holds, sir; 1st Battalion is forward.',
      basedOnGame: 10 * 60_000,
    });
    expect(game.staffHistoryFor('red')).toEqual([]);

    const viewAt = (g: typeof game, side: 'blue' | 'red') =>
      sideViewOf(
        g.state,
        side,
        g.gameClock.snapshot(),
        undefined,
        [],
        undefined,
        g.staffHistoryFor(side),
      );
    const staffPapers = (v: ReturnType<typeof viewAt>) =>
      v.dispatches.filter((d) => d.category === 'staff' && d.id === 'staff-q1');
    // Due: the words and one paper, in the officer's name. The other side sees neither.
    const due = viewAt(game, 'blue');
    expect(due.staffHistory?.[0]?.text).toBe('The bridge holds, sir; 1st Battalion is forward.');
    expect(staffPapers(due)).toHaveLength(1);
    expect(staffPapers(due)[0]!.from).toBe(history[0]!.officer.name);
    expect(viewAt(game, 'red').staffHistory).toBeUndefined();

    // A restart: the conference comes back from the input log, the words unchanged.
    await host!.close('g1');
    const h2 = new GameHost({
      store,
      parser,
      registry: registry(),
      wallNow: time.now,
      timers: time,
      narrator: () => umpire,
    });
    host = h2;
    const reopened = await h2.open('g1');
    expect(reopened.staffHistoryFor('blue')).toEqual(history);
    expect(reopened.staffHistoryFor('red')).toEqual([]);
    expect(staffPapers(viewAt(reopened, 'blue'))).toHaveLength(1);
  });

  it('writes the answer once, at the due time, and never again however often it is viewed (#418)', async () => {
    const umpire = new StubUmpire();
    const { time, store, game } = await newGame(umpire);
    await ask(game, 'chiefOfStaff', 'Status?', asked('q1', 5 * 60_000));
    await runTo(time, game, 30 * 60_000);
    const [first] = game.staffHistoryFor('blue');
    expect(first?.basedOnGame).toBe(15 * 60_000);
    // Later views, later times and another question leave it as it was.
    umpire.staffText = 'Something else entirely, sir, about 1st Battalion.';
    for (const t of [45, 60, 90]) {
      await runTo(time, game, t * 60_000);
      const v = sideViewOf(
        game.state,
        'blue',
        game.gameClock.snapshot(),
        undefined,
        [],
        undefined,
        game.staffHistoryFor('blue'),
      );
      expect(v.staffHistory?.[0]).toMatchObject({
        text: first!.text,
        basedOnGame: first!.basedOnGame,
      });
      expect(v.dispatches.filter((d) => d.id === 'staff-q1')).toEqual([
        expect.objectContaining({ text: first!.text, receivedAtGame: first!.answerAtGame }),
      ]);
    }
    expect(umpire.requests.filter((r) => r.stage === 'staff')).toHaveLength(1);
    // Logged twice: once asked (no words), once answered; the answered entry has the model's calls.
    const entries = await staffEntries(store);
    expect(entries).toHaveLength(2);
    const [askedEntry, answered] = entries.map(
      (e) => e.command as { exchange?: { text?: string } },
    );
    expect(askedEntry!.exchange?.text).toBeUndefined();
    expect(answered!.exchange?.text).toBe(first!.text);
    expect(entries[1]!.error).toBeUndefined();
    expect(entries[1]!.calls?.[0]).toMatchObject({ stage: 'staff', model: 'stub' });
    expect(entries[1]!.command).toMatchObject({ side: 'blue', role: 'chiefOfStaff' });
  });

  it('never quotes a report that arrived after the due time (#418)', async () => {
    // A dry run finds when blue's first report reaches HQ.
    const dry = await newGame();
    const first = async (g: Game, t: FakeTime) => {
      await runUntilReport(t, g);
      return Math.min(
        ...viewFor(g.state.world, 'blue', g.state.time).reports.map((r) => r.deliveredAt),
      );
    };
    const arrives = await first(dry.game, dry.time);
    await host!.close('g1');
    const due = arrives - 60_000;
    // A second dry run stopped at `due` gives where blue-1 stood then, while it marches.
    const still = await newGame();
    await still.game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    await runTo(still.time, still.game, due);
    const blue1At = (g: Game) =>
      viewFor(g.state.world, 'blue', g.state.time).ownUnits.find((u) => u.id === 'blue-1')!
        .position;
    const atDue = blue1At(still.game);
    await host!.close('g1');

    const umpire = new StubUmpire();
    const { time, game } = await newGame(umpire);
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    expect(due).toBeGreaterThan(0);
    const { answer: pending } = await ask(game, 'chiefOfStaff', 'What news?', {
      questionId: 'q1',
      askedAtGame: 0,
      answerAtGame: due,
    });
    // One long jump past both the due time and the report, with no timer to wake the actor between
    // (manual mode): the engine stops at `due` itself, and the answer is written as of then.
    await game.submit({ kind: 'setMode', mode: 'manual' });
    await game.submit({ kind: 'advanceTo', gameMs: arrives + 30 * 60_000 });
    await time.advance(0);
    await pending;
    expect(viewFor(game.state.world, 'blue', game.state.time).reports.length).toBeGreaterThan(0);
    const call = umpire.requests.find((r) => r.stage === 'staff')!;
    const input = call.input as {
      now: number;
      view: {
        reports: { deliveredAt: number }[];
        ownUnits: { id: string; position: { x: number; y: number } }[];
      };
    };
    expect(input.now).toBe(Math.round(due / 60_000));
    expect(input.view.reports.filter((r) => r.deliveredAt > due)).toEqual([]);
    // Not only the reports: the officer sees the world as it stood at `due`, not as it is now.
    expect(input.view.ownUnits.find((u) => u.id === 'blue-1')?.position).toEqual(atDue);
    expect(blue1At(game)).not.toEqual(atDue);
    expect(game.staffHistoryFor('blue')[0]?.basedOnGame).toBeLessThanOrEqual(due);
  });

  it.each([
    ['no umpire', () => undefined],
    ['a narrator', () => new StubUmpire()],
  ])(
    'wakes by itself at the due time, with %s and nothing else to wake it (#418)',
    async (_, make) => {
      const { time, game } = await newGame(make());
      const { answer } = await ask(game, 'chiefOfStaff', 'Status?', {
        questionId: 'q1',
        askedAtGame: 0,
        answerAtGame: 7 * 60_000,
      });
      let written: Awaited<typeof answer>;
      void answer.then((x) => (written = x));
      // Wall time only, before the first narration window: no command brings the world up to date.
      await time.advance(7 * 60_000 + 1_000);
      expect(written?.text).toBeDefined();
      expect(written?.basedOnGame).toBeLessThanOrEqual(7 * 60_000);
      expect(game.staffHistoryFor('blue')[0]?.text).toBe(written?.text);
    },
  );

  it('refuses a question id used before at once, even before the first is logged, per side only', async () => {
    const { time, game } = await newGame();
    const at = asked('q1');
    const first = game.answerStaff('blue', 'chiefOfStaff', 'Status?', at);
    expect(game.staffQuestionUsed('blue', 'q1')).toBe(true);
    expect(game.staffQuestionUsed('red', 'q1')).toBe(false);
    expect(await game.answerStaff('blue', 'intelligence', 'Where?', at)).toBeUndefined();
    // The same id on the other side is its own question.
    const red = game.answerStaff('red', 'chiefOfStaff', 'Status?', at);
    await runTo(time, game, 11 * 60_000);
    expect((await first)?.role).toBe('chiefOfStaff');
    expect((await red)?.text).toBeDefined();
    expect(game.staffHistoryFor('blue')).toHaveLength(1);
  });

  it('answers in the officer’s own voice and logs why when the stage gives nothing usable', async () => {
    const umpire = new StubUmpire();
    umpire.staffText = undefined;
    const { time, store, game } = await newGame(umpire);
    const { answer: pending } = await ask(game, 'engineer', 'Status?', asked('q2'));
    await runTo(time, game, 11 * 60_000);
    const answer = await pending;
    const officer = staffOfficerFor(game.state.world.seed, 'blue', 'engineer');
    expect(answer?.text).toMatch(/survey/);
    expect(answer?.textless).toBeUndefined();
    expect(answer?.officer).toEqual({ name: officer.name, traits: officer.traits });
    expect(officer.name).not.toBe(
      staffOfficerFor(game.state.world.seed, 'blue', 'chiefOfStaff').name,
    );
    const entries = await staffEntries(store);
    expect(entries.at(-1)?.error).toBeDefined();
    expect((entries.at(-1)!.command as { exchange?: { text?: string } }).exchange?.text).toBe(
      answer?.text,
    );
  });

  it('answers with no umpire at all, from the view, and replay needs no model', async () => {
    const { time, store, game } = await newGame();
    const { answer: pending } = await ask(game, 'chiefOfStaff', 'Status?', asked('q2'));
    await runTo(time, game, 11 * 60_000);
    const answer = await pending;
    expect(answer?.text).toMatch(/formation/);
    const entries = await staffEntries(store);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => (e.calls ?? []).length === 0 && e.error === undefined)).toBe(true);
  });

  it('names one officer per role in the conference tab, the signature and the Staff paper (#418)', async () => {
    const { time, game } = await newGame();
    const roles = ['chiefOfStaff', 'intelligence', 'quartermaster', 'engineer'] as const;
    const asks = await Promise.all(
      roles.map((role, i) =>
        ask(game, role, 'Status?', {
          questionId: `q-${role}`,
          askedAtGame: i,
          answerAtGame: 60_000 + i,
          askedBy: 'commander',
        }),
      ),
    );
    await runTo(time, game, 5 * 60_000);
    await Promise.all(asks.map((a) => a.answer));
    const v = sideViewOf(
      game.state,
      'blue',
      game.gameClock.snapshot(),
      { role: 'commander' },
      [],
      undefined,
      game.staffHistoryFor('blue'),
    );
    const names = new Set<string>();
    for (const role of roles) {
      const tab = v.staffOfficers![role];
      const x = v.staffHistory!.find((h) => h.role === role)!;
      const paper = v.dispatches.find((d) => d.id === `staff-q-${role}`)!;
      expect(x.officer).toEqual(tab);
      expect(paper.from).toBe(tab.name);
      expect(paper.category).toBe('staff');
      names.add(tab.name);
    }
    // Four roles, four officers.
    expect(names.size).toBe(4);
  });

  it('shows a seat only the exchanges it asked, and never the asker key', async () => {
    const umpire = new StubUmpire();
    const { game } = await newGame(umpire);
    const hq = { ...asked('q-hq'), askedBy: 'commander' };
    const sub = { ...asked('q-sub'), askedBy: seatKey({ role: 'subordinate', units: ['blue-1'] }) };
    await ask(game, 'intelligence', 'Where is the enemy?', hq);
    await ask(game, 'chiefOfStaff', 'Status?', sub);
    await game.submit({ kind: 'setRate', rate: 1 });
    const at = (seat?: Seat) => {
      const v = sideViewOf(
        game.state,
        'blue',
        game.gameClock.snapshot(),
        seat,
        [],
        undefined,
        game.staffHistoryFor('blue'),
      );
      return v;
    };
    const ids = (v: ReturnType<typeof at>) => (v.staffHistory ?? []).map((x) => x.questionId);
    expect(ids(at({ role: 'commander' }))).toEqual(['q-hq']);
    expect(ids(at({ role: 'subordinate', units: ['blue-1'] }))).toEqual(['q-sub']);
    expect(at({ role: 'quartermaster' }).staffHistory).toBeUndefined();
    expect(at({ role: 'subordinate', units: ['blue-2'] }).staffHistory).toBeUndefined();
    expect(ids(at())).toEqual(['q-hq', 'q-sub']);
    expect(JSON.stringify(at({ role: 'commander' }))).not.toContain('askedBy');
    expect(JSON.stringify(at())).not.toContain('askedBy');
  });

  it('answers a question that fell due while the game was stopped, once, after the restart', async () => {
    const umpire = new StubUmpire();
    const { time, store, game } = await newGame(umpire);
    await ask(game, 'quartermaster', 'Supplies?', asked('q1'));
    await host!.close('g1');
    expect(game.staffHistoryFor('blue')[0]?.text).toBeUndefined();
    await time.advance(20 * 60_000);
    host = new GameHost({
      store,
      parser,
      registry: registry(),
      wallNow: time.now,
      timers: time,
      narrator: () => umpire,
    });
    const reopened = await host.open('g1');
    // A reopened game comes back paused; resume it and run past the due time.
    await reopened.submit({ kind: 'resume' }).catch(() => undefined);
    await time.advance(11 * 60_000);
    await reopened.submit({ kind: 'setRate', rate: 1 });
    for (let i = 0; i < 5 && reopened.staffHistoryFor('blue')[0]?.text === undefined; i++)
      await reopened.submit({ kind: 'setRate', rate: 1 });
    const [x] = reopened.staffHistoryFor('blue');
    expect(x?.text).toBeDefined();
    expect(x?.basedOnGame).toBeLessThanOrEqual(10 * 60_000);
    expect(
      (await staffEntries(store)).filter(
        (e) => (e.command as { exchange?: { text?: string } }).exchange?.text !== undefined,
      ),
    ).toHaveLength(1);
  });

  it('shows a narration that took longer than the parse timeout (#342)', async () => {
    // The root cause of "dispatches are never model-written": narration shared the 60 s parse
    // timeout, and a small local model answers in 55 to 107 s, so good replies were thrown away.
    const umpire = new StubUmpire();
    let open!: () => void;
    umpire.gate = new Promise((r) => (open = r));
    const { time, game } = await newGame(umpire);
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 60 && !game.staffAtWork.working; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    expect(game.staffAtWork.working).toBe(true);
    await time.advance(90_000);
    expect(game.staffAtWork.working).toBe(true);
    open();
    await time.flush();
    expect(game.staffAtWork.working).toBe(false);
    const view = sideViewOf(
      game.state,
      'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor('blue'),
    );
    expect(view.dispatches.some((d) => d.text.startsWith('Sir, '))).toBe(true);
  });

  it('refuses a dispatch that names an enemy unit, in any case, and keeps the template text (#366)', async () => {
    const enemy = loadScenario(holdTheBridge).units.find((u) => u.side === 'red')!.name;
    const umpire = new StubUmpire();
    // Lower case, so only the hidden-term list (not the proper-noun check) can stop it.
    umpire.narrateText = (from) => `Sir, ${from} saw ${enemy.toLowerCase()} by the bridge.`;
    const { time, game } = await newGame(umpire);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);
    expect(umpire.requests.some((r) => r.stage === 'narrate')).toBe(true);
    const view = sideViewOf(
      game.state,
      side as 'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor(side),
    );
    expect(view.dispatches.length).toBeGreaterThan(0);
    expect(JSON.stringify(view.dispatches).toLowerCase()).not.toContain(enemy.toLowerCase());
  });

  it('gives up after the narrate timeout and keeps the template text, logging why', async () => {
    const umpire = new StubUmpire();
    umpire.gate = new Promise(() => undefined);
    const { time, store, game } = await newGame(umpire, { narrateTimeoutMs: 30_000 });
    await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march' });
    for (let i = 0; i < 60 && !game.staffAtWork.working; i++) {
      await time.advance(NARRATE_WINDOW_BASE_MS);
    }
    await time.advance(31_000);
    expect(game.staffAtWork.working).toBe(false);
    const entry = (await store.inputLog('g1')).find((e) => e.command.kind === 'narrate');
    expect(entry?.error).toMatch(/timed out/);
  });

  it('shows text from a model served by a fake Ollama (#342)', async () => {
    const seen: string[] = [];
    const fakeOllama = async (_url: unknown, init: { body?: string }) => {
      const body = JSON.parse(init.body!) as {
        model: string;
        messages: { role: string; content: string }[];
      };
      seen.push(body.model);
      const { reports } = JSON.parse(body.messages.at(-1)!.content) as {
        reports: { id: string; from: string }[];
      };
      const content = JSON.stringify({
        dispatches: reports.map((r) => ({ reportIds: [r.id], text: `Sir, ${r.from} writes.` })),
      });
      return new Response(JSON.stringify({ message: { content }, eval_count: 9 }));
    };
    const client = createUmpireClient({
      config: umpireConfigFromEnv({
        UMPIRE_KEYLESS_PROVIDER: 'ollama',
        OLLAMA_URL: 'http://ollama:11434',
        OLLAMA_STAGES: 'narrate,staff',
      }),
      env: {},
      fetch: fakeOllama as never,
    });
    const { time, game } = await newGame(client);
    const side = await runUntilReport(time, game);
    await time.advance(NARRATE_WINDOW_BASE_MS);
    expect(seen.length).toBeGreaterThan(0);
    const view = sideViewOf(
      game.state,
      side as 'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      game.narrationFor(side),
    );
    expect(view.dispatches.filter((d) => d.text.startsWith('Sir, ')).length).toBeGreaterThan(0);
    // The in-tray shows the officer's name in the dispatch, not the engine's template.
    expect(view.dispatches.some((d) => d.text === 'Sir, 2nd Battalion writes.')).toBe(false);
  });

  it('names the same conference officers in every view of a game (#342)', async () => {
    const { game } = await newGame();
    const view = () => sideViewOf(game.state, 'blue', game.gameClock.snapshot());
    const officers = view().staffOfficers!;
    expect(officers.chiefOfStaff).toEqual({
      name: staffOfficerFor(game.state.world.seed, 'blue', 'chiefOfStaff').name,
      traits: staffOfficerFor(game.state.world.seed, 'blue', 'chiefOfStaff').traits,
    });
    expect(Object.keys(officers).sort()).toEqual([
      'chiefOfStaff',
      'engineer',
      'intelligence',
      'quartermaster',
    ]);
    expect(view().staffOfficers).toEqual(officers);
  });
});
