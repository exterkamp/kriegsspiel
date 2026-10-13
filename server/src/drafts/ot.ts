/**
 * Operational transform over plain text, for shared order drafts (D6c). The implementation lives in
 * the protocol package so the browser editor and the server run the same code; this re-exports it.
 */
import { textOt, type TextOp } from '@kriegsspiel/protocol';

export type { TextOp };
export const {
  baseLength,
  targetLength,
  normalize,
  fits,
  apply,
  identity,
  transform,
  transformThrough,
  transformIndex,
  transformRange,
  insertAt,
  deleteAt,
  reattribute,
  diff,
} = textOt;
