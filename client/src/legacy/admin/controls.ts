/**
 * Clock control bar for the admin page (story 8.8, #128): pause, resume, step and rate for the selected game.
 * It POSTs to `/admin/api/games/:id/clock`, which applies the change as an admin-marked input.
 */
import { apiUrl, formatGameMs } from './model.js';
import type { AdminState } from './state.js';

export type ClockAction =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'rate'; rate: number }
  | { action: 'step'; ms: number }
  | { action: 'stepToNext' };

const RATES = [1, 4, 12];
export const MAX_RATE = 1000;

/** A custom rate typed into the box: a positive number up to the server's cap, else undefined. */
export function parseRate(text: string): number | undefined {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(n) && n > 0 && n <= MAX_RATE ? n : undefined;
}

/** One line for the live clock state, from the admin state snapshot. */
export function clockSummary(s: AdminState | undefined): string {
  if (!s?.clock) return 'no clock';
  const c = s.control;
  const status = s.clock.status ?? '?';
  const mode = c?.mode && c.mode !== 'realtime' ? `, ${c.mode}` : '';
  const barrier =
    c?.barrierMs !== undefined ? `, held for the umpire at ${formatGameMs(c.barrierMs)}` : '';
  return `${status} ×${s.clock.rate ?? '?'}${mode} · game ${formatGameMs(c?.gameMs ?? s.engine.time)}${barrier}`;
}

export class ControlBar {
  private gameId: string | undefined;
  private readonly summary: HTMLElement;
  private readonly message: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly rateInput: HTMLInputElement;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly token: () => string | undefined,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly after: () => void = () => undefined,
  ) {
    root.className = 'controls ks-cluster';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Clock controls');
    this.summary = document.createElement('span');
    this.summary.className = 'controls-state';
    this.summary.setAttribute('role', 'status');
    this.message = document.createElement('small');
    this.message.className = 'controls-msg';
    this.rateInput = document.createElement('input');
    this.rateInput.type = 'text';
    this.rateInput.inputMode = 'decimal';
    this.rateInput.size = 4;
    this.rateInput.placeholder = 'rate';
    this.rateInput.setAttribute('aria-label', 'Custom rate');
    const button = (label: string, run: () => ClockAction | undefined) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        const action = run();
        if (action) void this.send(action);
      });
      this.buttons.push(b);
      return b;
    };
    root.append(
      this.summary,
      button('Pause', () => ({ action: 'pause' })),
      button('Resume', () => ({ action: 'resume' })),
      button('Step 1 min', () => ({ action: 'step', ms: 60_000 })),
      button('Step 5 min', () => ({ action: 'step', ms: 300_000 })),
      button('Step to next event', () => ({ action: 'stepToNext' })),
      ...RATES.map((r) => button(`Rate ${r}`, () => ({ action: 'rate', rate: r }))),
      this.rateInput,
      button('Set rate', () => {
        const rate = parseRate(this.rateInput.value);
        if (rate === undefined) {
          this.message.textContent = `Rate must be a number above 0 and at most ${MAX_RATE}.`;
          return undefined;
        }
        return { action: 'rate', rate };
      }),
      this.message,
    );
    this.setState(undefined);
  }

  setGame(id: string | undefined): void {
    this.gameId = id;
    this.message.textContent = '';
    this.setState(undefined);
  }

  /** Show the clock from a fresh state snapshot; the controls are off for a closed or finished game. */
  setState(s: AdminState | undefined): void {
    this.summary.textContent = this.gameId ? clockSummary(s) : 'no game selected';
    this.stopped = !s || s.clock?.status === 'stopped';
    this.sync();
  }

  private sync(): void {
    for (const b of this.buttons) b.disabled = this.busy || this.stopped || !this.gameId;
  }

  private async send(action: ClockAction): Promise<void> {
    const id = this.gameId;
    if (!id || this.busy) return;
    this.busy = true;
    this.message.textContent = '';
    this.sync();
    try {
      const res = await this.fetchFn(
        apiUrl(`games/${encodeURIComponent(id)}/clock`, this.token()),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action),
        },
      );
      // The admin switched games while this was in flight: its answer is not about this game.
      if (this.gameId !== id) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        this.message.textContent = `Refused: ${body.message ?? body.error ?? res.status}`;
      } else {
        const body = (await res.json().catch(() => ({}))) as { stalledAt?: number };
        if (body.stalledAt !== undefined)
          this.message.textContent = `Held for the umpire at ${formatGameMs(body.stalledAt)}.`;
        this.after();
      }
    } catch {
      if (this.gameId === id) this.message.textContent = 'Could not reach the server.';
    } finally {
      this.busy = false;
      this.sync();
    }
  }
}
