import type { OrderParser } from '../orders/index.js';
import { LlmOrderParser } from '../orders/llmParser.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { InterpretingParser } from '../orders/interpret.js';
import type { TraceSink } from '../debug/trace.js';
import type { UmpireClient } from './index.js';

/**
 * One umpire client per game, made on first use and dropped when the game ends or is closed.
 * A finished game reloaded after a restart gets a fresh client that nothing evicts until it is
 * closed, so the leak is bounded to finished games per process, not unbounded.
 */
export class GameClients<C extends UmpireClient> {
  private readonly clients = new Map<string, C>();

  constructor(private readonly make: (gameId: string) => C) {}

  get(gameId: string): C {
    let client = this.clients.get(gameId);
    if (!client) {
      client = this.make(gameId);
      this.clients.set(gameId, client);
    }
    return client;
  }

  /** The game's client if one was made; never makes one. */
  peek(gameId: string): C | undefined {
    return this.clients.get(gameId);
  }

  /** Forget a game's client. Safe to call twice or for a game that never had one. */
  evict(gameId: string): void {
    this.clients.delete(gameId);
  }
}

export interface ParserWiringOptions {
  /** The LLM parses orders; false keeps the rule-based parser. */
  llm: boolean;
  clientFor: (gameId: string) => UmpireClient;
  /**
   * Retried before the stub when the model cannot place an order (set with a local model on `parse`).
   * A function makes one per game, so its calls can be traced under the game.
   */
  cannedParser?: OrderParser | ((gameId: string) => OrderParser);
  onFallback?: (gameId: string, reason: string) => void;
  /** Records each fallback as an `order` trace entry, for the admin Orders panel (#395). */
  trace?: TraceSink;
}

/**
 * What an `order` trace entry carries: one step of the order pipeline that did not take the model's answer.
 * `answeredBy` is who answered instead: `fallback` (the canned parser or the stub), `none` (the player is
 * asked to restate) or `as-written` (the order runs as parsed, without the subordinate's reading).
 */
export interface OrderTraceNote {
  step: 'parse' | 'interpret';
  /** The order as written, so a note is matched to its order when several share a correlation id. */
  text: string;
  reason: string;
  answeredBy: 'fallback' | 'none' | 'as-written';
}

/** The `parser` option for the app: flag -> per-game LLM parser with fallback, or the stub. */
export function orderParserFor(
  o: ParserWiringOptions,
): OrderParser | ((gameId: string) => OrderParser) {
  if (!o.llm) return new StubOrderParser();
  const note = (gameId: string, n: OrderTraceNote) => {
    if (o.trace?.enabled) o.trace.record(gameId, 'order', n);
  };
  return (gameId) => {
    const client = o.clientFor(gameId);
    const canned = typeof o.cannedParser === 'function' ? o.cannedParser(gameId) : o.cannedParser;
    return new InterpretingParser(
      new LlmOrderParser(client, {
        fallbackParser: canned ?? new StubOrderParser(),
        onFallback: (f) => {
          note(gameId, {
            step: 'parse',
            text: f.orderText,
            reason: f.reason,
            answeredBy: f.answeredBy,
          });
          o.onFallback?.(gameId, f.reason);
        },
      }),
      client,
      {
        onFallback: (reason, text) => {
          note(gameId, {
            step: 'interpret',
            text,
            reason: reason.replace(/^interpret: /, ''),
            answeredBy: 'as-written',
          });
          o.onFallback?.(gameId, reason);
        },
      },
    );
  };
}
