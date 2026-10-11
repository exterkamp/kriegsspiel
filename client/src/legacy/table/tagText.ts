import type { GhostPiece, OwnPiece } from './types.js';
import { formatGameAge, formatGameTime } from './gameTime.js';

const shortLabel = (value: string): string => {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 41)}…` : text || 'Unnamed formation';
};

/** Paper lines only. No wall clock, report-time inference, or markup interpretation. */
export function tagLines(piece: OwnPiece | GhostPiece): readonly string[] {
  const snapshot = formatGameTime(piece.snapshotAtGame);
  const snapshotLine =
    snapshot === 'Time unavailable' ? 'Snapshot time unavailable' : `Snapshot at ${snapshot}`;
  if (piece.kind === 'own') {
    const strength = piece.strength;
    return [
      shortLabel(piece.label),
      strength !== undefined && Number.isFinite(strength) && strength >= 0
        ? `Strength: ${Math.round(strength)}`
        : 'Strength unavailable',
      snapshotLine,
      'Report date unavailable',
    ];
  }
  const stale = piece.observedAtGame !== undefined || piece.ageMs > 0;
  const observed = formatGameTime(piece.observedAtGame);
  const age = formatGameAge(piece.ageMs);
  return [
    shortLabel(piece.sizeEstimate ?? 'Enemy contact'),
    'Strength unavailable',
    age === 'Age unavailable'
      ? 'Observation age unavailable'
      : stale
        ? `Observed ${age}`
        : snapshotLine,
    observed === 'Time unavailable' ? 'Report date unavailable' : `Observed at ${observed}`,
  ];
}

/** Fade is presentation only, based on supplied GAME age. No truth-position prediction. */
export function ghostOpacity(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.25;
  return Math.max(0.2, 0.6 - (Math.min(ageMs, 2 * 3_600_000) / (2 * 3_600_000)) * 0.4);
}
