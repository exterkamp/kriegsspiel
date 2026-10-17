/**
 * Replay panel (Epic #119, story 8.7): scrub a game's input log. Read-only: it only GETs
 * `/admin/api/games/:id/replay` and `/replay/at`, which rebuild the game on a manual clock
 * without calling a model.
 */
import {
  apiUrl,
  formatGameMs,
  nextMarkIndex,
  prevMarkIndex,
  type MarkKind,
  type ReplayMark,
} from './model.js';

interface Timeline {
  endMs: number;
  marks: ReplayMark[];
}

interface AtResult {
  gameMs: number;
  engine: unknown;
  views: Record<string, unknown>;
  events: { time: number; type: string; payload: unknown }[];
  llmCalls: number;
}

const JUMPS: { kind: MarkKind; label: string }[] = [
  // Turn mode (11.11): each turn's start and end, so a game can be scrubbed turn by turn.
  { kind: 'turn', label: 'turn' },
  { kind: 'contact', label: 'contact' },
  { kind: 'order', label: 'order delivery' },
  { kind: 'llm', label: 'LLM call' },
];

export class ReplayPanel {
  private gameId: string | undefined;
  private timeline: Timeline | undefined;
  private at = 0;
  private request = 0;

  private readonly slider: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly status: HTMLElement;
  private readonly out: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly token: () => string | undefined,
    private readonly fetchFn: typeof fetch,
  ) {
    root.innerHTML = `
      <div class="scrub">
        <button type="button" data-step="-1" aria-label="Previous event">◀ event</button>
        <input type="range" min="0" max="0" step="1" value="0" aria-label="Game time" />
        <button type="button" data-step="1" aria-label="Next event">event ▶</button>
        <output aria-live="polite"></output>
      </div>
      <div class="jumps"></div>
      <p class="empty" role="status"></p>
      <div class="result"></div>`;
    this.slider = root.querySelector('input')!;
    this.clock = root.querySelector('output')!;
    this.status = root.querySelector('.empty')!;
    this.out = root.querySelector('.result')!;
    const jumps = root.querySelector('.jumps')!;
    for (const j of JUMPS) {
      for (const dir of [-1, 1] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.jump = j.kind;
        b.dataset.dir = String(dir);
        b.textContent = dir < 0 ? `◀ ${j.label}` : `${j.label} ▶`;
        jumps.append(b);
      }
    }
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.step) this.jump(Number(b.dataset.step));
      else if (b.dataset.jump) this.jump(Number(b.dataset.dir), b.dataset.jump as MarkKind);
    });
    // Replay on release, so dragging does not fire a replay per pixel.
    this.slider.addEventListener('input', () => {
      this.at = Number(this.slider.value);
      this.clock.textContent = formatGameMs(this.at);
    });
    this.slider.addEventListener('change', () => void this.load(this.at));
    this.status.textContent = 'No game selected.';
  }

  /** Point the panel at a game (or none) and load its timeline; `reload` refetches a loaded one. */
  async setGame(id: string | undefined, reload = false): Promise<void> {
    if (id === this.gameId && this.timeline && !reload) return;
    this.gameId = id;
    this.timeline = undefined;
    this.out.replaceChildren();
    if (!id) {
      this.status.textContent = 'No game selected.';
      return;
    }
    this.status.textContent = 'Loading timeline…';
    const ticket = ++this.request;
    try {
      const res = await this.fetchFn(
        apiUrl(`games/${encodeURIComponent(id)}/replay`, this.token()),
      );
      if (!res.ok) throw new Error(String(res.status));
      const tl = (await res.json()) as Timeline;
      if (ticket !== this.request) return;
      this.timeline = tl;
      this.slider.max = String(tl.endMs);
      this.status.textContent = `${tl.marks.length} marks · replayed from the input log, no model calls`;
      await this.load(Math.min(this.at, tl.endMs));
    } catch {
      if (ticket === this.request) this.status.textContent = 'This game cannot be replayed.';
    }
  }

  private jump(dir: number, kind?: MarkKind): void {
    if (!this.timeline) return;
    const { marks, endMs } = this.timeline;
    const i = dir > 0 ? nextMarkIndex(marks, this.at, kind) : prevMarkIndex(marks, this.at, kind);
    const target = i >= 0 ? marks[i]!.ms : dir > 0 ? endMs : 0;
    void this.load(Math.max(0, Math.min(endMs, target)));
  }

  private async load(ms: number): Promise<void> {
    const id = this.gameId;
    if (!id) return;
    this.at = ms;
    this.slider.value = String(ms);
    this.clock.textContent = formatGameMs(ms);
    const ticket = ++this.request;
    try {
      const res = await this.fetchFn(
        apiUrl(`games/${encodeURIComponent(id)}/replay/at`, this.token(), { at: String(ms) }),
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as AtResult;
      if (ticket !== this.request) return;
      this.show(body);
    } catch {
      if (ticket === this.request) this.status.textContent = 'Replay failed.';
    }
  }

  private show(r: AtResult): void {
    this.out.replaceChildren();
    const sections: [string, unknown][] = [
      ['Master state', r.engine],
      ...Object.entries(r.views).map(([side, v]): [string, unknown] => [`View: ${side}`, v]),
      [`Events up to ${formatGameMs(r.gameMs)} (${r.events.length})`, r.events],
    ];
    for (const [title, data] of sections) {
      const d = document.createElement('details');
      const s = document.createElement('summary');
      s.textContent = title;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(data, null, 2);
      d.append(s, pre);
      this.out.append(d);
    }
    this.out.firstElementChild?.setAttribute('open', '');
  }
}
