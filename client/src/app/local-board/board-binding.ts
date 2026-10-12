import { assetIdentity, canonicalizeAsset, type MapAsset } from '@kriegsspiel/maps';
import { z } from 'zod';
import { validateSceneMarks } from '../../legacy/table/fixtureMarks';
import type { CertifiedBoard } from '../../shared/game-setup/contracts';
import type { LocalBoardBinding, LocalPresentation } from './contracts';

const extent = z
  .object({
    minX: z.literal(0),
    minY: z.literal(0),
    maxX: z.number().finite().positive(),
    maxY: z.number().finite().positive(),
  })
  .strict();
const bindingSchema = z
  .object({
    assetIdentity: z.string().regex(/^[0-9a-f]{64}$/),
    revision: z.string(),
    mapId: z.string(),
    bounds: extent,
    registration: z
      .object({
        origin: z.literal('north-west'),
        units: z.literal('metres'),
        xAxis: z.literal('east'),
        yAxis: z.literal('south'),
      })
      .strict(),
  })
  .strict()
  .refine((b) => b.revision === b.assetIdentity && b.mapId === `local-map:${b.assetIdentity}`);

/** Only plain, detached value snapshots belong in Angular state. */
export function freezeBoardSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeBoardSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Checks the certified handoff, not a replacement for complete worker certification. */
export function snapshotCertifiedBoard(input: CertifiedBoard): CertifiedBoard {
  const board = structuredClone(input);
  const bounds = extent.parse(board.bounds);
  const asset = board.asset;
  if (
    !/^[0-9a-f]{64}$/.test(board.assetIdentity) ||
    canonicalizeAsset(structuredClone(asset) as MapAsset) !== board.canonicalJson ||
    asset.bounds.minX !== 0 ||
    asset.bounds.minY !== 0 ||
    asset.bounds.maxX !== bounds.maxX ||
    asset.bounds.maxY !== bounds.maxY ||
    board.summary.widthM !== bounds.maxX ||
    board.summary.heightM !== bounds.maxY ||
    board.summary.name !== asset.name
  )
    throw new TypeError('The certified board bytes, summary and bounds disagree.');
  return freezeBoardSnapshot(board);
}

export function validateLocalBinding(value: unknown): LocalBoardBinding {
  return freezeBoardSnapshot(bindingSchema.parse(value) as LocalBoardBinding);
}

export function sameLocalBinding(a: LocalBoardBinding, b: LocalBoardBinding): boolean {
  return (
    a.assetIdentity === b.assetIdentity &&
    a.revision === b.revision &&
    a.mapId === b.mapId &&
    a.bounds.minX === b.bounds.minX &&
    a.bounds.minY === b.bounds.minY &&
    a.bounds.maxX === b.bounds.maxX &&
    a.bounds.maxY === b.bounds.maxY &&
    a.registration.origin === b.registration.origin &&
    a.registration.units === b.registration.units &&
    a.registration.xAxis === b.registration.xAxis &&
    a.registration.yAxis === b.registration.yAxis
  );
}

export type BoardIdentity = (asset: MapAsset) => Promise<string>;
export async function createLocalBoardBinding(
  input: CertifiedBoard,
  signal: AbortSignal,
  identity: BoardIdentity = (asset) => assetIdentity(asset, 'asset'),
): Promise<LocalBoardBinding> {
  const current = () => {
    if (signal.aborted) throw new Error('Board binding cancelled.');
  };
  current();
  const board = snapshotCertifiedBoard(input);
  current();
  const digest = await identity(structuredClone(board.asset) as MapAsset);
  current();
  if (digest !== board.assetIdentity)
    throw new TypeError('The full certified asset identity does not match.');
  return validateLocalBinding({
    assetIdentity: digest,
    revision: digest,
    mapId: `local-map:${digest}`,
    bounds: board.bounds,
    registration: { origin: 'north-west', units: 'metres', xAxis: 'east', yAxis: 'south' },
  });
}

const presentationSchema = z
  .object({
    binding: bindingSchema,
    marks: z.unknown(),
    gameMs: z.literal(0),
    rate: z.literal(0),
    pieces: z.array(z.never()).length(0),
    roster: z.array(z.never()).length(0),
    papers: z.array(z.never()).length(0),
  })
  .strict();

export function validateLocalPresentation(
  value: unknown,
  binding: LocalBoardBinding,
): LocalPresentation {
  const fixed = validateLocalBinding(binding);
  const parsed = presentationSchema.parse(value);
  if (!sameLocalBinding(parsed.binding as LocalBoardBinding, fixed))
    throw new TypeError('Local board binding cannot change within a session.');
  const marks = validateSceneMarks(parsed.marks, {
    width: fixed.bounds.maxX,
    height: fixed.bounds.maxY,
  });
  return freezeBoardSnapshot({
    binding: fixed,
    marks,
    gameMs: 0,
    rate: 0,
    pieces: [],
    roster: [],
    papers: [],
  });
}
