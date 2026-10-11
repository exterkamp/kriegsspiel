import type { HqError, Result, Scope } from '../contracts/index.js';

export const sameScope = (a: Scope, b: Scope): boolean =>
  a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = <T = never>(code: HqError['code'], message: string): Result<T> => ({
  ok: false,
  error: { code, message, retry: code === 'conflict' ? 'after-resolution' : 'never' },
});
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
