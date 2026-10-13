/**
 * Judgment rulings (3.6): the bounded discretion the umpire has where no rule applies, and the
 * per-game case law they build up. The model proposes a modifier and a rationale; the engine
 * clamps the modifier to `JUDGMENT_CAP`, applies it and records a `JudgmentRuling`. The queued
 * event carries the whole proposal, so replaying the input log needs no model call.
 */
import type { EngineState, EventRegistry, Json } from './events.js';
import { schedule } from './queue.js';
import type { GameState, JudgmentRuling } from './types.js';

/** The largest swing a ruling may give, as a fraction of the rule's figure (0.25 is 25%). */
export const JUDGMENT_CAP = 0.25;

export const JUDGMENT_EVENT = 'umpire.judgment';

/** A situation with no rule, raised by the engine. `key` names the kind of situation. */
export interface JudgmentRequest {
  key: string;
  situation: string;
  unitId?: string;
}

/** What the umpire (or its fallback) answered, queued whole. */
export interface JudgmentProposal {
  request: JudgmentRequest;
  /** Beyond the cap is clamped; not a finite number counts as 0. */
  modifier: number;
  rationale: string;
  narrative: string;
  fallback?: boolean;
  precedent?: boolean;
}

export function clampModifier(requested: number): { modifier: number; clamped: boolean } {
  if (!Number.isFinite(requested)) return { modifier: 0, clamped: true };
  const modifier = Math.max(-JUDGMENT_CAP, Math.min(JUDGMENT_CAP, requested));
  return { modifier: Math.round(modifier * 1000) / 1000, clamped: modifier !== requested };
}

/** Queue a judgment to be ruled on at `time` (default: now). */
export function issueJudgment(
  state: EngineState<GameState>,
  proposal: JudgmentProposal,
  time = state.time,
): EngineState<GameState> {
  return schedule(state, [{ time, type: JUDGMENT_EVENT, payload: proposal as unknown as Json }]);
}

export function registerJudgment(registry: EventRegistry<GameState>): void {
  registry.register(JUDGMENT_EVENT, (w, ev) => {
    const p = ev.payload as unknown as JudgmentProposal;
    const world: GameState = { ...w, time: ev.time };
    const { modifier, clamped } = clampModifier(p.modifier);
    const ruling: JudgmentRuling = {
      id: `ruling-${world.rulings.length + 1}`,
      time: ev.time,
      kind: 'judgment',
      key: p.request.key,
      situation: p.request.situation,
      ...(p.request.unitId ? { unitId: p.request.unitId } : {}),
      requested: Number.isFinite(p.modifier) ? p.modifier : 0,
      modifier,
      clamped,
      fallback: p.fallback === true,
      precedent: p.precedent === true,
      rationale: p.rationale,
      narrative: p.narrative,
    };
    return {
      world: { ...world, rulings: [...world.rulings, ruling] },
      emit: [
        {
          type: 'umpire.ruling',
          payload: { rulingId: ruling.id, key: ruling.key, modifier, clamped },
        },
      ],
    };
  });
}

/**
 * The game's case law: every ruling that came from the umpire's own judgment (a fallback is no
 * precedent, and a repeat that followed one adds nothing), oldest first. Master state: it names the situations of both sides.
 */
export function caseLaw(world: GameState): JudgmentRuling[] {
  return world.rulings.filter(
    (r): r is JudgmentRuling => 'kind' in r && r.kind === 'judgment' && !r.fallback && !r.precedent,
  );
}

/** The standing ruling on a situation: the first one, so later rulings cannot drift from it. */
export function precedentFor(world: GameState, key: string): JudgmentRuling | undefined {
  return caseLaw(world).find((r) => r.key === key);
}

/** The modifier to apply to the rule's figure for `key`: the standing ruling's, else 0. */
export function judgmentModifier(world: GameState, key: string): number {
  return precedentFor(world, key)?.modifier ?? 0;
}
