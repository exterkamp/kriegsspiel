import type { MapCatalog, MapRef, MapSummary } from './contracts.js';

/** HTTP transport only; the preparation worker certifies every chosen map. */
export function createMapCatalog(fetcher: typeof fetch = fetch): MapCatalog {
  const endpoint = '/__local/maps';
  async function request(url: string, init: RequestInit): Promise<Response> {
    const response = await fetcher(url, init);
    if (!response.ok) {
      let message = `Local map request failed (${response.status})`;
      try {
        const data: unknown = await response.json();
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string')
          message = data.error;
      } catch {
        /* A non-JSON server error still has an actionable status. */
      }
      throw new Error(message);
    }
    return response;
  }
  return {
    async list(signal) {
      return (await request(endpoint, { signal })).json() as Promise<MapSummary[]>;
    },
    async read(ref: MapRef, signal) {
      if (
        !['premade', 'generated'].includes(ref.kind) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(ref.id)
      )
        throw new Error('Invalid map reference');
      return (
        await request(`${endpoint}/${ref.kind}/${encodeURIComponent(ref.id)}`, { signal })
      ).text();
    },
    async save(canonicalJson, signal) {
      return (
        await request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: canonicalJson,
          signal,
        })
      ).json() as Promise<MapSummary>;
    },
  };
}
