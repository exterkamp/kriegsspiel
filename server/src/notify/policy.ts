/**
 * What reaches a player, and how. Pure: no clock, no I/O.
 *
 * A notification carries only a fixed title and line per event kind. It never names a unit, a place or
 * a number, so nothing hidden can ride in one (docs/architecture.md, Notifier).
 */
import type { NotifyEvent } from '@kriegsspiel/protocol';

export type { NotifyEvent };

/** `all`: every event. `urgent`: contact, losses, decisions, a proposed pause, the end. `contact`: contact reports only. */
export type Threshold = 'all' | 'urgent' | 'contact' | 'off';

export const THRESHOLDS: readonly Threshold[] = ['all', 'urgent', 'contact', 'off'];

/** A daily window, in minutes after local midnight; the window may wrap midnight. */
export interface QuietHours {
  startMin: number;
  endMin: number;
  /** Minutes east of UTC for the player's local time (so UTC+2 is 120). */
  utcOffsetMin: number;
}

export interface NotifyPrefs {
  threshold: Threshold;
  /** While quiet, push and email are held back; a player with the game open is still told. */
  quietHours?: QuietHours;
  push: boolean;
  email: boolean;
}

export const DEFAULT_PREFS: NotifyPrefs = { threshold: 'urgent', push: true, email: true };

const URGENT: ReadonlySet<NotifyEvent> = new Set([
  'contact',
  'unitLost',
  'pauseProposed',
  'decision',
  'gameOver',
]);

/** Whether `event` passes the player's threshold. */
export function wanted(prefs: NotifyPrefs, event: NotifyEvent): boolean {
  switch (prefs.threshold) {
    case 'all':
      return true;
    case 'urgent':
      return URGENT.has(event);
    case 'contact':
      return event === 'contact';
    case 'off':
      return false;
  }
}

export const isUrgent = (event: NotifyEvent): boolean => URGENT.has(event);

const DAY_MIN = 24 * 60;

/** Whether wall time `nowMs` falls inside the player's quiet hours. */
export function isQuiet(quiet: QuietHours | undefined, nowMs: number): boolean {
  if (!quiet || quiet.startMin === quiet.endMin) return false;
  const local = (((Math.floor(nowMs / 60_000) + quiet.utcOffsetMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return quiet.startMin < quiet.endMin
    ? local >= quiet.startMin && local < quiet.endMin
    : local >= quiet.startMin || local < quiet.endMin;
}

/** The fixed words of each event. */
export const NOTICE: Record<NotifyEvent, { title: string; text: string }> = {
  dispatch: { title: 'Dispatch received', text: 'A dispatch has reached your headquarters.' },
  contact: {
    title: 'Contact reported',
    text: 'A report of contact has reached your headquarters.',
  },
  unitLost: { title: 'Unit lost', text: 'A report of a lost unit has reached your headquarters.' },
  pauseProposed: {
    title: 'Pause proposed',
    text: 'A pause has been proposed. Your vote is needed.',
  },
  decision: { title: 'Your decision is needed', text: 'A vote is open and waiting for you.' },
  paused: { title: 'Game paused', text: 'The game clock has stopped.' },
  resumed: { title: 'Game resumed', text: 'The game clock is running again.' },
  gameOver: { title: 'Game over', text: 'The game has ended.' },
};
