/**
 * Cartographic style definitions for `MapRenderer` (#491).
 *
 * Every colour, stroke width, dash, symbol size and label font the renderer uses lives here, so another
 * surface can adopt a style by passing it to `new MapRenderer(asset, style)`. The authoring preview draws the
 * period style; the table raster (`shared/map-table/raster.ts`) and the live game's table
 * (`legacy/table/periodMap.ts`) draw it as `TABLE_MAP_STYLE` (#498).
 * Pixel sizes are CSS pixels at the current zoom; metre sizes come from the map asset itself.
 *
 * - `PERIOD_MAP_STYLE`: a 19th-century staff map (Prussian Generalstab / Ordnance Survey sheets of the
 *   1860s-70s): paper ground, sepia hachures and shading, lined water, tree-symbol woods, ochre settlements
 *   with hatched buildings, roads cased by class, bridge and ford symbols and serif lettering.
 * - `CLASSIC_MAP_STYLE`: the earlier flat look, still `MapRenderer`'s default; no surface draws it now.
 */

export type RoadClass = 'regional' | 'street' | 'track';

export interface MapPalette {
  /** Canvas outside the map sheet. */
  readonly margin: string;
  readonly paper: string;
  readonly field: string;
  readonly open: string;
  readonly wood: string;
  /** Wood boundary line (period) and cover outline in high contrast (classic). */
  readonly woodEdge: string;
  readonly woodSymbol: string;
  /** Hachures and relief tint. */
  readonly relief: string;
  readonly contour: string;
  readonly water: string;
  /** Water lining parallel to the shore. */
  readonly waterLine: string;
  readonly shore: string;
  readonly roadCasing: Readonly<Record<RoadClass, string>>;
  /** Road fill between the casings, or the whole line of an uncased road. */
  readonly road: Readonly<Record<RoadClass, string>>;
  readonly bridge: string;
  readonly ford: string;
  /** Bridge parapets, ford marks and crossing outlines. */
  readonly parapet: string;
  /** Wash over a settlement's built-up area. */
  readonly settlement: string;
  readonly building: string;
  readonly buildingHatch: string;
  readonly buildingEdge: string;
  readonly ink: string;
  /** Label halo or label box. */
  readonly halo: string;
}

export interface RoadStroke {
  /** Smallest drawn outer width; the metre surface width wins when it is wider on screen. */
  readonly minWidthPx: number;
  /** Casing line on each side, capped at `casingFraction` of the width. */
  readonly casingPx: number;
  readonly casingFraction: number;
  /** Dash pattern of the casing, in pixels; a dashed road narrower than its casings is one broken line. */
  readonly dashPx?: readonly number[];
}

export interface HachureStyle {
  /** Distance between hachure seeds at the zoom band's nominal scale. */
  readonly spacingPx: number;
  /** Stroke length as a fraction of the spacing, capped by `maxLengthPx`. */
  readonly length: number;
  readonly maxLengthPx: number;
  /** Seeds never get closer than this on the ground, so close zooms do not draw a fur of strokes. */
  readonly minSpacingM: number;
  /** Ground slope (rise over run) below which no hachure is drawn. */
  readonly minSlope: number;
  /** Ground slope drawn at full weight (Lehmann: darker and heavier as the slope steepens). */
  readonly fullSlope: number;
  readonly widthPx: readonly [gentle: number, steep: number];
  readonly alpha: readonly [gentle: number, steep: number];
  /** Share of seeds drawn on the gentlest slope; all are drawn from `fullSlope / 2` up. */
  readonly gentleDensity: number;
  /** Fade hachures out between these scales (px per metre); a village plan carries none. */
  readonly fadeScale: readonly [start: number, end: number];
  /** High contrast keeps relief quieter than the features drawn over it. */
  readonly contrastAlpha: number;
}

export interface LabelFonts {
  readonly village: string;
  readonly farm: string;
  readonly landmark: string;
}

export interface MapStyle {
  readonly name: 'period' | 'classic';
  readonly palette: { readonly regular: MapPalette; readonly contrast: MapPalette };
  readonly relief: {
    /** Multiply shading. `neutralFlat` leaves level ground untouched and darkens only shadowed slopes. */
    readonly shade: {
      readonly alpha: number;
      readonly contrastAlpha: number;
      readonly shadow: readonly [number, number, number];
      readonly neutralFlat: boolean;
    };
    readonly hachures: HachureStyle | null;
    readonly contours: {
      readonly indexPx: number;
      readonly regularPx: number;
      /** Regular (non-index) contours appear only from this scale; index contours always. */
      readonly regularFromScale: number;
      readonly alpha: number;
    };
  };
  readonly cover: {
    readonly trees: { readonly tilePx: number; readonly radiusPx: number } | null;
    readonly woodEdgePx: number;
  };
  readonly water: {
    /** Lines inside the water, each at this distance from the shore. */
    readonly liningPx: readonly number[];
    readonly liningWidthPx: number;
    readonly shorePx: number;
    /** A river narrower than this on screen is drawn along its centreline at this width. */
    readonly minRiverPx: number;
  };
  readonly roads: {
    readonly stroke: Readonly<Record<RoadClass, RoadStroke>>;
    /** Draw every casing before any fill so joined segments read as one road. */
    readonly casingsFirst: boolean;
  };
  readonly crossings: {
    /** 'deck' fills the deck polygon; 'symbol' adds parapets with splayed wings (bridge) or dashes (ford). */
    readonly mode: 'deck' | 'symbol';
    readonly minSpanPx: number;
    readonly minWidthPx: number;
    readonly wingPx: number;
  };
  readonly buildings: {
    readonly hatch: {
      readonly spacingPx: number;
      readonly widthPx: number;
      readonly fromScale: number;
    } | null;
    readonly edgePx: number;
    /** Alpha of the wash over a settlement's built-up area; 0 draws none. */
    readonly settlementAlpha: number;
  };
  readonly labels: {
    readonly fonts: LabelFonts;
    /** Font sizes matching `fonts`, for label collision boxes. */
    readonly sizePx: Readonly<Record<keyof LabelFonts, number>>;
    readonly letterSpacingPx: number;
    /** 'box' fills a paper rectangle behind the name; 'halo' strokes a paper outline round the letters. */
    readonly backing: 'box' | 'halo';
    readonly haloPx: number;
    readonly contrastHaloPx: number;
    /** Landmark names appear from this scale. */
    readonly landmarksFromScale: number;
  };
  readonly scaleBar: {
    readonly mode: 'plain' | 'segmented';
    readonly font: string;
  };
  /** Double frame round the sheet. */
  readonly neatLine: {
    readonly innerPx: number;
    readonly outerPx: number;
    readonly gapPx: number;
  } | null;
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = 'system-ui';

/** The period staff-map style the authoring preview and the table raster draw. */
export const PERIOD_MAP_STYLE: MapStyle = Object.freeze({
  name: 'period',
  palette: {
    regular: {
      margin: '#d8d0bb',
      paper: '#f3ecd8',
      field: '#ece2c3',
      open: '#f3ecd8',
      wood: '#dfe1c6',
      woodEdge: '#6f7a52',
      woodSymbol: '#58663e',
      relief: '#6b4a2b',
      contour: '#8a6844',
      water: '#b4cfd6',
      waterLine: '#4f8299',
      shore: '#2f5e74',
      roadCasing: { regional: '#33291f', street: '#33291f', track: '#6a5238' },
      road: { regional: '#dcae6c', street: '#faf5e4', track: '#f3ecd8' },
      bridge: '#faf5e4',
      ford: '#d6e5e8',
      parapet: '#1f1a14',
      settlement: '#e2c084',
      building: '#b9824f',
      buildingHatch: '#4a2f1d',
      buildingEdge: '#3a2416',
      ink: '#2a2118',
      halo: '#f3ecd8',
    },
    contrast: {
      margin: '#dedede',
      paper: '#ffffff',
      field: '#f1f1f1',
      open: '#ffffff',
      wood: '#d3dcc9',
      woodEdge: '#1d3a12',
      woodSymbol: '#1d3a12',
      relief: '#5a4632',
      contour: '#5a4632',
      water: '#80bddc',
      waterLine: '#0b4f7a',
      shore: '#002f4f',
      roadCasing: { regional: '#000000', street: '#000000', track: '#000000' },
      road: { regional: '#ffcc66', street: '#ffffff', track: '#ffffff' },
      bridge: '#ffdd70',
      ford: '#ffdd70',
      parapet: '#000000',
      settlement: '#f0d9a8',
      building: '#000000',
      buildingHatch: '#000000',
      buildingEdge: '#000000',
      ink: '#000000',
      halo: '#ffffff',
    },
  },
  relief: {
    shade: { alpha: 0.5, contrastAlpha: 0.25, shadow: [118, 88, 56], neutralFlat: true },
    hachures: {
      spacingPx: 4.5,
      length: 1.2,
      maxLengthPx: 9,
      minSpacingM: 3,
      minSlope: 0.03,
      fullSlope: 0.2,
      widthPx: [0.35, 1.7],
      alpha: [0.3, 0.9],
      gentleDensity: 0.25,
      fadeScale: [1.5, 3],
      contrastAlpha: 0.45,
    },
    contours: { indexPx: 0.7, regularPx: 0.45, regularFromScale: 0.6, alpha: 0.7 },
  },
  cover: { trees: { tilePx: 16, radiusPx: 1.9 }, woodEdgePx: 0.8 },
  water: { liningPx: [2.2, 4.6, 7.4], liningWidthPx: 0.6, shorePx: 1.1, minRiverPx: 1.6 },
  roads: {
    stroke: {
      regional: { minWidthPx: 4.2, casingPx: 0.9, casingFraction: 0.3 },
      street: { minWidthPx: 3, casingPx: 0.8, casingFraction: 0.3 },
      // A cart track: a broken double line, or a single broken line when too narrow to case.
      track: { minWidthPx: 1.2, casingPx: 0.7, casingFraction: 0.35, dashPx: [4, 2.5] },
    },
    casingsFirst: true,
  },
  crossings: { mode: 'symbol', minSpanPx: 9, minWidthPx: 5, wingPx: 3 },
  buildings: {
    hatch: { spacingPx: 3, widthPx: 0.8, fromScale: 0.8 },
    edgePx: 0.8,
    settlementAlpha: 0.55,
  },
  labels: {
    fonts: {
      village: `600 15px ${SERIF}`,
      farm: `italic 12px ${SERIF}`,
      landmark: `italic 12px ${SERIF}`,
    },
    sizePx: { village: 15, farm: 12, landmark: 12 },
    letterSpacingPx: 1,
    backing: 'halo',
    haloPx: 3.5,
    contrastHaloPx: 5,
    landmarksFromScale: 0.15,
  },
  scaleBar: { mode: 'segmented', font: `12px ${SERIF}` },
  neatLine: { innerPx: 1, outerPx: 2.5, gapPx: 5 },
} satisfies MapStyle);

/**
 * The table's paper: the period style without the neat line (#498). A table raster is exactly the map
 * sheet, so the frame the preview draws round the sheet would be cut in half at the edge of the paper, and
 * the table's board frames the sheet instead. The saved-map raster and the live game's table both draw it.
 */
export const TABLE_MAP_STYLE: MapStyle = Object.freeze({ ...PERIOD_MAP_STYLE, neatLine: null });

/** The earlier flat style, unchanged; `MapRenderer`'s default, which the table raster drew until #498. */
export const CLASSIC_MAP_STYLE: MapStyle = Object.freeze({
  name: 'classic',
  palette: {
    regular: {
      margin: '#d5d4cc',
      paper: '#efe9d9',
      field: '#dbcc9c',
      open: '#e4ddc6',
      wood: '#a4b58e',
      woodEdge: '#77644b',
      woodSymbol: '#77644b',
      relief: '#8e8068',
      contour: '#8e8068',
      water: '#88b6c3',
      waterLine: '#77644b',
      shore: '#77644b',
      roadCasing: { regional: '#77644b', street: '#77644b', track: '#77644b' },
      road: { regional: '#faf4e2', street: '#faf4e2', track: '#faf4e2' },
      bridge: '#c5aa7e',
      ford: '#88b6c3',
      parapet: '#77644b',
      settlement: '#61584b',
      building: '#61584b',
      buildingHatch: '#61584b',
      buildingEdge: '#77644b',
      ink: '#302e26',
      halo: '#efe9d9',
    },
    contrast: {
      margin: '#dedede',
      paper: '#ffffff',
      field: '#e8e8e8',
      open: '#ffffff',
      wood: '#c2c8bd',
      woodEdge: '#000000',
      woodSymbol: '#000000',
      relief: '#666666',
      contour: '#666666',
      water: '#80bddc',
      waterLine: '#000000',
      shore: '#000000',
      roadCasing: { regional: '#000000', street: '#000000', track: '#000000' },
      road: { regional: '#ffffff', street: '#ffffff', track: '#ffffff' },
      bridge: '#ffdd70',
      ford: '#ffdd70',
      parapet: '#000000',
      settlement: '#000000',
      building: '#000000',
      buildingHatch: '#000000',
      buildingEdge: '#000000',
      ink: '#000000',
      halo: '#ffffff',
    },
  },
  relief: {
    shade: { alpha: 0.28, contrastAlpha: 0.14, shadow: [100, 100, 100], neutralFlat: false },
    hachures: null,
    contours: { indexPx: 1.4, regularPx: 0.6, regularFromScale: 0, alpha: 1 },
  },
  cover: { trees: null, woodEdgePx: 1 },
  water: { liningPx: [], liningWidthPx: 0, shorePx: 1, minRiverPx: 0 },
  roads: {
    stroke: {
      regional: { minWidthPx: 0, casingPx: 0.5, casingFraction: 0.15 },
      street: { minWidthPx: 0, casingPx: 0.5, casingFraction: 0.15 },
      track: { minWidthPx: 0, casingPx: 0.5, casingFraction: 0.15 },
    },
    casingsFirst: false,
  },
  crossings: { mode: 'deck', minSpanPx: 0, minWidthPx: 0, wingPx: 0 },
  buildings: { hatch: null, edgePx: 0, settlementAlpha: 0 },
  labels: {
    fonts: {
      village: `600 13px ${SANS}`,
      farm: `600 13px ${SANS}`,
      landmark: `600 13px ${SANS}`,
    },
    sizePx: { village: 13, farm: 13, landmark: 13 },
    letterSpacingPx: 0,
    backing: 'box',
    haloPx: 0,
    contrastHaloPx: 0,
    landmarksFromScale: 0.15,
  },
  scaleBar: { mode: 'plain', font: `12px ${SANS}` },
  neatLine: null,
} satisfies MapStyle);
