/**
 * The seam the LLM umpire plugs into. See docs/architecture.md (Umpire service, `parseOrders`).
 *
 * The server depends on this file only. Implementations (the rule-based stub, later the LLM
 * umpire) live next to it and are injected. A parser never mutates game state: it returns a
 * `ParseResult`, and the engine validates and applies any intents.
 */

/** A point on the continuous map plane, as in the engine's master state: integer millimetres. */
export type Coord = { x: number; y: number };

/** Intents a parser can propose for one order. A subset of the architecture doc's `Intent`. */
export type OrderIntent =
  | { kind: 'move'; to: Coord }
  | { kind: 'hold'; at: Coord }
  | { kind: 'attack'; target: Coord }
  | { kind: 'withdraw'; toward: Coord };

/**
 * A named place a parser may send units to: a terrain feature reduced to one representative
 * point. Build it from the engine's `GameState.map.features` with `featureAnchor`; the
 * parser does no geometry of its own.
 */
export interface ParseFeature {
  id: string;
  /** Engine feature kind, for example `bridge`, `wood` or `road`. */
  kind: string;
  name?: string;
  anchor: Coord;
}

/** What a parser may read about the world. */
export interface ParseContext {
  /** The side that issued the order. Only its own units can be addressed. */
  side: string;
  map: { features: readonly ParseFeature[] };
  /** `center` is the middle of the unit's footprint, as in the engine's `Unit`. */
  units: readonly { id: string; side: string; name: string; center: Coord }[];
  /** Names the issuing side must not read in a reply (`hiddenTerms`), such as the enemy's commanders. */
  hidden?: readonly string[];
}

interface ParseResultBase {
  /** The original wording, exactly as given. Always preserved. */
  text: string;
}

export type ParseResult =
  /** The order was understood: `unitId` should carry out `intents` in sequence. */
  | (ParseResultBase & { kind: 'intents'; unitId: string; intents: OrderIntent[] })
  /** The order is plausible but underspecified; ask the player. */
  | (ParseResultBase & { kind: 'clarification'; question: string; options?: string[] })
  /** The order cannot be carried out or understood. */
  | (ParseResultBase & { kind: 'rejection'; reason: string });

/** Async from day one: the LLM implementation is slow. */
export interface OrderParser {
  parse(orderText: string, context: ParseContext): Promise<ParseResult>;
}
