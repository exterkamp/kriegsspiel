/**
 * Operational transform over plain text, for shared order drafts (D6c).
 *
 * An op is a list of components: a positive number keeps that many characters, a negative number
 * deletes that many, a string inserts. It covers the whole text it is made against. Two ops made on
 * the same text are brought together with `transform`, which gives each one as it must be applied
 * after the other so that both orders end on the same text.
 *
 * Pure and deterministic: no clock, no randomness.
 */
import type { AuthorRun, TextOp } from './drafts.js';

export type { TextOp };

/** Length of the text an op is made against. */
export function baseLength(op: TextOp): number {
  let n = 0;
  for (const c of op) if (typeof c === 'number') n += Math.abs(c);
  return n;
}

/** Length of the text an op produces. */
export function targetLength(op: TextOp): number {
  let n = 0;
  for (const c of op) n += typeof c === 'string' ? c.length : c > 0 ? c : 0;
  return n;
}

/** Merge neighbouring components of one kind and drop empty ones, so equal edits compare equal. */
export function normalize(op: TextOp): TextOp {
  const out: TextOp = [];
  // Inserts come before deletes at one spot so that "delete then insert" and "insert then delete" are one op.
  const push = (c: number | string) => {
    if (c === 0 || c === '') return;
    const last = out[out.length - 1];
    if (typeof c === 'string') {
      if (typeof last === 'string') out[out.length - 1] = last + c;
      else if (typeof last === 'number' && last < 0) {
        const before = out[out.length - 2];
        if (typeof before === 'string') out[out.length - 2] = before + c;
        else out.splice(out.length - 1, 0, c);
      } else out.push(c);
    } else if (typeof last === 'number' && last > 0 === c > 0) out[out.length - 1] = last + c;
    else out.push(c);
  };
  for (const c of op) push(c);
  // A trailing retain does nothing, but ops always cover the whole text, so it stays.
  return out;
}

/** Whether `op` is made against a text of `length` characters. */
export function fits(op: TextOp, length: number): boolean {
  return baseLength(op) === length;
}

/** Apply an op to a text. Throws when the op was made against a text of another length. */
export function apply(text: string, op: TextOp): string {
  if (!fits(op, text.length)) throw new Error('op does not fit the text');
  let at = 0;
  let out = '';
  for (const c of op) {
    if (typeof c === 'string') out += c;
    else if (c > 0) {
      out += text.slice(at, at + c);
      at += c;
    } else at -= c;
  }
  return out;
}

/** The op that changes nothing in a text of `length` characters. */
export function identity(length: number): TextOp {
  return length > 0 ? [length] : [];
}

/**
 * Bring two ops made on the same text together. Returns `[a2, b2]` where `a2` applies after `b` and
 * `b2` after `a`, and `apply(apply(t, a), b2) === apply(apply(t, b), a2)`. When both insert at one
 * spot, `a`'s text goes first.
 */
export function transform(a: TextOp, b: TextOp): [TextOp, TextOp] {
  if (baseLength(a) !== baseLength(b)) throw new Error('ops are made against different texts');
  const a2: TextOp = [];
  const b2: TextOp = [];
  let i = 0;
  let j = 0;
  let ca: number | string | undefined = a[i++];
  let cb: number | string | undefined = b[j++];
  while (ca !== undefined || cb !== undefined) {
    // Inserts first: a's before b's.
    if (typeof ca === 'string') {
      a2.push(ca);
      b2.push(ca.length);
      ca = a[i++];
      continue;
    }
    if (typeof cb === 'string') {
      a2.push(cb.length);
      b2.push(cb);
      cb = b[j++];
      continue;
    }
    if (ca === undefined || cb === undefined)
      throw new Error('ops are made against different texts');
    const na = Math.abs(ca);
    const nb = Math.abs(cb);
    const n = Math.min(na, nb);
    if (ca > 0 && cb > 0) {
      a2.push(n);
      b2.push(n);
    } else if (ca < 0 && cb > 0) {
      a2.push(-n);
    } else if (ca > 0 && cb < 0) {
      b2.push(-n);
    }
    // Both delete: the text is gone from both sides already.
    ca = na > n ? Math.sign(ca) * (na - n) : a[i++];
    cb = nb > n ? Math.sign(cb) * (nb - n) : b[j++];
  }
  return [normalize(a2), normalize(b2)];
}

/**
 * Move `op` past a run of ops that were applied one after another on the text `op` was made
 * against. Returns the moved op and the run as it reads after `op` (needed to carry a second op
 * through the same run). `op` goes second at a tie, so text already in the draft stays first.
 */
export function transformThrough(op: TextOp, run: readonly TextOp[]): [TextOp, TextOp[]] {
  let cur = op;
  const moved: TextOp[] = [];
  for (const r of run) {
    const [r2, cur2] = transform(r, cur);
    moved.push(r2);
    cur = cur2;
  }
  return [cur, moved];
}

/**
 * Move a point in the text across an op. `stick` says which way an insert exactly at the point
 * pushes it: `after` moves the point past the new text, `before` leaves it in front.
 */
export function transformIndex(index: number, op: TextOp, stick: 'before' | 'after'): number {
  let at = 0;
  let out = index;
  for (const c of op) {
    if (at > index) break;
    if (typeof c === 'string') {
      if (at < index || (at === index && stick === 'after')) out += c.length;
    } else if (c > 0) at += c;
    else {
      const del = Math.min(-c, Math.max(0, index - at));
      out -= del;
      at += -c;
    }
  }
  return out;
}

/** Move a commented range across an op: it grows to take text typed inside it and shrinks when text is deleted. */
export function transformRange(
  range: { from: number; to: number },
  op: TextOp,
): { from: number; to: number } {
  const from = transformIndex(range.from, op, 'after');
  const to = transformIndex(range.to, op, range.from === range.to ? 'after' : 'before');
  return { from, to: Math.max(from, to) };
}

/** An op that inserts `text` at `at` in a text of `length` characters. */
export function insertAt(length: number, at: number, text: string): TextOp {
  return normalize([at, text, length - at]);
}

/** An op that deletes `count` characters from `at` in a text of `length` characters. */
export function deleteAt(length: number, at: number, count: number): TextOp {
  return normalize([at, -count, length - at - count]);
}

/** Move author runs across an op: kept text keeps its author, inserted text is `author`'s, deleted text goes. */
export function reattribute(runs: readonly AuthorRun[], op: TextOp, author: string): AuthorRun[] {
  const out: AuthorRun[] = [];
  const add = (a: string, len: number) => {
    if (len <= 0) return;
    const last = out[out.length - 1];
    if (last && last.author === a) last.len += len;
    else out.push({ author: a, len });
  };
  const queue = runs.map((r) => ({ ...r }));
  let q = 0;
  for (const c of op) {
    if (typeof c === 'string') {
      add(author, c.length);
      continue;
    }
    let left = Math.abs(c);
    while (left > 0) {
      const run = queue[q];
      if (!run) throw new Error('author runs do not cover the text');
      const n = Math.min(left, run.len);
      if (c > 0) add(run.author, n);
      run.len -= n;
      left -= n;
      if (run.len === 0) q++;
    }
  }
  return out;
}

/**
 * The op that turns `before` into `after`: the common start and end are kept and the middle is
 * replaced. A cut is never made inside a surrogate pair. The editor uses it to turn what a player
 * typed into an edit without watching every keystroke.
 */
export function diff(before: string, after: string): TextOp {
  if (before === after) return identity(before.length);
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
  const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < max - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++;
  if (end > 0 && isLow(before.charCodeAt(before.length - end))) end--;
  const removed = before.length - start - end;
  const added = after.slice(start, after.length - end);
  return normalize([start, -removed, added, end]);
}
