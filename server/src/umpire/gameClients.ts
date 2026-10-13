import type { OrderParser } from '../orders/index.js';
import { LlmOrderParser } from '../orders/llmParser.js';
import { StubOrderParser } from '../orders/stubParser.js';
import { InterpretingParser } from '../orders/interpret.js';
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
   * Set with a local model (keyless Ollama mode): retried before the stub when the model cannot place
   * an order, and the check a model's intents must agree with (unit and places) before they stand (#389).
   */
  cannedParser?: OrderParser;
  onFallback?: (gameId: string, reason: string) => void;
}

/** The `parser` option for the app: flag -> per-game LLM parser with fallback, or the stub. */
export function orderParserFor(
  o: ParserWiringOptions,
): OrderParser | ((gameId: string) => OrderParser) {
  if (!o.llm) return new StubOrderParser();
  return (gameId) => {
    const client = o.clientFor(gameId);
    return new InterpretingParser(
      new LlmOrderParser(client, {
        fallbackParser: o.cannedParser ?? new StubOrderParser(),
        ...(o.cannedParser ? { groundingParser: o.cannedParser } : {}),
        onFallback: (f) => o.onFallback?.(gameId, f.reason),
      }),
      client,
      { onFallback: (reason) => o.onFallback?.(gameId, reason) },
    );
  };
}
