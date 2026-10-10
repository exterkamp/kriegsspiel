import { z } from 'zod';
import type { MapPresentation } from '../contracts/index.js';
import { demoArtwork } from './fixture.js';
import { sameScope } from './common.js';
import { validateMarks } from './marks/index.js';

const id = z.string().min(1).max(128);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scope = z.object({ gameId: id, sideId: id, playerId: id }).strict();
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const piece = z
  .object({
    key: id,
    unitId: id,
    relationship: z.enum(['own', 'enemy']),
    label: z.string().max(256),
    position: point,
    provenance: z.enum(['fixture-snapshot', 'fixture-contact']),
    observedAtGame: time.nullable(),
    ageMs: time.nullable(),
    uncertaintyRadiusM: z.number().finite().nonnegative().nullable(),
    appearance: z
      .object({
        facingRad: z.number().finite(),
        formation: z.enum(['line', 'column', 'square', 'skirmish', 'loose']),
        frontageM: z.number().finite().positive(),
        depthM: z.number().finite().positive(),
        shape: z.array(point).min(1).max(256).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const artwork = z
  .object({
    kind: z.literal('public-artwork'),
    id,
    revision: id,
    widthM: z.number().finite().positive(),
    heightM: z.number().finite().positive(),
    image: z
      .object({
        url: z.literal('/hq-preview.svg'),
        pixelWidth: z.literal(1200),
        pixelHeight: z.literal(900),
      })
      .strict(),
    registration: z.literal('full-image-nw-origin'),
    credit: z.string().max(256),
    licence: z.string().max(256),
    sourceUrl: z.string().max(2048).nullable(),
  })
  .strict();
const schema = z
  .object({
    scope,
    revision: id,
    snapshot: z.object({ atGame: time, epoch: id, ordinal: time }).strict(),
    artwork,
    mode: z.literal('fixture-knowledge-preview'),
    pieces: z.array(piece).max(1000),
    marks: z.array(z.unknown()).max(200),
    selection: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }).strict(),
      z.object({ kind: z.enum(['unit', 'paper']), id, scope }).strict(),
    ]),
  })
  .strict();

export function parsePresentation(raw: unknown): MapPresentation | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (
    JSON.stringify(p.artwork) !== JSON.stringify(demoArtwork) ||
    (p.selection.kind !== 'none' && !sameScope(p.scope, p.selection.scope))
  )
    return null;
  const seen = new Set<string>();
  for (const piece of p.pieces) {
    if (
      seen.has(piece.key) ||
      piece.key !== `${piece.relationship === 'own' ? 'own' : 'contact'}:${piece.unitId}` ||
      piece.position.x < 0 ||
      piece.position.x > p.artwork.widthM ||
      piece.position.y < 0 ||
      piece.position.y > p.artwork.heightM
    )
      return null;
    seen.add(piece.key);
    if (piece.appearance) {
      const { facingRad, frontageM, depthM, shape } = piece.appearance;
      if (frontageM > p.artwork.widthM || depthM > p.artwork.heightM) return null;
      for (const offset of shape ?? []) {
        const x =
          piece.position.x + offset.x * Math.cos(facingRad) + offset.y * Math.sin(facingRad);
        const y =
          piece.position.y + offset.x * Math.sin(facingRad) - offset.y * Math.cos(facingRad);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > p.artwork.widthM ||
          y < 0 ||
          y > p.artwork.heightM
        )
          return null;
      }
    }
    if (piece.provenance === 'fixture-contact') {
      if (
        piece.relationship !== 'enemy' ||
        piece.observedAtGame === null ||
        piece.observedAtGame > p.snapshot.atGame ||
        piece.ageMs !== p.snapshot.atGame - piece.observedAtGame ||
        piece.appearance !== null
      )
        return null;
    } else if (
      piece.observedAtGame !== null ||
      piece.appearance === null ||
      piece.ageMs !== (piece.relationship === 'own' ? null : 0)
    )
      return null;
  }
  const marks = validateMarks(p.marks, p.scope, p.artwork);
  return marks.ok ? { ...p, marks: marks.value } : null;
}
