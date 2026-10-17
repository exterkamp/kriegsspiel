import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assetIdentity,
  canonicalizeAsset,
  createReferenceAsset,
  importAsset,
} from '@kriegsspiel/maps';
import { verifyPreparedLibraryAsset } from './preparation-verifier';
import type { LibraryAssetVerifier } from './http';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const asset = createReferenceAsset();
const json = canonicalizeAsset(asset);
const check: LibraryAssetVerifier = async (job) => {
  const parsed = importAsset(job.canonicalJson);
  if (
    canonicalizeAsset(parsed) !== job.canonicalJson ||
    (await assetIdentity(parsed, 'asset')) !== job.assetIdentity ||
    !job.candidate ||
    canonicalizeAsset(job.candidate) !== job.canonicalJson
  )
    throw new Error('Mismatch');
  return parsed;
};
describe('lobby opt-in preparation verification', () => {
  it('hashes exact canonical bytes and delegates candidate agreement to the trusted worker boundary', async () => {
    const verify = vi.fn(check);
    const signal = new AbortController().signal;
    const result = await verifyPreparedLibraryAsset(structuredClone(asset), json, signal, verify);
    expect(result.assetIdentity).toBe(await assetIdentity(asset, 'asset'));
    expect(result.assetIdentity).not.toBe(await assetIdentity(asset, 'geometry'));
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]).toEqual([
      {
        canonicalJson: json,
        assetIdentity: result.assetIdentity,
        widthM: 150,
        heightM: 150,
        candidate: asset,
      },
      signal,
    ]);
    expect(canonicalizeAsset(result.asset)).toBe(json);
  });
  it('rejects a changed prepared asset rather than silently replacing it with the raw bytes', async () => {
    const changed = structuredClone(asset);
    changed.name = 'Different candidate';
    await expect(
      verifyPreparedLibraryAsset(changed, json, new AbortController().signal, check),
    ).rejects.toThrow('Mismatch');
  });
  it('does no verification work for a preaborted owner', async () => {
    const abort = new AbortController();
    abort.abort();
    const verify = vi.fn(check);
    await expect(
      verifyPreparedLibraryAsset(asset, json, abort.signal, verify),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('does not allocate verification after its noncancellable digest returns to a departed owner', async () => {
    let finish!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const abort = new AbortController();
    const verify = vi.fn(check);
    const pending = verifyPreparedLibraryAsset(asset, json, abort.signal, verify);
    abort.abort();
    finish(new ArrayBuffer(32));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(verify).not.toHaveBeenCalled();
  });
  it('cannot publish a noncooperating verification result after owner abort', async () => {
    let finish!: (value: typeof asset) => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const verify = vi.fn<LibraryAssetVerifier>(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const abort = new AbortController();
    const pending = verifyPreparedLibraryAsset(asset, json, abort.signal, verify);
    await enteredPromise;
    abort.abort();
    finish(structuredClone(asset));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['', '\uD800', ' '.repeat(64 * 1024 * 1024 + 1)])(
    'rejects malformed or oversized bytes before delegation',
    async (text) => {
      const verify = vi.fn(check);
      await expect(
        verifyPreparedLibraryAsset(asset, text, new AbortController().signal, verify),
      ).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
    },
  );
});
