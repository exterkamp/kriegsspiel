export type MapRef = { readonly kind: 'premade' | 'generated'; readonly id: string };

export interface MapSummary {
  readonly ref: MapRef;
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
}
