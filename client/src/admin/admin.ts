/**
 * Admin page shell: game picker, live indicator and empty tabbed panels with a shared filter bar.
 * Read-only: it only issues GETs to `/admin/api` and shares nothing with the game client.
 */
import {
  PANELS,
  adminToken,
  apiUrl,
  backoffMs,
  gameLabel,
  linkLabel,
  panelForKey,
  pickGame,
  stepPanel,
  type GameSummary,
  type LinkStatus,
  type PanelId,
} from './model.js';

const POLL_MS = 3000;

export class AdminPage {
  private status: LinkStatus = 'connecting';
  private games: GameSummary[] = [];
  private gameId: string | undefined;
  private panel: PanelId = 'State';
  private stream: EventSource | undefined;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private streamCount = 0;
  private readonly token: string | undefined;

  private readonly picker: HTMLSelectElement;
  private readonly indicator: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly tabs = new Map<PanelId, HTMLButtonElement>();
  private readonly panels = new Map<PanelId, HTMLElement>();
  private readonly note: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    search: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.token = adminToken(search);
    root.innerHTML = `
      <header>
        <h1>kriegsspiel admin</h1>
        <label>game <select id="game" aria-label="Game"></select></label>
        <span id="live" role="status" aria-live="polite"><i></i><b></b></span>
        <small id="note"></small>
      </header>
      <nav role="tablist" aria-label="Panels"></nav>
      <div id="filterbar">
        <input id="filter" type="search" placeholder="filter  ( / )" aria-label="Filter" />
        <small>1-5 switch panel · ←/→ move between tabs · / filter</small>
      </div>
      <main></main>`;
    this.picker = root.querySelector('#game')!;
    this.indicator = root.querySelector('#live')!;
    this.filter = root.querySelector('#filter')!;
    this.note = root.querySelector('#note')!;
    const nav = root.querySelector('nav')!;
    const main = root.querySelector('main')!;
    for (const id of PANELS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.textContent = id;
      tab.dataset.panel = id;
      tab.addEventListener('click', () => this.show(id));
      nav.append(tab);
      this.tabs.set(id, tab);
      const sec = document.createElement('section');
      sec.setAttribute('role', 'tabpanel');
      sec.dataset.panel = id;
      sec.innerHTML = `<p class="empty">${id} panel — not implemented yet.</p>`;
      main.append(sec);
      this.panels.set(id, sec);
    }
    nav.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        this.show(stepPanel(this.panel, e.key === 'ArrowRight' ? 1 : -1), true);
        e.preventDefault();
      }
    });
    this.picker.addEventListener('change', () => this.select(this.picker.value || undefined));
    this.filter.addEventListener('input', () => this.applyFilter());
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing =
        e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === '/' && !typing) {
        this.filter.focus();
        e.preventDefault();
      } else if (e.key === 'Escape' && e.target === this.filter) {
        this.filter.blur();
      } else if (!typing) {
        const p = panelForKey(e.key);
        if (p) this.show(p);
      }
    });
    this.show('State');
    this.render();
  }

  start(): void {
    void this.poll();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.closeStream();
  }

  get linkStatus(): LinkStatus {
    return this.status;
  }

  show(id: PanelId, focus = false): void {
    this.panel = id;
    for (const [pid, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(pid === id));
      tab.tabIndex = pid === id ? 0 : -1;
      if (pid === id && focus) tab.focus();
    }
    for (const [pid, sec] of this.panels) sec.hidden = pid !== id;
    this.applyFilter();
  }

  private applyFilter(): void {
    // Shell only: later stories hook each panel's rows into this shared filter text.
    this.panels.get(this.panel)!.dataset.filter = this.filter.value;
  }

  private async poll(): Promise<void> {
    try {
      const res = await this.fetchFn(apiUrl('games', this.token));
      if (res.status === 404) return this.fail('disabled', true);
      if (res.status === 401) return this.fail('unauthorized');
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { games: GameSummary[] };
      this.games = body.games;
      this.failures = 0;
      const next = pickGame(this.games, this.gameId);
      if (next !== this.gameId) this.select(next);
      // With no game to stream, the list poll itself is the liveness signal.
      if (!this.gameId) this.status = 'live';
      else if (!this.stream) {
        this.status = 'connecting';
        this.openStream(this.gameId);
      }
      this.render();
      this.timer = setTimeout(() => void this.poll(), POLL_MS);
    } catch {
      this.failures++;
      this.status = 'reconnecting';
      this.closeStream();
      this.render();
      this.timer = setTimeout(() => void this.poll(), backoffMs(this.failures - 1));
    }
  }

  private fail(status: 'disabled' | 'unauthorized', retry = false): void {
    this.status = status;
    this.closeStream();
    this.render();
    // 404 may be a proxy blip or a restart with the API enabled; 401 needs a reload with a new token.
    if (retry) this.timer = setTimeout(() => void this.poll(), backoffMs(Infinity));
  }

  private select(id: string | undefined): void {
    this.gameId = id;
    this.closeStream();
    this.streamCount = 0;
    this.status = id ? 'connecting' : 'live';
    if (id) this.openStream(id);
    this.render();
  }

  private openStream(id: string): void {
    // EventSource reconnects by itself after network errors; we mirror its state and reopen it if it gives up.
    const es = new EventSource(apiUrl(`games/${encodeURIComponent(id)}/stream`, this.token));
    this.stream = es;
    es.onopen = () => {
      this.status = 'live';
      this.render();
    };
    es.onmessage = () => {
      this.streamCount++;
      this.render();
    };
    es.onerror = () => {
      this.status = 'reconnecting';
      // A non-200 answer closes the EventSource for good; drop it so the next poll reopens it.
      if (es.readyState === EventSource.CLOSED) this.closeStream();
      this.render();
    };
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = undefined;
  }

  private render(): void {
    const current = this.picker.value;
    this.picker.replaceChildren(
      ...(this.games.length
        ? this.games.map((g) => new Option(gameLabel(g), g.id, false, g.id === this.gameId))
        : [new Option('no games', '')]),
    );
    this.picker.value = this.gameId ?? current;
    this.indicator.dataset.status = this.status;
    this.indicator.querySelector('b')!.textContent = linkLabel(this.status);
    this.note.textContent = this.gameId ? `${this.streamCount} live entries this session` : '';
  }
}
