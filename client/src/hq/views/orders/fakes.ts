import type { HqSnapshot, Scope, RosterRow } from '../../contracts';
import type { StoragePort } from './repository';
export const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
export function formation(unitId = 'own-1', name = 'First formation'): RosterRow {
  return {
    unitId,
    name,
    commander: { kind: 'unknown', reason: 'Not supplied' },
    position: { kind: 'unknown', reason: 'Not supplied' },
    strength: { kind: 'unknown', reason: 'Not supplied' },
    morale: { kind: 'unknown', reason: 'Not supplied' },
    supply: { kind: 'unknown', reason: 'Not supplied' },
  };
}
export function snapshot(roster: readonly RosterRow[] = [formation()]): HqSnapshot {
  return {
    scope,
    epoch: 'fixture',
    ordinal: 1,
    authorityRevision: null,
    atGame: 0,
    clock: {
      authoritativeGameMs: 0,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster,
    papers: [],
    pieces: [
      {
        key: 'contact:enemy',
        unitId: 'enemy',
        relationship: 'enemy',
        label: 'Enemy contact',
        position: { x: 0, y: 0 },
        provenance: 'fixture-contact',
        observedAtGame: null,
        ageMs: null,
        uncertaintyRadiusM: null,
        appearance: null,
      },
    ],
  };
}
export class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  blocked = false;
  quota = false;
  onRead?: () => void;
  beforeWrite?: () => void;
  afterWrite?: () => void;
  getItem(key: string) {
    this.reads++;
    if (this.blocked) throw Error('secret detail');
    this.onRead?.();
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw Error('secret detail');
    if (this.quota) throw new DOMException('secret quota', 'QuotaExceededError');
    this.beforeWrite?.();
    this.values.set(key, value);
    this.writes++;
    this.afterWrite?.();
  }
}
