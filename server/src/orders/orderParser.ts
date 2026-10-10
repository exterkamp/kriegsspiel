/**
 * The seam the LLM umpire plugs into. See docs/architecture.md (Umpire service, `parseOrders`).
 *
 * The server depends on this file only. Implementations (the rule-based stub, later the LLM
 * umpire) live next to it and are injected. A parser never mutates game state: it returns a
 * `ParseResult`, and the engine validates and applies any intents.
 */

export type Coord = { x: number; y: number };

/** Intents a parser can propose for one order. A subset of the architecture doc's `Intent`. */
export type OrderIntent =
  | { kind: 'move'; to: Coord }
  | { kind: 'hold'; at: Coord }
  | { kind: 'attack'; target: Coord }
  | { kind: 'withdraw'; toward: Coord };

/** What a parser may read about the world. `GameState` from the engine satisfies it. */
export interface ParseContext {
  /** The side that issued the order. Only its own units can be addressed. */
  side: string;
  map: { width: number; height: number; tiles: readonly string[] };
  units: readonly { id: string; side: string; name: string; position: Coord }[];
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
