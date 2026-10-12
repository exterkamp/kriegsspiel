import { expect, expectTypeOf, it, vi } from 'vitest';
import { createMapCatalog } from './catalog.js';
import type { MapRef, MapSummary } from './contracts.js';
import type {
  MapRef as NodeMapRef,
  MapSummary as NodeMapSummary,
} from '../../../../tools/local-map-catalog/types.js';

const summary = {
  ref: { kind: 'generated', id: 'saved' },
  name: 'Board',
  widthM: 5000,
  heightM: 3000,
} as const;

it('matches the Node sidecar DTO types and serialized catalog fields', async () => {
  expectTypeOf<MapRef>().toEqualTypeOf<NodeMapRef>();
  expectTypeOf<MapSummary>().toEqualTypeOf<NodeMapSummary>();
  const nodeSummary: NodeMapSummary = summary;
  const browserSummary: MapSummary = nodeSummary;
  const catalog = createMapCatalog(
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([nodeSummary]))),
  );
  expect(await catalog.list(new AbortController().signal)).toEqual([browserSummary]);
  expect(Object.keys(browserSummary).sort()).toEqual(['heightM', 'name', 'ref', 'widthM']);
});

it('transports list/read/save with signal and exact saved body', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify([summary])))
    .mockResolvedValueOnce(new Response('{"canonical":"bytes"}'))
    .mockResolvedValueOnce(new Response(JSON.stringify(summary), { status: 201 }));
  const catalog = createMapCatalog(fetcher);
  const signal = new AbortController().signal;
  expect(await catalog.list(signal)).toEqual([summary]);
  expect(await catalog.read(summary.ref, signal)).toBe('{"canonical":"bytes"}');
  expect(await catalog.save('{"canonical":"bytes"}', signal)).toEqual(summary);
  expect(fetcher.mock.calls).toEqual([
    ['/__local/maps', { signal }],
    ['/__local/maps/generated/saved', { signal }],
    [
      '/__local/maps',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"canonical":"bytes"}',
        signal,
      },
    ],
  ]);
});

it('rejects server errors with their actionable message and falls back for non-JSON errors', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Directory is unavailable' }), { status: 500 }),
    )
    .mockResolvedValueOnce(new Response('Not found', { status: 404 }));
  const catalog = createMapCatalog(fetcher);
  const signal = new AbortController().signal;
  await expect(catalog.list(signal)).rejects.toThrow('Directory is unavailable');
  await expect(catalog.read(summary.ref, signal)).rejects.toThrow('Local map request failed (404)');
});

it('propagates abort and network failures and rejects path-shaped IDs before a request', async () => {
  const error = new DOMException('Cancelled', 'AbortError');
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
  const catalog = createMapCatalog(fetcher);
  const signal = new AbortController().signal;
  await expect(catalog.save('{}', signal)).rejects.toBe(error);
  for (const id of ['../x', '/tmp/x', 'a/b', 'a\\b', '', 'a'.repeat(97), 'a%2fb', '-a'])
    await expect(catalog.read({ kind: 'generated', id }, signal)).rejects.toThrow(
      'Invalid map reference',
    );
  await expect(
    catalog.read({ kind: 'other' as MapRef['kind'], id: 'safe' }, signal),
  ).rejects.toThrow('Invalid map reference');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
