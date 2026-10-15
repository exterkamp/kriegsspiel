/** Library geography is never scenario approval. Native playable pairings use the protocol catalog. */
export interface LibraryMapSummary {
  readonly ref: { readonly kind: 'included' | 'owned'; readonly id: string };
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly assetIdentity: string;
  readonly status: 'needs-scenario';
  readonly createdAtMs?: number;
}
export interface MapLibraryPort {
  list(
    source: 'included' | 'owned',
    signal: AbortSignal,
    cursor?: string,
  ): Promise<{ readonly items: readonly LibraryMapSummary[]; readonly nextCursor?: string }>;
  read(
    ref: LibraryMapSummary['ref'],
    signal: AbortSignal,
  ): Promise<{ readonly item: LibraryMapSummary; readonly canonicalJson: string }>;
  save(
    value: {
      readonly requestId: string;
      readonly name: string;
      readonly canonicalJson: string;
      readonly assetIdentity: string;
    },
    signal: AbortSignal,
  ): Promise<LibraryMapSummary>;
}
