/**
 * The grader's rubric for the umpire benchmark (#398). A grader (a Claude Code pane on Opus)
 * scores each anonymised proposal 1 to 5 on each criterion and writes `grades.json` in the shape
 * of `Grades`. See docs/umpire-benchmark.md.
 */
export const RUBRIC = [
  {
    key: 'plausibility',
    title: 'Plausibility by Napoleonic practice',
    guide:
      '5: what an experienced umpire of 1824-1870 would rule: march distances, fire and melee only in reach, losses and morale in proportion, cavalry and infantry behaving as their arm does. 3: mostly sensible with one doubtful outcome. 1: impossible or absurd outcomes (units crossing impassable water, whole battalions wiped out with no fight, nothing happening in a hot fight).',
  },
  {
    key: 'faithfulness',
    title: 'Faithfulness to the written orders and the commander',
    guide:
      '5: every order read as written and as that commander would read it (personality, arrival minute, garbled order misread, order on the road not acted on, impossible order refused or adapted with a reason, injected text ignored). 3: one order misread without cause or one personality ignored. 1: orders ignored or invented.',
  },
  {
    key: 'consistency',
    title: 'Consistency with the state and the previous turn',
    guide:
      '5: every outcome follows from the start state and the previous turn (no men regained, broken units stay broken unless rallied with cause, positions continuous, departures from the engine projection explained). 3: one unexplained jump. 1: contradicts the input.',
  },
  {
    key: 'fog',
    title: 'Fog-of-war discipline',
    guide:
      "5: observations only where a unit could see (sight range, woods), accounts in each commander's voice that know only what his own side could know (no enemy unit names or commanders). 3: one sighting or account that knows too much. 1: the accounts read like the umpire's omniscient view.",
  },
  {
    key: 'prose',
    title: 'Quality of the in-character accounts and summary',
    guide:
      '5: clear, period-flavoured, specific accounts a player would enjoy reading and a summary that explains the turn. 3: correct but flat or generic. 1: empty, repetitive, or off-topic text.',
  },
] as const;

export type RubricKey = (typeof RUBRIC)[number]['key'];

/** `grades.json`: per anonymous letter, per case, a score per criterion and a short note. */
export type Grades = Record<
  string,
  Record<string, Partial<Record<RubricKey, number>> & { note?: string }>
>;

export function rubricMarkdown(): string {
  return [
    '# Rubric',
    '',
    'Score each proposal 1 to 5 on each criterion (whole numbers). A proposal that is missing or not valid JSON gets 1 on every criterion.',
    '',
    ...RUBRIC.map((r) => `## ${r.key}: ${r.title}\n\n${r.guide}\n`),
  ].join('\n');
}
