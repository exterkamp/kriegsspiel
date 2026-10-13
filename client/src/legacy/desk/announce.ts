import type { Dispatch } from '@kriegsspiel/protocol';
import type { Exchange } from './conference';

/** What a screen reader hears when something arrives while the player is looking elsewhere (#59). */
export function dispatchAnnouncement(
  seen: ReadonlySet<string>,
  dispatches: readonly Dispatch[],
): string {
  const fresh = dispatches.filter((d) => !seen.has(d.id));
  if (fresh.length === 0) return '';
  if (fresh.length === 1) return `New dispatch from ${fresh[0]!.from}.`;
  return `${fresh.length} new dispatches.`;
}

/** Staff answers (or failures) that were not there at the last look. */
export function answerAnnouncement(seen: ReadonlySet<number>, log: readonly Exchange[]): string {
  const fresh = log.filter((e) => !seen.has(e.id) && (e.answer !== undefined || e.failed === true));
  if (fresh.length === 0) return '';
  const e = fresh[0]!;
  const more = fresh.length > 1 ? ` and ${fresh.length - 1} more` : '';
  return e.failed
    ? `A staff officer could not be reached${more}. Ask again in the staff conference.`
    : `A staff officer has answered${more}. Open the staff conference to read it.`;
}
