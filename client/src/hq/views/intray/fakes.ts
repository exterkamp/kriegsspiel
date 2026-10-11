import type { HqSnapshot, Paper, Scope } from '../../contracts';
import type { StoragePort } from './store';
export const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
export function paper(id = 'paper-1', overrides: Partial<Paper> = {}): Paper {
  return {
    id,
    from: 'Supplied scout',
    category: 'scouts',
    writtenAtGame: 100,
    receivedAtGame: 200,
    observedAtGame: null,
    location: { x: 0, y: 10 },
    unitId: null,
    sizeEstimate: null,
    confidence: null,
    text: 'Supplied plain paper text',
    ...overrides,
  };
}
export function snapshot(papers: readonly Paper[] = [paper()], fixedScope = scope): HqSnapshot {
  return {
    scope: fixedScope,
    epoch: 'fixture',
    ordinal: 1,
    authorityRevision: null,
    atGame: 200,
    clock: {
      authoritativeGameMs: 200,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster: [],
    pieces: [],
    papers,
  };
}
export class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  blocked = false;
  quota = false;
  duringWrite?: () => void;
  getItem(key: string) {
    this.reads++;
    if (this.blocked) throw new Error('blocked');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw new Error('blocked');
    if (this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.values.set(key, value);
    this.writes++;
    this.duringWrite?.();
  }
}
