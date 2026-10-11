/** Mark-panel fixtures contain local annotations and filtered paper text only. */
import { vi } from 'vitest';
import type {
  MarkCreateInput,
  MarkEditInput,
  MarkGeometry,
  Paper,
  PersonalMark,
  PublicArtwork,
  Result,
} from '../../contracts';
export const ok = (): Result<void> => ({ ok: true, value: undefined });
export const fail = (message = 'Storage conflict'): Result<void> => ({
  ok: false,
  error: { code: 'conflict', message, retry: 'after-resolution' },
});
export const artwork: PublicArtwork = {
  kind: 'public-artwork',
  id: 'fixture-map',
  revision: '2',
  widthM: 4000,
  heightM: 3000,
  image: { url: '/fixture-map.svg', pixelWidth: 1200, pixelHeight: 900 },
  registration: 'full-image-nw-origin',
  credit: 'Original test artwork',
  licence: 'CC0',
  sourceUrl: null,
};
export const paper: Paper = {
  id: 'paper-1',
  from: 'Fixture staff',
  category: 'staff',
  writtenAtGame: 100,
  receivedAtGame: 200,
  observedAtGame: null,
  location: { x: 0, y: 10 },
  unitId: null,
  sizeEstimate: null,
  confidence: null,
  text: 'A supplied paper excerpt.',
};
export function mark(
  geometry: MarkGeometry = { kind: 'pin', at: { x: 350, y: 250 } },
): PersonalMark {
  return {
    id: 'mark-1',
    scope: { gameId: 'fixture', sideId: 'blue', playerId: 'one' },
    map: { id: artwork.id, revision: artwork.revision },
    label: 'Road junction',
    geometry,
    source: {
      kind: 'paper',
      paperId: paper.id,
      writtenAtGame: paper.writtenAtGame,
      receivedAtGame: paper.receivedAtGame,
      observedAtGame: paper.observedAtGame,
      reportedLocation: paper.location,
      excerpt: paper.text,
    },
    placedAtGame: 300,
    editedAtGame: null,
  };
}
export function props(marks: readonly PersonalMark[] = []) {
  return {
    marks,
    artwork,
    papers: [paper] as readonly Paper[],
    busy: false,
    writable: true,
    dirty: false,
    status: 'Local fixture repository ready.',
    onCreate: vi.fn<(input: MarkCreateInput) => Result<void>>(() => ok()),
    onEdit: vi.fn<(id: string, input: MarkEditInput) => Result<void>>(() => ok()),
    onDelete: vi.fn<(id: string) => Result<void>>(() => ok()),
    onSave: vi.fn<() => Promise<Result<void>>>(async () => ok()),
    onReload: vi.fn<() => Promise<Result<void>>>(async () => ok()),
    onFocus: vi.fn<(id: string) => Promise<Result<void>>>(async () => ok()),
  };
}
