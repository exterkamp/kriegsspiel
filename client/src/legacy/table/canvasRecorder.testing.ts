/**
 * Test-only Canvas2D recorder for the table's map paper (#498): every fill and stroke is kept with the
 * paint state it was made in and the path it painted, in the context's own units (metres once the map
 * transform is applied). Imported by `*.test.ts` only.
 */
export type PathOp = ['M' | 'L', number, number] | ['Z'];

export class RecordedPath {
  readonly ops: PathOp[] = [];
  moveTo(x: number, y: number): void {
    this.ops.push(['M', x, y]);
  }
  lineTo(x: number, y: number): void {
    this.ops.push(['L', x, y]);
  }
  closePath(): void {
    this.ops.push(['Z']);
  }
  addPath(other: RecordedPath): void {
    this.ops.push(...other.ops);
  }
}

export interface Paint {
  readonly op: 'fill' | 'stroke';
  readonly style: unknown;
  readonly width: number;
  readonly alpha: number;
  readonly dash: readonly number[];
  readonly path: readonly PathOp[];
}

export function recordCanvas() {
  const paints: Paint[] = [];
  const calls: string[] = [];
  let current = new RecordedPath();
  let dash: number[] = [];
  const state: Record<string | symbol, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
  };
  const paint = (op: Paint['op'], path: unknown) =>
    paints.push({
      op,
      style: op === 'fill' ? state['fillStyle'] : state['strokeStyle'],
      width: state['lineWidth'] as number,
      alpha: state['globalAlpha'] as number,
      dash: [...dash],
      path: [...(path instanceof RecordedPath ? path : current).ops],
    });
  const methods: Record<string, (...args: never[]) => unknown> = {
    beginPath: () => (current = new RecordedPath()),
    moveTo: (x: number, y: number) => current.moveTo(x, y),
    lineTo: (x: number, y: number) => current.lineTo(x, y),
    closePath: () => current.closePath(),
    rect: (x: number, y: number, w: number, h: number) => {
      current.moveTo(x, y);
      current.lineTo(x + w, y);
      current.lineTo(x + w, y + h);
      current.lineTo(x, y + h);
      current.closePath();
    },
    setLineDash: (d: number[]) => (dash = [...d]),
    fill: (path?: unknown) => paint('fill', path),
    stroke: (path?: unknown) => paint('stroke', path),
    createPattern: () => ({ setTransform() {} }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      const name = String(key);
      return (...args: never[]) => {
        calls.push(name);
        return methods[name]?.(...args);
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  /** Paints in a colour, in order. */
  const painted = (op: Paint['op'], style: unknown) =>
    paints.filter((p) => p.op === op && p.style === style);
  return { ctx, paints, calls, painted };
}
