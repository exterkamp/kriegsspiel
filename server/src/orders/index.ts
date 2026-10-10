// Only the interface is exported here. Server code depends on this, never on a concrete parser;
// the composition root imports `./stubParser.js` directly.
export type {
  Coord,
  OrderIntent,
  OrderParser,
  ParseContext,
  ParseFeature,
  ParseResult,
} from './orderParser.js';
