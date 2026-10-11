/** Presentation only: preserve the supplied integer game milliseconds in data. */
function validMilliseconds(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function formatGameTime(value: number | null | undefined): string {
  if (!validMilliseconds(value)) return 'Time unavailable';
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Exact game duration for semantic time metadata, separate from visible rounding. */
export function formatGameDuration(value: number | null | undefined): string | undefined {
  if (!validMilliseconds(value)) return undefined;
  const remainder = value % 1000;
  const seconds = (value - remainder) / 1000;
  const fraction =
    remainder === 0 ? '' : `.${String(remainder).padStart(3, '0').replace(/0+$/, '')}`;
  return `PT${seconds}${fraction}S`;
}

export function formatGameAge(ageMs: number | null | undefined): string {
  if (!validMilliseconds(ageMs)) return 'Age unavailable';
  if (ageMs === 0) return 'current snapshot';
  if (ageMs < 1000) return 'less than 1s ago';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
