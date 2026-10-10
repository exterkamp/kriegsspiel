import { z } from 'zod';
import type {
  HqSnapshot,
  MarkCreateInput,
  MarkEditInput,
  PersonalMark,
  PersonalMarksDocument,
  PublicArtwork,
  Result,
  Scope,
} from '../../contracts/index.js';
import { failure, immutable, sameScope, success } from '../common.js';

export const MAX_RECORD_LENGTH = 1_048_576;
export const idSchema = z.string().min(1).max(128);
export const scopeSchema = z
  .object({ gameId: idSchema, sideId: idSchema, playerId: idSchema })
  .strict();
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const mapSchema = z.object({ id: idSchema, revision: idSchema }).strict();
const geometry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin'), at: point }).strict(),
  z.object({ kind: z.literal('polyline'), points: z.array(point).min(2).max(256) }).strict(),
  z.object({ kind: z.literal('arrow'), points: z.array(point).min(2).max(256) }).strict(),
  z
    .object({ kind: z.literal('ring'), centre: point, radiusM: z.number().finite().positive() })
    .strict(),
  z
    .object({ kind: z.literal('symbol'), at: point, symbol: z.enum(['cross', 'dot', 'flag']) })
    .strict(),
]);
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }).strict(),
  z
    .object({
      kind: z.literal('paper'),
      paperId: idSchema,
      writtenAtGame: time,
      receivedAtGame: time,
      observedAtGame: time.nullable(),
      reportedLocation: point.nullable(),
      excerpt: z.string().max(512),
    })
    .strict(),
]);
const markSchema = z
  .object({
    id: idSchema,
    scope: scopeSchema,
    map: mapSchema,
    label: z.string().max(256),
    geometry,
    source,
    placedAtGame: time.nullable(),
    editedAtGame: time.nullable(),
  })
  .strict();
const createSchema = z
  .object({
    label: z.string().max(256),
    geometry,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('manual') }).strict(),
      z.object({ kind: z.literal('paper'), paperId: idSchema }).strict(),
    ]),
  })
  .strict();
const editSchema = z.object({ label: z.string().max(256), geometry }).strict();
const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    map: mapSchema,
    revision: idSchema,
    marks: z.array(markSchema).max(200),
  })
  .strict();
const artworkSchema = z
  .object({
    kind: z.literal('public-artwork'),
    id: idSchema,
    revision: idSchema,
    widthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    image: z
      .object({
        url: z.string().min(1),
        pixelWidth: z.number().int().positive().max(16384),
        pixelHeight: z.number().int().positive().max(16384),
      })
      .strict(),
    registration: z.literal('full-image-nw-origin'),
    credit: z.string(),
    licence: z.string(),
    sourceUrl: z.string().nullable(),
  })
  .strict();

/** The coordinator supplies approved artwork; this module never loads or discovers assets. */
export function cloneBinding(
  scope: Scope,
  artwork: PublicArtwork,
): { scope: Scope; artwork: PublicArtwork } {
  return immutable({ scope: scopeSchema.parse(scope), artwork: artworkSchema.parse(artwork) });
}
const inBounds = (p: { x: number; y: number }, a: PublicArtwork) =>
  p.x >= 0 && p.y >= 0 && p.x <= a.widthM && p.y <= a.heightM;
export function sameArtifact(map: PersonalMark['map'], artwork: PublicArtwork): boolean {
  return map.id === artwork.id && map.revision === artwork.revision;
}

export function validateMarks(
  raw: unknown,
  scope: Scope,
  artwork: PublicArtwork,
): Result<readonly PersonalMark[]> {
  const parsed = z.array(markSchema).max(200).safeParse(raw);
  if (!parsed.success)
    return failure('invalid-data', 'Personal marks contain invalid or unsupported data.');
  const seen = new Set<string>();
  for (const mark of parsed.data) {
    if (!sameScope(mark.scope, scope))
      return failure('scope-mismatch', 'Personal marks belong to a different headquarters.');
    if (!sameArtifact(mark.map, artwork))
      return failure('conflict', 'Personal marks belong to another map revision.');
    const g = mark.geometry;
    const points =
      g.kind === 'pin' || g.kind === 'symbol' ? [g.at] : g.kind === 'ring' ? [g.centre] : g.points;
    if (
      seen.has(mark.id) ||
      points.some((p) => !inBounds(p, artwork)) ||
      (g.kind === 'ring' && g.radiusM > Math.hypot(artwork.widthM, artwork.heightM))
    )
      return failure('invalid-data', 'Personal mark geometry exceeds the map or document limits.');
    seen.add(mark.id);
    if (mark.source.kind === 'paper') {
      const p = mark.source;
      if (
        (p.observedAtGame !== null && p.observedAtGame > p.writtenAtGame) ||
        p.writtenAtGame > p.receivedAtGame ||
        (mark.placedAtGame !== null && mark.placedAtGame < p.receivedAtGame) ||
        (p.reportedLocation !== null && !inBounds(p.reportedLocation, artwork))
      )
        return failure('invalid-data', 'Personal mark paper provenance is inconsistent.');
    }
    if (
      mark.placedAtGame !== null &&
      mark.editedAtGame !== null &&
      mark.editedAtGame < mark.placedAtGame
    )
      return failure('invalid-data', 'Personal mark edit time precedes placement.');
  }
  return success(immutable(parsed.data));
}

export function validateDocument(
  raw: unknown,
  scope: Scope,
  artwork: PublicArtwork,
): Result<PersonalMarksDocument> {
  if (
    raw &&
    typeof raw === 'object' &&
    'schemaVersion' in raw &&
    typeof raw.schemaVersion === 'number' &&
    Number.isSafeInteger(raw.schemaVersion) &&
    raw.schemaVersion > 1
  )
    return failure(
      'migration-required',
      'These personal marks use a newer version. Stored data was preserved.',
    );
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success)
    return failure(
      'invalid-data',
      'Stored personal marks are malformed. Stored data was preserved.',
    );
  const d = parsed.data;
  if (!sameScope(d.scope, scope))
    return failure('scope-mismatch', 'Stored personal marks belong to a different headquarters.');
  if (!sameArtifact(d.map, artwork))
    return failure('conflict', 'Stored personal marks belong to another map revision.');
  const marks = validateMarks(d.marks, scope, artwork);
  return marks.ok ? success(immutable({ ...d, marks: marks.value })) : marks;
}

export function immutableProvenance(mark: PersonalMark): string {
  return JSON.stringify([mark.id, mark.scope, mark.map, mark.source, mark.placedAtGame]);
}
export function checkEditHistory(previous: PersonalMark, next: PersonalMark): Result<void> {
  if (immutableProvenance(previous) !== immutableProvenance(next))
    return failure('conflict', 'A personal mark’s original provenance cannot be changed.');
  if (
    previous.editedAtGame !== null &&
    (next.editedAtGame === null || next.editedAtGame < previous.editedAtGame)
  )
    return failure(
      'invalid-data',
      'A known personal mark edit time cannot be erased or moved backwards.',
    );
  return success(undefined);
}

export function createPersonalMark(
  input: MarkCreateInput,
  context: {
    scope: Scope;
    artwork: PublicArtwork;
    snapshot: HqSnapshot | null;
    gameMs: number | null;
  },
  idFactory: () => string = () => crypto.randomUUID(),
): Result<PersonalMark> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success || !time.nullable().safeParse(context.gameMs).success)
    return failure('invalid-data', 'The personal mark form or display time is invalid.');
  if (context.snapshot && !sameScope(context.snapshot.scope, context.scope))
    return failure('scope-mismatch', 'The paper snapshot belongs to a different headquarters.');
  let captured: PersonalMark['source'] = { kind: 'manual' };
  if (parsed.data.source.kind === 'paper') {
    const snapshot = context.snapshot;
    if (!snapshot) return failure('not-ready', 'A current paper snapshot is required.');
    const paperId = parsed.data.source.paperId;
    const matching = snapshot.papers.filter((p) => p.id === paperId);
    if (!matching.length) return failure('not-found', 'The selected paper is unavailable.');
    if (matching.length !== 1)
      return failure('conflict', 'The selected paper has conflicting copies.');
    const paper = matching[0]!;
    if (typeof paper.text !== 'string')
      return failure('invalid-data', 'The selected paper text is invalid.');
    if (!time.safeParse(snapshot.atGame).success || paper.receivedAtGame > snapshot.atGame)
      return failure('invalid-data', 'The paper dates are inconsistent with the snapshot.');
    captured = {
      kind: 'paper',
      paperId,
      writtenAtGame: paper.writtenAtGame,
      receivedAtGame: paper.receivedAtGame,
      observedAtGame: paper.observedAtGame,
      reportedLocation: paper.location,
      excerpt: paper.text.slice(0, 512),
    };
  }
  try {
    const result = validateMarks(
      [
        {
          id: idFactory(),
          scope: context.scope,
          map: { id: context.artwork.id, revision: context.artwork.revision },
          label: parsed.data.label,
          geometry: parsed.data.geometry,
          source: captured,
          placedAtGame: context.gameMs,
          editedAtGame: null,
        },
      ],
      context.scope,
      context.artwork,
    );
    return result.ok ? success(result.value[0]!) : result;
  } catch {
    return failure('internal', 'The personal mark could not be created.');
  }
}

export function editPersonalMark(
  existing: PersonalMark,
  input: MarkEditInput,
  artwork: PublicArtwork,
  gameMs: number | null,
): Result<PersonalMark> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success || !time.nullable().safeParse(gameMs).success)
    return failure('invalid-data', 'The personal mark form or display time is invalid.');
  const before = validateMarks([existing], existing.scope, artwork);
  if (!before.ok) return before;
  const result = validateMarks(
    [{ ...before.value[0]!, ...parsed.data, editedAtGame: gameMs }],
    existing.scope,
    artwork,
  );
  if (!result.ok) return result;
  const next = result.value[0]!;
  const history = checkEditHistory(before.value[0]!, next);
  return history.ok ? success(next) : history;
}
