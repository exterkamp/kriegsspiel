import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
} from '../provider.js';
import { testParse } from './testParse.js';

/** The model name the test provider reports. Priced at zero, so no budget limit trips. */
export const TEST_MODEL = 'test';

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Which stage asked, from the output schema it wants. The request carries no stage name. */
function stageOf(schema: Json): 'parse' | 'narrate' | 'staff' | 'judge' | 'command' | undefined {
  const keys = Object.keys((schema.properties as Json | undefined) ?? {});
  if (keys.includes('result')) return 'parse';
  if (keys.includes('dispatches')) return 'narrate';
  if (keys.includes('messages')) return 'staff';
  if (keys.includes('placements')) return 'judge';
  if (keys.includes('orders')) return 'command';
  return undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One dispatch per report, built only from the report's own fields, so it passes `checkNarration`:
 * the officer, place and size as given, and only the numbers the report has.
 */
function narrate(input: Json) {
  return {
    dispatches: arr(input.reports).map((r) => {
      const from = str(r.from);
      const place = str(r.place);
      const size = str(r.sizeEstimate);
      const minutes = num(r.minutesAgo);
      const radius = num(r.radiusM);
      const when = minutes === 0 ? 'just now' : `about ${plural(minutes, 'minute', 'minutes')} ago`;
      const where = place ? ` ${place}` : '';
      const body =
        r.kind === 'contact'
          ? `${from} sighted ${size || 'enemy troops'}${where}, ${when}`
          : r.kind === 'unitLost'
            ? `${from} is lost to us${where}, ${when}; I cannot say more`
            : r.kind === 'orderDelivered'
              ? `${from} has received its orders${where}, ${when}`
              : r.kind === 'lowAmmo'
                ? `${from} is running short of ammunition${where}, ${when}`
                : r.kind === 'exhausted'
                  ? `${from} is exhausted${where}, ${when}`
                  : r.kind === 'engaged'
                    ? `${from} is engaged${where}, ${when}`
                    : r.kind === 'heavyLosses'
                      ? `${from} is taking heavy losses${where}, ${when}`
                      : r.kind === 'broke'
                        ? `${from} has broken and is falling back${where}, ${when}`
                        : `${from} reports its situation${where}, ${when}`;
      // Only what the staff saw for themselves is hedged or vouched for.
      const sure =
        r.kind !== 'contact' && r.kind !== 'situation'
          ? ''
          : r.confidence === 'low'
            ? ' It is thought so, though I would not swear to it'
            : r.confidence === 'high'
              ? ' There is no doubt of it'
              : '';
      const reach = radius > 0 ? ` The ground is good to within ${radius} metres.` : '';
      return {
        reportIds: [str(r.id)],
        text: `Sir, ${body}.${sure ? `${sure}.` : ''}${reach}`,
      };
    }),
  };
}

type Topic = 'enemy' | 'supply' | 'fatigue' | 'ground' | 'orders' | 'general';

const TOPICS: [Topic, RegExp][] = [
  ['enemy', /\b(?:enemy|enemies|contact|contacts|sighting|red|foe|force|forces|scout|scouts)\b/i],
  ['supply', /\b(?:ammunition|ammo|supply|supplies|powder|shot|provision|provisions|food)\b/i],
  ['fatigue', /\b(?:tired|tire|fatigue|fatigued|rest|exhausted|morale|march)\b/i],
  ['ground', /\b(?:ground|terrain|bridge|river|ford|wood|woods|road|hill|cover|defen[cs]e)\b/i],
  ['orders', /\b(?:order|orders|plan|advance|attack|hold|withdraw|should|next)\b/i],
];

/** How each role opens, so two officers asked the same thing do not give the same sentence (#323). The officer's name picks one. */
const OPENERS: Record<string, string[]> = {
  chiefOfStaff: ['Sir, as I read the whole picture:', 'Sir, taking the staff view:'],
  intelligence: [
    'Sir, from what the scouts and sightings give me:',
    'Sir, weighing the enemy reports:',
  ],
  quartermaster: [
    'Sir, by the returns and the road:',
    'Sir, on the wagons and the cartridge boxes:',
  ],
  subordinate: ['Sir, from my own line:'],
};

const nameHash = (name: string): number =>
  [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Short in-character advice from the officer's role and the topic keywords of a question, if any. */
function staff(input: Json) {
  const officer = (input.officer ?? {}) as Json;
  const role = str(officer.role);
  const view = (input.view ?? {}) as Json;
  const own = arr(view.ownUnits);
  const seen = arr(view.visibleEnemies).length;
  const contacts = arr(view.lastKnownContacts).length;
  const question = str(input.question);
  const traits = Array.isArray(officer.traits) ? (officer.traits as unknown[]).map(str) : [];
  const bold = traits.includes('bold') || traits.includes('hasty');
  const topic: Topic =
    TOPICS.find(([, re]) => re.test(question))?.[0] ??
    (role === 'intelligence'
      ? 'enemy'
      : role === 'quartermaster'
        ? 'supply'
        : role === 'subordinate'
          ? 'orders'
          : 'general');
  // The newest contact report the side has received, whether or not a contact still stands in the tables.
  const latest = arr(view.reports)
    .filter((r) => r.kind === 'contact')
    .sort((a, b) => num(b.deliveredAt) - num(a.deliveredAt))[0];
  const word = latest
    ? ` The latest word, a report received at game minute ${Math.floor(num(latest.deliveredAt) / 60_000)}: ${str(latest.text)}`
    : '';
  const enemy =
    seen > 0
      ? `We have ${plural(seen, 'enemy formation', 'enemy formations')} in sight.${word}`
      : contacts > 0
        ? `We have no enemy in sight; ${plural(contacts, 'earlier contact is', 'earlier contacts are')} stale.${word}`
        : latest
          ? `We have no enemy in sight.${word}`
          : 'We have no enemy in sight, and I know nothing more.';
  const text: Record<Topic, string> = {
    enemy: `${enemy} ${bold ? 'I would not wait for more.' : 'I would want more scouting before acting on it.'}`,
    supply:
      'I have no report of shortage, sir, but I cannot see into every cartridge box. Keep couriers moving.',
    fatigue: `The troops are as fresh as ${own.length > 0 ? plural(own.length, 'unit', 'units') : 'we'} can be after the march. Do not ask a long march of them twice running.`,
    ground: 'Hold the crossings and the cover, sir; ground we can see is ground we can keep.',
    orders: bold
      ? 'Press the advantage, sir, and let each unit have a clear order and a clear place.'
      : 'Give each unit one clear order and one clear place, sir, and let the couriers ride before the enemy moves.',
    general: `${enemy} Our ${plural(own.length, 'unit', 'units')} await your orders.`,
  };
  const choices = OPENERS[role] ?? OPENERS.chiefOfStaff!;
  const opener = traits.includes('terse')
    ? ''
    : `${choices[nameHash(str(officer.name)) % choices.length]} `;
  return { messages: [{ kind: 'advice', text: `${opener}${text[topic]}` }] };
}

/** A hold-and-react plan: every unit holds the place nearest the objective, in plain words the parser knows. */
function command(input: Json) {
  const objective = (input.objective ?? {}) as Json;
  const places = arr(input.places).filter((p) => str(p.name));
  const view = (input.view ?? {}) as Json;
  const nearest = [...places].sort(
    (a, b) =>
      Math.hypot(num(a.x) - num(objective.x), num(a.y) - num(objective.y)) -
        Math.hypot(num(b.x) - num(objective.x), num(b.y) - num(objective.y)) ||
      (str(a.id) < str(b.id) ? -1 : 1),
  )[0];
  return {
    orders: arr(view.ownUnits).map((u) => ({
      unit: str(u.name),
      text: `${str(u.name)} hold ${nearest ? str(nearest.name) : 'here'}`,
    })),
  };
}

export function testReply(schema: Json, input: Json): unknown {
  switch (stageOf(schema)) {
    case 'parse':
      return testParse(input as never);
    case 'narrate':
      return narrate(input);
    case 'staff':
      return staff(input);
    case 'command':
      return command(input);
    case 'judge':
      return { placements: [] };
    default:
      throw new Error('test provider: unknown output schema');
  }
}

/**
 * A provider that answers every stage from rules and templates: deterministic, offline, free. It
 * has no transport, so it cannot reach a network. Selected with `{ "type": "test" }`, or
 * `UMPIRE_PROVIDER=test`. See docs/llm-providers.md.
 */
export class TestProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = { structuredOutput: 'native', toolUse: false };

  constructor(opts: { id?: string } = {}) {
    this.id = opts.id ?? 'test';
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const input = JSON.parse(req.messages[req.messages.length - 1]?.content ?? '{}') as Json;
    return {
      text: JSON.stringify(testReply(req.schema, input)),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}
