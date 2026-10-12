import { readFile } from 'node:fs/promises';
import { assetIdentity, importAsset } from '@kriegsspiel/maps';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BoardPreparation, CertifiedBoard } from '../../shared/game-setup/contracts.js';
import {
  DEFAULT_MAP_IDENTITY,
  DEFAULT_MAP_SUMMARY,
  DEFAULT_MAP_URL,
  loadDefaultBoard,
} from './default-board.js';

const expectedIdentity = '26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84';
const expectedUrl = '/__local-default/countryside-rectangle.json';
const expectedSummary = {
  ref: { kind: 'premade', id: 'countryside-rectangle' },
  name: 'Countryside — 5 × 3 km',
  widthM: 5000,
  heightM: 3000,
} as const;
const expectedBounds = { minX: 0, minY: 0, maxX: 5000, maxY: 3000 } as const;
let json: string;
let fixture: CertifiedBoard;
let geometryIdentity: string;

beforeAll(async () => {
  // Resolve from this module, independent of the runner's working directory.
  json = await readFile(
    new URL('../../../../data/maps/countryside-rectangle.json', import.meta.url),
    'utf8',
  );
  const asset = importAsset(json);
  fixture = {
    asset,
    canonicalJson: json,
    assetIdentity: await assetIdentity(asset, 'asset'),
    summary: {
      name: asset.name,
      ref: { kind: 'premade', id: 'countryside-rectangle' },
      widthM: asset.bounds.maxX,
      heightM: asset.bounds.maxY,
    },
    bounds: { ...asset.bounds },
  };
  geometryIdentity = await assetIdentity(asset, 'geometry');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness() {
  const board = structuredClone(fixture);
  const response = new Response(json);
  const text = vi.spyOn(response, 'text');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const preparation = {
    load: vi.fn<BoardPreparation['load']>().mockResolvedValue(board),
    generate: vi
      .fn<BoardPreparation['generate']>()
      .mockRejectedValue(new Error('Default startup must never generate a map')),
    dispose: vi.fn<BoardPreparation['dispose']>(),
  };
  const preparationFactory = vi.fn(() => preparation);
  const controller = new AbortController();
  return {
    board,
    response,
    text,
    fetcher,
    preparation,
    preparationFactory,
    controller,
    options: { fetcher, preparationFactory },
  };
}

// The fixture uses committed map bytes and real import/hash algorithms. Preparation
// handles are ownership doubles; these tests do not demonstrate real worker certification.
describe('static default board startup', () => {
  it('fetches only the exact static URL and forwards signal, bytes and summary without API/catalog/generation', async () => {
    const h = harness();
    const board = await loadDefaultBoard(h.controller.signal, h.options);

    expect(DEFAULT_MAP_URL).toBe(expectedUrl);
    expect(DEFAULT_MAP_IDENTITY).toBe(expectedIdentity);
    expect(DEFAULT_MAP_SUMMARY).toEqual(expectedSummary);
    expect(h.fetcher.mock.calls).toEqual([[expectedUrl, { signal: h.controller.signal }]]);
    expect(h.text).toHaveBeenCalledOnce();
    expect(h.preparationFactory).toHaveBeenCalledExactlyOnceWith();
    expect(h.preparation.load.mock.calls).toEqual([[json, expectedSummary, h.controller.signal]]);
    expect(h.preparation.load.mock.calls[0]![0]).toBe(json);
    expect(h.preparation.load.mock.calls[0]![1]).toBe(DEFAULT_MAP_SUMMARY);
    expect(h.preparation.generate).not.toHaveBeenCalled();
    expect(board).toBe(h.board);
    expect(board.assetIdentity).toBe(expectedIdentity);
    expect(board.assetIdentity).not.toBe(geometryIdentity);
    expect(board.summary).toEqual({ ...expectedSummary, name: 'Battlefield 17' });
    expect(board.summary.name).toBe(board.asset.name);
    expect(board.bounds).toEqual(expectedBounds);
    expect(board.asset.bounds).toEqual(expectedBounds);
    expect(board.canonicalJson).toBe(json);
    expect(structuredClone(board)).toEqual(board);
    expect(h.preparation.dispose).toHaveBeenCalledOnce();
  });

  it('rejects an initial abort before fetching or allocating preparation', async () => {
    const h = harness();
    h.controller.abort();
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow('cancelled');
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.text).not.toHaveBeenCalled();
    expect(h.preparationFactory).not.toHaveBeenCalled();
    expect(h.preparation.dispose).not.toHaveBeenCalled();
  });

  it('checks abort after fetch before reading response text or allocating preparation', async () => {
    const h = harness();
    h.fetcher.mockImplementationOnce(async () => {
      h.controller.abort();
      return h.response;
    });
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow('cancelled');
    expect(h.fetcher).toHaveBeenCalledExactlyOnceWith(expectedUrl, { signal: h.controller.signal });
    expect(h.text).not.toHaveBeenCalled();
    expect(h.preparationFactory).not.toHaveBeenCalled();
    expect(h.preparation.dispose).not.toHaveBeenCalled();
  });

  it('checks abort after response text before allocating preparation', async () => {
    const h = harness();
    h.text.mockImplementationOnce(async () => {
      h.controller.abort();
      return json;
    });
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow('cancelled');
    expect(h.text).toHaveBeenCalledOnce();
    expect(h.preparationFactory).not.toHaveBeenCalled();
    expect(h.preparation.dispose).not.toHaveBeenCalled();
  });

  it('disposes the handle returned after abort inside its factory without calling load', async () => {
    const h = harness();
    h.preparationFactory.mockImplementationOnce(() => {
      h.controller.abort();
      return h.preparation;
    });
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow('cancelled');
    expect(h.preparationFactory).toHaveBeenCalledOnce();
    expect(h.preparation.load).not.toHaveBeenCalled();
    expect(h.preparation.generate).not.toHaveBeenCalled();
    expect(h.preparation.dispose).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)(
    'rejects late preparation %s after abort and disposes the owned handle once',
    async (outcome) => {
      const h = harness();
      const started = deferred<void>();
      const completion = deferred<CertifiedBoard>();
      const failure = new Error('Late certification failure');
      h.preparation.load.mockImplementationOnce(() => {
        started.resolve();
        return completion.promise;
      });
      const pending = loadDefaultBoard(h.controller.signal, h.options);
      const rejection =
        outcome === 'resolve'
          ? expect(pending).rejects.toThrow('cancelled')
          : expect(pending).rejects.toBe(failure);
      await started.promise;
      h.controller.abort();
      if (outcome === 'resolve') completion.resolve(h.board);
      else completion.reject(failure);
      await rejection;
      expect(h.preparation.load).toHaveBeenCalledOnce();
      expect(h.preparation.generate).not.toHaveBeenCalled();
      expect(h.preparation.dispose).toHaveBeenCalledOnce();
    },
  );

  it.each([404, 503])(
    'rejects HTTP %s with an actionable error and allocates no preparation',
    async (status) => {
      const h = harness();
      const response = new Response('Unavailable default', { status });
      const text = vi.spyOn(response, 'text');
      h.fetcher.mockResolvedValueOnce(response);
      await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow(
        `Could not load the default map (${status}). Retry to load it again.`,
      );
      expect(text).not.toHaveBeenCalled();
      expect(h.preparationFactory).not.toHaveBeenCalled();
      expect(h.preparation.load).not.toHaveBeenCalled();
      expect(h.preparation.dispose).not.toHaveBeenCalled();
    },
  );

  it('propagates fetch failure and allocates no preparation', async () => {
    const h = harness();
    const failure = new TypeError('Static asset unavailable');
    h.fetcher.mockRejectedValueOnce(failure);
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toBe(failure);
    expect(h.text).not.toHaveBeenCalled();
    expect(h.preparationFactory).not.toHaveBeenCalled();
    expect(h.preparation.dispose).not.toHaveBeenCalled();
  });

  it('propagates response text failure and allocates no preparation', async () => {
    const h = harness();
    const failure = new Error('Default response body interrupted');
    h.text.mockRejectedValueOnce(failure);
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toBe(failure);
    expect(h.text).toHaveBeenCalledOnce();
    expect(h.preparationFactory).not.toHaveBeenCalled();
    expect(h.preparation.dispose).not.toHaveBeenCalled();
  });

  it('propagates certification rejection and disposes its preparation exactly once', async () => {
    const h = harness();
    const failure = new Error('Default map failed complete certification');
    h.preparation.load.mockRejectedValueOnce(failure);
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toBe(failure);
    expect(h.preparation.load).toHaveBeenCalledOnce();
    expect(h.preparation.generate).not.toHaveBeenCalled();
    expect(h.preparation.dispose).toHaveBeenCalledOnce();
  });

  const mismatches: Array<[string, (board: CertifiedBoard) => void]> = [
    [
      'geometry identity instead of full identity',
      (board) => {
        Object.assign(board, { assetIdentity: geometryIdentity });
      },
    ],
    [
      'different full identity',
      (board) => {
        Object.assign(board, { assetIdentity: '0'.repeat(64) });
      },
    ],
    [
      'missing saved reference',
      (board) => {
        Object.assign(board.summary, { ref: null });
      },
    ],
    [
      'generated reference',
      (board) => {
        Object.assign(board.summary, { ref: { kind: 'generated', id: 'countryside-rectangle' } });
      },
    ],
    [
      'different premade reference',
      (board) => {
        Object.assign(board.summary, { ref: { kind: 'premade', id: 'wooded-hills' } });
      },
    ],
    [
      'summary width',
      (board) => {
        Object.assign(board.summary, { widthM: 3000 });
      },
    ],
    [
      'summary height',
      (board) => {
        Object.assign(board.summary, { heightM: 5000 });
      },
    ],
    [
      'nonzero north-west x',
      (board) => {
        Object.assign(board.bounds, { minX: 1 });
      },
    ],
    [
      'nonzero north-west y',
      (board) => {
        Object.assign(board.bounds, { minY: 1 });
      },
    ],
    [
      'bounds width',
      (board) => {
        Object.assign(board.bounds, { maxX: 3000 });
      },
    ],
    [
      'bounds height',
      (board) => {
        Object.assign(board.bounds, { maxY: 5000 });
      },
    ],
  ];
  it.each(mismatches)('rejects %s and disposes once', async (_description, corrupt) => {
    const h = harness();
    // Deliberately corrupt a detached result double, never the committed JSON/fixture.
    corrupt(h.board);
    await expect(loadDefaultBoard(h.controller.signal, h.options)).rejects.toThrow(
      'The certified default map does not match the committed rectangle. Retry after restoring the development asset.',
    );
    expect(h.preparation.load).toHaveBeenCalledOnce();
    expect(h.preparation.generate).not.toHaveBeenCalled();
    expect(h.preparation.dispose).toHaveBeenCalledOnce();
  });
});
