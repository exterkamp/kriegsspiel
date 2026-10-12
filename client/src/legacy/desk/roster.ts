import type { Coord, OwnUnit, SideView } from '@kriegsspiel/protocol';

/** How old a report is, in game time, before the roster marks it as aging or stale. */
export const AGING_MS = 30 * 60_000;
export const STALE_MS = 2 * 60 * 60_000;

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface RosterRow {
  id: string;
  name: string;
  /** Who commands it, when the scenario names one. */
  commander: string | undefined;
  trait: string | undefined;
  /** Men, as reported (not a percent), or undefined when the report gives no usable figure. */
  strength: number | undefined;
  supply: number | undefined;
  morale: number | undefined;
  /** Game time of the report these figures come from. */
  reportedAt: number;
  ageMs: number;
  freshness: Freshness;
  position: Coord;
}

export function freshness(ageMs: number): Freshness {
  return ageMs >= STALE_MS ? 'stale' : ageMs >= AGING_MS ? 'aging' : 'fresh';
}

const known = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A 0..1 fraction as a whole percent; anything else is unknown, never zero. */
export const pct = (n: unknown): number | undefined => (known(n) ? Math.round(n * 100) : undefined);

/** `45 min`, `3 h 10 min`, `1 d 2 h`: game time elapsed, the same at every clock rate. */
export function formatAge(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** `just now`, or `45 min old`: how old a figure is, in words that read right at every age. */
export function formatAgeOld(ms: number): string {
  const age = formatAge(ms);
  return age === 'just now' ? age : `${age} old`;
}

/**
 * One row per formation in the SideView, and nothing else. The figures are as of the unit's own
 * `reportedAt` when the server sends one, else `view.atGame`, so they age as game time runs on past
 * it (a lost link, a slow umpire). `nowGame` is the local game time, which is the same arithmetic
 * at 1:1 and 12:1.
 */
export function rosterRows(view: SideView | undefined, nowGame: number): RosterRow[] {
  if (!view) return [];
  return view.ownUnits.map((u: OwnUnit) => {
    // Each unit's figures carry their own report date; older servers date them to the view.
    // Never dated after the clock the player is reading (the local clock can lag the server's view by a moment).
    const reportedAt = Math.min(u.reportedAt ?? view.atGame, nowGame);
    const ageMs = Math.max(0, nowGame - reportedAt);
    return {
      id: u.id,
      name: u.name,
      commander: u.commander,
      trait: u.trait,
      strength: known(u.strength) ? Math.round(u.strength) : undefined,
      supply: pct(u.supply),
      morale: pct(u.morale),
      reportedAt,
      ageMs,
      freshness: freshness(ageMs),
      position: u.position,
    };
  });
}
