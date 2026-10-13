/**
 * Admin page shell: game picker, live indicator and empty tabbed panels with a shared filter bar.
 * Mostly read-only: GETs to `/admin/api`, plus the clock control bar's POSTs (#128). Shares nothing with the game client.
 */
import { ReplayPanel } from './replay.js';
import { LlmPanel } from './llm.js';
import { EntryStore, type TraceEntry } from './entries.js';
import { ListPanel } from './listPanel.js';
import { EVENTS_PANEL, REQUESTS_PANEL } from './panels.js';
import {
  PANELS,
  adminGame,
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
import { ControlBar } from './controls.js';
import { StatePanel, type AdminState } from './state.js';

const POLL_MS = 3000;
const TOKEN_KEY = 'ks-admin-token';

// Storage can throw (private windows, blocked site data); the page works without it.
function storedToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}
function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Kept in memory for this page only.
  }
}

const STATE_DEBOUNCE_MS = 250;

export class AdminPage {
  private status: LinkStatus = 'connecting';
  private games: GameSummary[] = [];
  private gameId: string | undefined;
  private panel: PanelId = 'State';
  private stream: EventSource | undefined;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private streamCount = 0;
  private statePanel!: StatePanel;
  private readonly controls: ControlBar;
  private stateReq = 0;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  /** From `?token=`, else the one typed in this session (kept in sessionStorage), else none. */
  private token: string | undefined;
  private readonly tokenForm: HTMLFormElement;

  private readonly picker: HTMLSelectElement;
  private readonly indicator: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly tabs = new Map<PanelId, HTMLButtonElement>();
  private readonly panels = new Map<PanelId, HTMLElement>();
  private readonly note: HTMLElement;
  private replay!: ReplayPanel;
  private readonly llm: LlmPanel;
  private readonly entries = new EntryStore();
  private readonly lists = new Map<PanelId, ListPanel>();

  constructor(
    private readonly root: HTMLElement,
    search: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {
    this.token = adminToken(search) ?? storedToken();
    this.gameId = adminGame(search);
    root.innerHTML = `
      <header>
        <h1>kriegsspiel admin</h1>
        <label>game <select id="game" aria-label="Game"></select></label>
        <span id="live" role="status" aria-live="polite"><i></i><b></b></span>
        <small id="note"></small>
        <form id="tokenform" hidden>
          <label>admin token <input id="token" type="password" autocomplete="off" aria-label="Admin token" /></label>
          <button type="submit">Connect</button>
        </form>
      </header>
      <div id="controls"></div>
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
    this.tokenForm = root.querySelector('#tokenform')!;
    this.tokenForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = root.querySelector<HTMLInputElement>('#token')!.value.trim();
      if (!value) return;
      this.token = value;
      storeToken(value);
      this.status = 'connecting';
      this.render();
      clearTimeout(this.timer);
      void this.poll();
    });
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
      main.append(sec);
      const config =
        id === 'Events' ? EVENTS_PANEL : id === 'Requests' ? REQUESTS_PANEL : undefined;
      if (config) this.lists.set(id, new ListPanel(sec, this.entries, config));
      else if (id !== 'Replay')
        sec.innerHTML = `<p class="empty">${id} panel — not implemented yet.</p>`;
      this.panels.set(id, sec);
      if (id === 'Replay') this.replay = new ReplayPanel(sec, () => this.token, this.fetchFn);
    }
    this.controls = new ControlBar(
      root.querySelector('#controls')!,
      () => this.token,
      this.fetchFn,
      () => void this.refreshState(),
    );
    this.statePanel = new StatePanel(this.panels.get('State')!);
    this.llm = new LlmPanel(this.panels.get('LLM')!);
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
    for (const list of this.lists.values()) list.destroy();
    clearTimeout(this.timer);
    clearTimeout(this.stateTimer);
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
    // A list built while hidden had no layout; re-render so it opens at the tail, not the top.
    this.lists.get(id)?.renderNow();
    // Reloading also picks up the new end of a running game's timeline.
    if (id === 'Replay') void this.replay.setGame(this.gameId, true);
  }

  private applyFilter(): void {
    this.panels.get(this.panel)!.dataset.filter = this.filter.value;
    this.statePanel.setFilter(this.filter.value);
    this.llm.setFilter(this.filter.value);
    for (const list of this.lists.values()) list.setText(this.filter.value);
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
      void this.refreshState();
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
    // 404 may be a proxy blip or a restart with the API enabled; 401 waits for a token typed into the form.
    if (retry) this.timer = setTimeout(() => void this.poll(), backoffMs(Infinity));
  }

  private select(id: string | undefined): void {
    this.gameId = id;
    this.controls.setGame(id);
    this.closeStream();
    this.streamCount = 0;
    this.llm.reset();
    this.entries.clear();
    for (const list of this.lists.values()) list.reset();
    this.status = id ? 'connecting' : 'live';
    if (this.panel === 'Replay') void this.replay.setGame(id);
    this.statePanel.showMessage(id ? 'Loading state…' : 'No game selected.');
    if (id) {
      this.openStream(id);
      void this.refreshState();
    }
    this.render();
  }

  private openStream(id: string): void {
    // EventSource reconnects by itself after network errors; we mirror its state and reopen it if it gives up.
    // Resume after what we already hold; the server replays the backlog from there, then goes live.
    const after = this.entries.lastSeq;
    const es = new EventSource(
      apiUrl(
        `games/${encodeURIComponent(id)}/stream`,
        this.token,
        after ? { after: String(after) } : {},
      ),
    );
    this.stream = es;
    es.onopen = () => {
      this.status = 'live';
      this.render();
    };
    es.onmessage = (e: MessageEvent<string>) => {
      this.streamCount++;
      // A trace entry means something changed; refetch the state, at most a few times a second.
      if (!this.stateTimer) {
        this.stateTimer = setTimeout(() => {
          this.stateTimer = undefined;
          void this.refreshState();
        }, STATE_DEBOUNCE_MS);
      }
      try {
        const entry = JSON.parse(e.data) as TraceEntry;
        this.llm.add(entry);
        if (this.entries.add(entry)) for (const list of this.lists.values()) list.refresh();
      } catch {
        // A malformed frame is skipped; the stream carries on.
      }
      this.render();
    };
    es.onerror = () => {
      this.status = 'reconnecting';
      // A non-200 answer closes the EventSource for good; drop it so the next poll reopens it.
      if (es.readyState === EventSource.CLOSED) this.closeStream();
      this.render();
    };
  }

  /** Fetches the master state and both side views of the selected game into the State panel. */
  private async refreshState(): Promise<void> {
    const id = this.gameId;
    if (!id) return;
    // Poll- and stream-driven refreshes can overlap; only the latest request may write.
    const req = ++this.stateReq;
    const current = () => id === this.gameId && req === this.stateReq;
    try {
      const res = await this.fetchFn(apiUrl(`games/${encodeURIComponent(id)}/state`, this.token));
      if (!current()) return;
      if (res.status === 404) {
        this.controls.setState(undefined);
        return this.statePanel.showMessage('This game is not open; no live state.');
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as AdminState;
      if (current()) {
        this.statePanel.update(body);
        this.controls.setState(body);
      }
    } catch {
      // Keep the last good state but dim it, so old data never passes for current; the next refresh retries.
      if (current()) this.statePanel.markStale();
    }
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
    this.tokenForm.hidden = this.status !== 'unauthorized';
    this.indicator.dataset.status = this.status;
    this.indicator.querySelector('b')!.textContent = linkLabel(this.status);
    this.note.textContent = this.gameId ? `${this.streamCount} live entries this session` : '';
  }
}
