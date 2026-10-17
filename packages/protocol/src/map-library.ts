import { z } from 'zod';
import { assertBattlefieldBudget } from './battlefield-catalog.js';
const reference = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('included'),
      id: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
    })
    .strict(),
  z.object({ kind: z.literal('owned'), id: z.uuid() }).strict(),
]);
export const LibraryNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (name) =>
      name.trim().length > 0 &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name),
    'Invalid map name',
  );
export const LibraryMapSummarySchema = z
  .object({
    ref: reference,
    name: LibraryNameSchema,
    widthM: z.number().finite().min(1).max(20000),
    heightM: z.number().finite().min(1).max(20000),
    assetIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal('needs-scenario'),
    createdAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if ((item.ref.kind === 'owned') !== (item.createdAtMs !== undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'Owned timestamps must be explicit; included maps have no owner timestamp',
      });
  });
export type LibraryMapDescriptor = z.infer<typeof LibraryMapSummarySchema>;
const cursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_.-]+$/);
const page = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(LibraryMapSummarySchema).max(20),
    nextCursor: cursor.optional(),
  })
  .strict();
export function decodeLibraryMapSummary(value: unknown): LibraryMapDescriptor {
  assertBattlefieldBudget(value, 4096);
  return LibraryMapSummarySchema.parse(value);
}
export function decodeLibraryPage(value: unknown, source: 'included' | 'owned') {
  assertBattlefieldBudget(value, 32768);
  const result = page.parse(value);
  const seen = new Set<string>();
  for (const item of result.items) {
    if (item.ref.kind !== source || seen.has(item.ref.id))
      throw new Error('Invalid library page binding');
    seen.add(item.ref.id);
  }
  if (result.nextCursor && !result.items.length) throw new Error('Empty library continuation');
  return result;
}
