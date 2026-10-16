/**
 * Turn reports (D39, story 11.9, #405): after an umpire turn each side hears, in one call, what its
 * own people saw and did, in their commanders' voices.
 *
 * The input is built from that side's view only (`viewFor` at the turn's end: its own reports of the
 * turn, its own units' commanders, manners and condition) plus, for each of its own units, the
 * umpire's `account` of what that unit's commander did and why, and the side's own words for the
 * orders that unit had. Never the umpire's `summary`, its journal, its rolls, another side's
 * accounts or any master state. An account is screened before it is shown (`screenAccount`): one
 * that names the other side, cites a figure or name the side could not know, speaks of dice, or
 * describes enemy troops the unit could not see (#533, `accountSight.ts`) is left out, and that
 * unit's note is written from the report's facts alone.
 *
 * Every note is checked as a narrated dispatch is (`checkProseAgainst` against that one report's
 * facts, `checkFieldNote`, `hiddenIn`), plus the dice words; a note that fails twice keeps the
 * engine's template text (`fieldNote`), so a report is never lost and never invented. Each note is
 * checked against its own report only, so a subordinate seat, which reads only its own units'
 * papers, never reads another formation's facts in them.
 */
import type { SideId, ViewReport, ViewUnit } from '@kriegsspiel/engine';
import type { UmpirePersona } from '@kriegsspiel/protocol';
import { accountSightProblem, ownTermsOf, type SideSight } from './accountSight.js';
import { DICE_WORDS } from './adjudicate.js';
import { hiddenIn } from './leakGuard.js';
import {
  NARRATE_SCHEMA,
  STAFF_OVERLOADED_NOTICE,
  checkFieldNote,
  checkProseAgainst,
  narrateInput,
  type NarrateOutput,
  type NarratedDispatch,
  type ProseFacts,
} from './narrate.js';
import { withPersona } from './persona.js';
import { UmpireError, type UmpireClient } from './umpireClient.js';

export const TURN_REPORTS_PROMPT_VERSION = 'turn-reports-v2';

/** A turn's reports narrated in one call; the rest keep their template text. */
export const TURN_REPORTS_MAX = 12;
/** A unit's turn note may say more than a field note: what it did, why, and what it lost. */
export const TURN_REPORT_MAX_CHARS = 600;
const TURN_REPORT_MAX_SENTENCES = 6;
/** Other kinds keep the field note's limits (`checkFieldNote`). */
const FIELD_NOTE_LIMITS = { chars: 360, sentences: 4 };

export const TURN_REPORTS_SYSTEM = `You write the notes a general receives at the end of a turn, from his own officers in the field, in the Napoleonic wars.

Input: "reports", one per paper. "kind" is what it is about, "from" the unit, "place" where, "minutesAgo" how long before it reached the general, "sizeEstimate" and "confidence" how sure, "placeAccuracy" how exactly the place is known. It may give the "commander" who writes, his "trait" (his manner) and his unit's "condition" when he wrote.
A report of kind "turn" is a unit's own account of the turn: "moved" whether it marched, "menLost" the men it lost, "status" if it broke or rallied, "orders" the orders it had in the general's own words with what became of each ("carried-out", "partly", "misread": he understood them otherwise, "refused": he chose not to, "not-arrived"), and "account": what the commander did and why, as the umpire recorded it.

Write one note per report:
- In the first person, as the officer: "Sir, we ..." or "Sir, my men ...". Never call the unit or the commander "he", "it" or by name in the third person.
- For a "turn" report, say what the unit did and why, from the "account" and in the commander's manner. If he misread or refused his orders, say plainly what he did instead and why, as he sees it.
- Use only the report's own words and figures: no other name, place, number or enemy unit. Say nothing of dice, rolls, odds or chances.
- Never say how long something lasted.
- "placeAccuracy" is how sure the place is, never a distance to the enemy or to you: if you give it, say "the place is good to about 40 m". Never say how far off the enemy is unless the report says so.
- Speak of losses only in a "turn" report.
- Two to five short sentences.

Return {"dispatches":[{"reportIds":[one report's id],"text":the note}, ...]} with one entry per report. Reply with the JSON object only.`;

/** One report as the narrate stage builds it from the side's view. */
type NarrateEntry = ReturnType<typeof narrateInput>['reports'][number];

/**
 * What one report looks like to the model; a `turn` report adds the unit's own turn. The narrate
 * entry's `radiusM` becomes words (`placeAccuracy`, #532), so the model cannot take the radius for
 * a range; a report placed exactly has none.
 */
export interface TurnReportEntry extends Omit<NarrateEntry, 'radiusM'> {
  placeAccuracy?: string;
  turn?: number;
  moved?: boolean;
  menLost?: number;
  status?: 'broke' | 'rallied';
  orders?: { text?: string; result: string }[];
  account?: string;
}

export interface TurnReportsInput {
  side: SideId;
  turn: number;
  reports: TurnReportEntry[];
}

/** One account the side may read: its own unit's, from the umpire's proposal. */
export interface OwnAccount {
  unitId: string;
  account: string;
}

export interface TurnReportsContext {
  /** The side's own units at the turn's end (`viewFor(...).ownUnits`). */
  ownUnits: readonly ViewUnit[];
  /** The umpire's accounts of the side's own units; any other unit's is ignored. */
  accounts: readonly OwnAccount[];
  /** The side's own words for its orders, by the desk's order id. */
  orderTexts: ReadonlyMap<string, string>;
  /** The map's named places, which every side knows: an account may name them. */
  places?: readonly string[];
  /** Names the side must not read (`hiddenTerms`). */
  hidden?: readonly string[];
  /**
   * What the side's units saw in the turn as the sight check let it stand (#533). With it, an
   * account that describes enemy troops the unit could not see is withheld (`accountSightProblem`).
   */
  sight?: SideSight;
  /**
   * The side's own units as they stood before the turn's outcome (#532): an umpire turn holds its
   * units until `T1`, so a paper written before `at` (an order's acknowledgement in the turn's
   * first minutes) gives the condition its unit had then, not after the fight. Without it every
   * paper gives the condition at the turn's end, as `ownUnits` has it.
   */
  before?: { at: number; ownUnits: readonly ViewUnit[] };
}

/** The radius of a report's place in words that cannot be read as a range (#532). */
export function placeAccuracy(radiusM: number): string | undefined {
  return radiusM > 0 ? `good to about ${Math.round(radiusM)} m` : undefined;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
const WORD = /[\p{L}][\p{L}'’-]*/gu;
const ID = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

/** The facts one entry holds, for the prose checks: its strings' words and numbers, its ids. */
function factsOf(entry: TurnReportEntry, extraWords: readonly string[] = []): ProseFacts {
  const strings: string[] = [];
  const numbers: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (typeof v === 'number') numbers.push(v, Math.round(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  // Ids and enum values are not facts to cite; the rest is.
  const rest: Partial<TurnReportEntry> = { ...entry };
  for (const key of ['id', 'kind', 'confidence', 'status'] as const) delete rest[key];
  walk(rest);
  if (entry.menLost !== undefined && entry.menLost >= 10) {
    numbers.push(Math.round(entry.menLost / 10) * 10, Math.round(entry.menLost / 100) * 100);
  }
  const text = [...strings, ...extraWords].join('\n');
  return {
    numbers: [...numbers, ...(text.match(NUMBER) ?? []).map((n) => Number(n.replace(',', '.')))],
    words: [...(text.match(WORD) ?? []).map((w) => w.toLowerCase())],
    ids: [entry.id, ...(JSON.stringify(rest).match(ID) ?? [])],
  };
}

/**
 * Why the umpire's `account` may not be shown to the side, or nothing when it may: it names the
 * other side (`hidden`), cites a figure, name or id the side's own report and order texts do not
 * have (the map's places excepted), or speaks of dice. Free prose, so any word may open a sentence.
 */
export function screenAccount(
  account: string,
  entry: TurnReportEntry,
  places: readonly string[] = [],
  hidden: readonly string[] = [],
): string[] {
  const facts = factsOf(entry, places);
  return [
    ...checkProseAgainst(account, { ...facts, lenientOpeners: true }),
    ...hiddenIn(account, hidden),
    ...(DICE_WORDS.test(account) ? ['speaks of dice or odds'] : []),
  ];
}

const SPELLED: Record<string, number> = Object.fromEntries([
  ...'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
    .split(' ')
    .map((w, i) => [w, i + 1] as const),
  ...'thirty forty fifty sixty seventy eighty ninety'
    .split(' ')
    .map((w, i) => [w, (i + 3) * 10] as const),
  ['hundred', 100],
  ['thousand', 1000],
]);
const SPELLED_RUN = `(?:(?:${Object.keys(SPELLED).join('|')})[\\s-]+){0,3}(?:${Object.keys(SPELLED).join('|')})`;

/** A distance: a number in digits or words, then a unit of length. */
const DISTANCE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?|${SPELLED_RUN})\\s*(?:paces?|yards?|yds|met(?:re|er)s?|m|kilomet(?:re|er)s?|km|miles?)\\b`,
  'giu',
);

/** What a distance phrase's number is worth: "40" and "forty" are 40, "two hundred" is 200. */
function distanceValue(number: string): number {
  if (/^\d/.test(number)) return Number(number.replace(',', '.'));
  let total = 0;
  let current = 0;
  for (const w of number.toLowerCase().split(/[\s-]+/)) {
    const v = SPELLED[w] ?? 0;
    if (v === 1000) {
      total += (current || 1) * v;
      current = 0;
    } else if (v === 100) current = (current || 1) * v;
    else current += v;
  }
  return total + current;
}

/** Words just before a distance that make it how sure a place is, not a range: "good to about". */
const ACCURACY_BEFORE =
  /\b(?:good|accurate|true|exact|right|out|off|wrong|astray|uncertain)\s+(?:to|by|within)?\s*(?:within\s+)?(?:about|some|perhaps|roughly|nearly|around|a)?\s*$|\b(?:give or take|plus or minus)\s+(?:about|some)?\s*$/i;

/** Words just after a distance that make it how far the place may be out: "of that spot". */
const ACCURACY_AFTER =
  /^\s+(?:of|from)\s+(?:the|that|this|their|its)\s+(?:position|place|spot|point|mark)\b/i;

/**
 * The distances a note states that its report does not give (#532). A report's place radius is how
 * sure the place is (`placeAccuracy`), so a note may word it so ("the place is good to about 40 m",
 * "out by some 40 metres", "within twenty metres of that spot"); said any other way ("it lies
 * within twenty metres of us", "within about 40 metres of the bridge") it reads as a range, and is
 * refused. A distance the report's own
 * words give (an order's "about 80 paces east of the bridge", an account's "at 200 paces") stands.
 */
export function distanceProblems(text: string, entry: TurnReportEntry): string[] {
  const own: Partial<TurnReportEntry> = { ...entry };
  delete own.placeAccuracy;
  const given = new Set(
    [...JSON.stringify(own).matchAll(DISTANCE)].map((m) => distanceValue(m[1]!)),
  );
  const problems: string[] = [];
  for (const m of text.matchAll(DISTANCE)) {
    if (given.has(distanceValue(m[1]!))) continue;
    if (ACCURACY_BEFORE.test(text.slice(0, m.index))) continue;
    if (ACCURACY_AFTER.test(text.slice(m.index + m[0].length))) continue;
    problems.push(
      `states a distance ("${m[0]}") the report does not give: "placeAccuracy" is how sure the place is, not a range`,
    );
  }
  return problems;
}

/** Kinds written before or apart from the turn's fight, whose notes may not speak of losses. */
const NO_LOSS_KINDS: ReadonlySet<string> = new Set(['orderDelivered', 'contact']);
const LOSSES =
  /\b(?:loss|losses|casualties|killed|wounded|dead|lost (?:\w+ ){0,2}(?:men|heavily|many|dearly|badly)|(?:men|ranks) (?:are |were |have been )?(?:lost|thinned)|cut up|bled|bleeding)\b/i;
/** Short ammunition said in other words than the condition's ("short of powder"). */
const SHORT_AMMUNITION =
  /\b(?:short of (?:powder|ammunition|cartridges|ball|rounds)|(?:powder|ammunition|cartridges) (?:is |are )?(?:running |grown |growing )?(?:low|short|scarce|out)|(?:our|my|the) last (?:rounds|cartridges))\b/i;

/**
 * What an acknowledgement or contact note says of its unit's state that the report does not give
 * (#532): any loss, and short ammunition when the unit's condition (when it wrote) has none.
 */
function stateProblems(text: string, entry: TurnReportEntry): string[] {
  if (!NO_LOSS_KINDS.has(entry.kind)) return [];
  const problems: string[] = [];
  const loss = text.match(LOSSES);
  if (loss) problems.push(`speaks of losses ("${loss[0]}") the report does not give`);
  const short = text.match(SHORT_AMMUNITION);
  if (short && !/running low|nearly gone/.test(entry.condition ?? '')) {
    problems.push(`ammunition "${short[0]}" is not the unit’s when it wrote`);
  }
  return problems;
}

/** The problems with one note on `entry`; empty means it may be shown. */
export function checkTurnNote(
  text: string,
  entry: TurnReportEntry,
  hidden: readonly string[] = [],
): string[] {
  if (text.trim() === '') return ['empty note'];
  return [
    ...new Set([
      ...checkProseAgainst(text, factsOf(entry)),
      ...hiddenIn(text, hidden),
      ...(DICE_WORDS.test(text) ? ['speaks of dice or odds'] : []),
      ...distanceProblems(text, entry),
      ...stateProblems(text, entry),
      ...checkFieldNote(
        text,
        // `checkFieldNote` reads neither the radius nor its words.
        { ...entry, radiusM: 0 },
        entry.kind === 'turn'
          ? { chars: TURN_REPORT_MAX_CHARS, sentences: TURN_REPORT_MAX_SENTENCES }
          : FIELD_NOTE_LIMITS,
      ),
    ]),
  ];
}

/**
 * The model's input for `side`'s papers of turn `turn`, and why any account was left out. `reports`
 * must be the side's own view's reports.
 */
export function turnReportsInput(
  side: SideId,
  turn: number,
  reports: readonly ViewReport[],
  ctx: TurnReportsContext,
): { input: TurnReportsInput; withheld: Array<{ reportId: string; reason: string }> } {
  const withheld: Array<{ reportId: string; reason: string }> = [];
  const atEnd = narrateInput(side, reports, ctx.ownUnits).reports;
  // A paper written before the outcome speaks for its unit as it stood then (#532).
  const before = ctx.before && narrateInput(side, reports, ctx.before.ownUnits).reports;
  const entries = reports.map((r, i): TurnReportEntry => {
    const early = before !== undefined && r.observedAt < ctx.before!.at;
    const { radiusM, ...base } = (early ? before : atEnd)[i]!;
    const accuracy = placeAccuracy(radiusM);
    const entry: TurnReportEntry = {
      ...base,
      ...(accuracy === undefined ? {} : { placeAccuracy: accuracy }),
    };
    if (r.kind !== 'turn' || !r.turn) return entry;
    const t = r.turn;
    entry.turn = t.n;
    entry.moved = t.movedM >= 50;
    if (t.lost > 0) entry.menLost = t.lost;
    if (t.broke) entry.status = 'broke';
    else if (t.rallied) entry.status = 'rallied';
    if (t.orders.length > 0) {
      entry.orders = t.orders.map((o) => {
        const text = o.ref === undefined ? undefined : ctx.orderTexts.get(o.ref);
        return { ...(text === undefined ? {} : { text }), result: o.result };
      });
    }
    // The sender is the side's own unit of that name; only its own account is shown.
    const unit = ctx.ownUnits.find((u) => u.name === r.from);
    const account = unit && ctx.accounts.find((a) => a.unitId === unit.id)?.account.trim();
    if (account) {
      const problems = screenAccount(account, entry, ctx.places, ctx.hidden);
      const unseen =
        ctx.sight && accountSightProblem(account, unit.id, ctx.sight, ownTermsOf(ctx.ownUnits));
      if (unseen) problems.push(unseen);
      if (problems.length === 0) entry.account = account;
      else withheld.push({ reportId: r.id, reason: `account withheld (${problems.join('; ')})` });
    }
    return entry;
  });
  return { input: { side, turn, reports: entries }, withheld };
}

export interface TurnReportsResult {
  /** The model's notes that passed, one per report; the others keep their template text. */
  dispatches: NarratedDispatch[];
  calls: number;
  rejections: string[][];
  /** Each report that kept its template text, and why. */
  fallbacks: Array<{ reportId: string; reason: string }>;
  /** Accounts not shown to the model, and why. */
  withheld: Array<{ reportId: string; reason: string }>;
  /** Set when the game's budget or rate limit refused the call. */
  overloaded?: string;
}

export interface TurnReportsOptions {
  /** Calls allowed, the first included: one resend for the notes that failed. Default 2. */
  maxCalls?: number;
  persona?: UmpirePersona;
  /** Aborted when the reports' time is up: what has passed is kept, the rest keep their templates. */
  signal?: AbortSignal;
}

/** The reports of a turn to narrate: delivered after `startMs` and by `endMs`, the newest kept. */
export function reportsOfTurn(
  reports: readonly ViewReport[],
  startMs: number,
  endMs: number,
): ViewReport[] {
  return reports
    .filter(
      (r) =>
        r.deliveredAt > startMs &&
        r.deliveredAt <= endMs &&
        r.kind !== 'battle' &&
        r.kind !== 'notice',
    )
    .sort((a, b) => a.deliveredAt - b.deliveredAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const ABORTED = Symbol('aborted');

/** `work`, or `ABORTED` as soon as `signal` fires. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(ABORTED);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Write `side`'s papers of a turn in one call (a second for the notes that failed). Any failure
 * (transport, refusal, timeout, a reply of the wrong shape, an exception) keeps the template text
 * of every report not yet narrated; this never throws.
 */
export async function writeTurnReports(
  client: UmpireClient,
  side: SideId,
  turn: number,
  reports: readonly ViewReport[],
  ctx: TurnReportsContext,
  opts: TurnReportsOptions = {},
): Promise<TurnReportsResult> {
  const kept = reports.slice(-TURN_REPORTS_MAX);
  const { input, withheld } = turnReportsInput(side, turn, kept, ctx);
  const result: TurnReportsResult = {
    dispatches: [],
    calls: 0,
    rejections: [],
    fallbacks: reports
      .slice(0, reports.length - kept.length)
      .map((r) => ({ reportId: r.id, reason: 'over the per-turn limit of reports' })),
    withheld,
  };
  if (input.reports.length === 0) return result;
  const maxCalls = opts.maxCalls ?? 2;
  const done = new Map<string, string>();
  const problems = new Map<string, string[]>();
  let stopped: string | undefined;
  while (result.calls < maxCalls && stopped === undefined) {
    const todo = input.reports.filter((r) => !done.has(r.id));
    if (todo.length === 0) break;
    const rejected = [...problems].flatMap(([id, p]) => p.map((x) => `${id}: ${x}`));
    const ask: TurnReportsInput = { ...input, reports: todo };
    result.calls++;
    let output: NarrateOutput;
    try {
      ({ output } = await untilAborted(
        client.call<NarrateOutput>({
          stage: 'narrate',
          promptVersion: TURN_REPORTS_PROMPT_VERSION,
          system: withPersona(TURN_REPORTS_SYSTEM, opts.persona),
          input: rejected.length > 0 ? { ...ask, rejected } : ask,
          schema: NARRATE_SCHEMA,
        }),
        opts.signal,
      ));
    } catch (e) {
      if (e === ABORTED) stopped = 'timed out';
      else if (e instanceof UmpireError && (e.kind === 'budget' || e.kind === 'rate-limit')) {
        // A refused call was never sent.
        result.calls--;
        result.overloaded = STAFF_OVERLOADED_NOTICE;
        stopped = 'umpire budget or rate limit';
      } else {
        const why = e instanceof UmpireError ? e.kind : e instanceof Error ? e.message : String(e);
        stopped = `the model call failed (${why})`;
      }
      break;
    }
    problems.clear();
    const seen = new Set<string>();
    const all: string[] = [];
    for (const d of Array.isArray(output?.dispatches) ? output.dispatches : []) {
      const ids = Array.isArray(d?.reportIds) ? d.reportIds : [];
      const text = typeof d?.text === 'string' ? d.text.trim() : '';
      const id = ids[0];
      // A note again for a report already written is not asked for; the first stands.
      if (ids.length === 1 && id !== undefined && done.has(id)) continue;
      const entry = todo.find((r) => r.id === id);
      if (ids.length !== 1 || !entry || seen.has(entry.id)) {
        all.push(`a note must name exactly one report of the input (${ids.join(', ') || 'none'})`);
        continue;
      }
      seen.add(entry.id);
      const wrong = checkTurnNote(text, entry, ctx.hidden);
      if (wrong.length === 0) done.set(entry.id, text);
      else problems.set(entry.id, wrong);
    }
    for (const r of todo) {
      if (!done.has(r.id) && !problems.has(r.id)) problems.set(r.id, ['no note for this report']);
    }
    const rejectedNow = [...problems].flatMap(([id, p]) => p.map((x) => `${id}: ${x}`));
    if (rejectedNow.length > 0 || all.length > 0) result.rejections.push([...all, ...rejectedNow]);
  }
  for (const r of input.reports) {
    const text = done.get(r.id);
    if (text !== undefined) {
      result.dispatches.push({ reportIds: [r.id], text });
      continue;
    }
    const wrong = problems.get(r.id);
    result.fallbacks.push({
      reportId: r.id,
      reason: stopped ?? `rejected (${(wrong ?? ['no note']).join('; ')})`,
    });
  }
  return result;
}
