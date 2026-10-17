import { describe, expect, it } from 'vitest';
import { decodeLibraryMapSummary, decodeLibraryPage } from './map-library.js';
const item = () => ({
  ref: { kind: 'owned', id: 'ca0bb489-7c7e-4e6d-9d8f-ff5a76da4cce' },
  name: 'My field',
  widthM: 5000,
  heightM: 5000,
  assetIdentity: 'a'.repeat(64),
  status: 'needs-scenario',
  createdAtMs: 1,
});
describe('unpaired public map library boundary', () => {
  it('returns detached allowlisted geography metadata and explicit continuation', () => {
    const input = { schemaVersion: 1, items: [item()], nextCursor: 'opaque.signed' };
    const read = decodeLibraryPage(input, 'owned');
    read.items[0]!.name = 'changed';
    expect(input.items[0]!.name).toBe('My field');
    expect(read.nextCursor).toBe('opaque.signed');
  });
  it.each(['pairing', 'private-pin', 'timestamp', 'identity', 'bounds', 'name', 'surrogate'])(
    'rejects %s instead of inventing playable readiness',
    (kind) => {
      const value = item();
      if (kind === 'pairing') Object.assign(value, { pairing: { id: 'native' } });
      if (kind === 'private-pin') Object.assign(value, { initialWorld: { units: [] } });
      if (kind === 'timestamp') value.createdAtMs = -1;
      if (kind === 'identity') value.assetIdentity = 'geometry';
      if (kind === 'bounds') value.widthM = Infinity;
      if (kind === 'name') value.name = ' ';
      if (kind === 'surrogate') value.name = '\ud800';
      expect(() => decodeLibraryMapSummary(value)).toThrow();
    },
  );
  it('rejects foreign source, duplicate entries, oversized and empty continuation pages', () => {
    expect(() => decodeLibraryPage({ schemaVersion: 1, items: [item()] }, 'included')).toThrow();
    expect(() =>
      decodeLibraryPage({ schemaVersion: 1, items: [item(), item()] }, 'owned'),
    ).toThrow();
    expect(() =>
      decodeLibraryPage({ schemaVersion: 1, items: Array.from({ length: 21 }, item) }, 'owned'),
    ).toThrow();
    expect(() =>
      decodeLibraryPage({ schemaVersion: 1, items: [], nextCursor: 'again' }, 'owned'),
    ).toThrow();
  });
});
