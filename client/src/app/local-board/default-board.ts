import { createBoardPreparation } from '../../shared/game-setup/preparation.js';
import type {
  BoardPreparation,
  CertifiedBoard,
  MapSummary,
} from '../../shared/game-setup/contracts.js';

export const DEFAULT_MAP_IDENTITY =
  '26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84';
export const DEFAULT_MAP_URL = '/__local-default/countryside-rectangle.json';
export const DEFAULT_MAP_SUMMARY: MapSummary = Object.freeze({
  ref: Object.freeze({ kind: 'premade' as const, id: 'countryside-rectangle' }),
  name: 'Countryside — 5 × 3 km',
  widthM: 5000,
  heightM: 3000,
});

/** Static development asset + current complete certification; no catalog/API or resume pointer. */
export async function loadDefaultBoard(
  signal: AbortSignal,
  options: { fetcher?: typeof fetch; preparationFactory?: () => BoardPreparation } = {},
): Promise<CertifiedBoard> {
  const current = () => {
    if (signal.aborted) throw new Error('Default map preparation cancelled');
  };
  current();
  const response = await (options.fetcher ?? fetch)(DEFAULT_MAP_URL, { signal });
  current();
  if (!response.ok)
    throw new Error(`Could not load the default map (${response.status}). Retry to load it again.`);
  const json = await response.text();
  current();
  const preparation = (options.preparationFactory ?? createBoardPreparation)();
  try {
    current();
    const board = await preparation.load(json, DEFAULT_MAP_SUMMARY, signal);
    current();
    if (
      board.assetIdentity !== DEFAULT_MAP_IDENTITY ||
      board.summary.ref?.kind !== 'premade' ||
      board.summary.ref.id !== DEFAULT_MAP_SUMMARY.ref.id ||
      board.summary.widthM !== 5000 ||
      board.summary.heightM !== 3000 ||
      board.bounds.minX !== 0 ||
      board.bounds.minY !== 0 ||
      board.bounds.maxX !== 5000 ||
      board.bounds.maxY !== 3000
    )
      throw new Error(
        'The certified default map does not match the committed rectangle. Retry after restoring the development asset.',
      );
    return board;
  } finally {
    preparation.dispose();
  }
}
