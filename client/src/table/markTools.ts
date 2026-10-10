import { MAX_LINE_POINTS, type Coord, type Mark } from '@kriegsspiel/protocol';
import { pickMark, simplifyPath, translateMark } from './marks.js';

/** `view` leaves the pointer to the camera; `select` picks up, moves and selects existing marks. */
export type MarkTool = 'view' | 'select' | 'pin' | 'line' | 'arrow' | 'ring';

export interface GestureContext {
  /** Id for a new mark. */
  id: string;
  /** Game time now: new marks are stamped with it. */
  nowGame: number;
  label?: string;
  sourceReport?: string;
  marks: readonly Mark[];
  /** How close a pointer must be to a mark to grab it, in metres. */
  tolerance: number;
  /** Smallest drag that makes a mark, in metres. */
  minStep: number;
}

/**
 * One press-drag-release on the table with a mark tool. It holds no DOM or scene: feed it map
 * points in metres, show `draft()` while the pointer is down and send `finish()` when it lifts.
 */
export class Gesture {
  /** For `select`: the mark under the press, if any. */
  readonly grabbed: Mark | undefined;
  private readonly path: Coord[];
  private last: Coord;

  constructor(
    readonly tool: Exclude<MarkTool, 'view'>,
    private readonly start: Coord,
    private readonly ctx: GestureContext,
  ) {
    this.last = start;
    this.path = [start];
    this.grabbed = tool === 'select' ? pickMark(ctx.marks, start, ctx.tolerance) : undefined;
  }

  update(c: Coord): void {
    this.last = c;
    if (this.tool === 'line') this.path.push(c);
  }

  private moved(): number {
    return Math.hypot(this.last.x - this.start.x, this.last.y - this.start.y);
  }

  /** The mark as it would be if the pointer lifted now; undefined while it is too small to be one. */
  draft(): Mark | undefined {
    const { ctx } = this;
    const label = ctx.label?.trim();
    const common = {
      id: ctx.id,
      madeAtGame: ctx.nowGame,
      ...(label ? { label } : {}),
      ...(ctx.sourceReport ? { sourceReport: ctx.sourceReport } : {}),
    };
    switch (this.tool) {
      case 'select':
        return this.grabbed && this.moved() > 0
          ? translateMark(this.grabbed, this.last.x - this.start.x, this.last.y - this.start.y)
          : undefined;
      case 'pin':
        return { ...common, kind: 'pin', at: this.last };
      case 'arrow':
        return this.moved() >= ctx.minStep
          ? { ...common, kind: 'arrow', from: this.start, to: this.last }
          : undefined;
      case 'ring':
        return this.moved() >= ctx.minStep
          ? { ...common, kind: 'ring', at: this.start, radius: this.moved() }
          : undefined;
      case 'line': {
        let step = ctx.minStep / 4;
        // A decimetre is plenty on a table drawn in metres, and keeps each point short on the wire.
        const path = this.path.map(roundToDecimetre);
        let points = simplifyPath(path, step);
        while (points.length > MAX_LINE_POINTS) points = simplifyPath(path, (step *= 2));
        return points.length >= 2 &&
          this.moved() + pathLength(points) > 0 &&
          pathLength(points) >= ctx.minStep
          ? { ...common, kind: 'line', points }
          : undefined;
      }
    }
  }

  /** The mark to store when the pointer lifts at `c`, or undefined if the gesture made nothing. */
  finish(c: Coord): Mark | undefined {
    this.update(c);
    return this.draft();
  }
}

function roundToDecimetre(c: Coord): Coord {
  return { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 };
}

function pathLength(points: readonly Coord[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++)
    n += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return n;
}
