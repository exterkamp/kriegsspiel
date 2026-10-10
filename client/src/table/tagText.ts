import type { GhostPiece, OwnPiece } from './types.js';

const gameTime = (value: number | undefined): string | undefined => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return undefined;
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} game`;
};
const shortLabel = (value: string): string => {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 41)}…` : text || 'Unnamed formation';
};

/** Paper lines only. No wall clock, report-time inference, or markup interpretation. */
export function tagLines(piece: OwnPiece | GhostPiece): readonly string[] {
  const snapshot = gameTime(piece.snapshotAtGame);
  const snapshotLine = snapshot ? `Snapshot at ${snapshot}` : 'Snapshot time unavailable';
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
  const observed = gameTime(piece.observedAtGame);
  const validAge = Number.isSafeInteger(piece.ageMs) && piece.ageMs >= 0;
  const minutes = Math.floor(piece.ageMs / 60_000);
  const age = minutes < 1 ? 'less than 1m ago' : `${minutes}m ago`;
  return [
    shortLabel(piece.sizeEstimate ?? 'Enemy contact'),
    'Strength unavailable',
    stale ? (validAge ? `Observed ${age}` : 'Observation age unavailable') : snapshotLine,
    observed ? `Observed at ${observed}` : 'Report date unavailable',
  ];
}

/** Fade is presentation only, based on supplied GAME age. No truth-position prediction. */
export function ghostOpacity(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.25;
  return Math.max(0.2, 0.6 - (Math.min(ageMs, 2 * 3_600_000) / (2 * 3_600_000)) * 0.4);
}
