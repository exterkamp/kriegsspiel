import type { Dispatch, SideView } from '@kriegsspiel/protocol';
import { formatGameTime, formatRate, gameNowMs, type ClientState } from '../net/state.js';

export interface HudHandlers {
  /** The player pressed Send. Return an error string to keep the text in the box. */
  onSendOrder(unitId: string | undefined, text: string): string | undefined;
  onOpenDispatch(d: Dispatch): void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const LINK_LABEL = {
  offline: 'no server (fixture)',
  connecting: 'connecting…',
  open: 'connected',
  closed: 'reconnecting…',
};

/** Text for the clock panel. Pure, so it can be tested without a DOM. */
export function clockText(state: ClientState, nowWall: number): string {
  if (!state.clock) return 'no clock yet';
  const { rate, status } = state.clock;
  return `${formatGameTime(gameNowMs(state.clock, nowWall))} · ${formatRate(rate)} · ${status}`;
}

const REASON_TEXT = {
  'objective-taken': 'the objective was taken',
  'objective-held': 'the objective was held',
  eliminated: 'the opposing force was eliminated',
  withdrawn: 'the opposing force withdrew',
};

/** Text for the end-of-game panel, or undefined while the game runs. Pure, so it can be tested without a DOM. */
export function gameOverText(state: ClientState): string | undefined {
  const g = state.gameOver;
  if (!g) return undefined;
  const who =
    g.winner === null
      ? 'Both sides were put out of the fight'
      : g.winner === state.view?.side
        ? 'Victory'
        : `Defeat: ${g.winner} wins`;
  return `${who}: ${REASON_TEXT[g.reason]}. Game time elapsed ${formatGameTime(g.atGame)}.`;
}

/** Name to put in the order box for a unit. The parser addresses units by name prefix. */
export function orderPrefix(view: SideView | undefined, unitId: string): string {
  const u = view?.ownUnits.find((o) => o.id === unitId);
  return u ? `${u.name}, ` : '';
}

/**
 * Final text of an order. The parser finds the unit from the wording, so the chosen unit's name is put in
 * front of bare text, but never when the text already starts with the name of any of our own units.
 */
export function buildOrderText(
  view: SideView | undefined,
  unitId: string | undefined,
  text: string,
): string {
  const prefix = unitId ? orderPrefix(view, unitId) : '';
  if (!prefix) return text;
  const lower = text.toLowerCase();
  const named = view?.ownUnits.some((u) => lower.startsWith(u.name.toLowerCase()));
  return named ? text : `${prefix}${text}`;
}

/** Plain HUD: clock, orders desk, in-tray. Static markup is built once; `render` updates the parts that change. */
export class Hud {
  private readonly clockEl: HTMLElement;
  private readonly linkEl: HTMLElement;
  private readonly unitSel: HTMLSelectElement;
  private readonly textEl: HTMLTextAreaElement;
  private readonly errEl: HTMLElement;
  private readonly pendingEl: HTMLElement;
  private readonly trayEl: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private latest: ClientState | undefined;
  private unitsKey = '';
  /** The prefix `selectUnit` last put in the box, so a later selection can replace it. */
  private autoPrefix = '';
  private trayKey = '';
  private readonly byId = new Map<string, Dispatch>();

  constructor(
    root: HTMLElement,
    private readonly h: HudHandlers,
  ) {
    root.insertAdjacentHTML(
      'beforeend',
      `<section id="clock" aria-label="Clock"><b id="clock-text"></b> <span id="link"></span><span id="staff" hidden> · staff at work</span></section>
       <section id="gameover" aria-label="Game over" role="status" hidden></section>
       <section id="orders" aria-label="Orders">
         <h2>Orders</h2>
         <select id="order-unit" aria-label="Unit"></select>
         <textarea id="order-text" rows="3" maxlength="2000" placeholder="Write an order…"></textarea>
         <button id="order-send">Send</button>
         <div id="order-err" role="alert"></div>
         <ul id="pending"></ul>
         <ul id="notices"></ul>
       </section>
       <section id="tray" aria-label="In-tray"><h2>In-tray</h2><ul id="tray-list"></ul></section>`,
    );
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.clockEl = q('#clock-text');
    this.linkEl = q('#link');
    this.unitSel = q('#order-unit');
    this.textEl = q('#order-text');
    this.errEl = q('#order-err');
    this.pendingEl = q('#pending');
    this.trayEl = q('#tray-list');
    this.noticeEl = q('#notices');
    this.staffEl = q('#staff');
    this.overEl = q('#gameover');
    this.sendBtn = q('#order-send');
    q('#order-send').addEventListener('click', () => this.send());
    this.textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.send();
    });
    this.trayEl.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      const d = li && this.byId.get(li.dataset.id!);
      if (d) this.h.onOpenDispatch(d);
    });
  }

  private readonly staffEl: HTMLElement;
  private readonly overEl: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;

  /** Choose a unit (for example after a click on the table) and start its order. */
  selectUnit(unitId: string): void {
    this.unitSel.value = unitId;
    const current = this.textEl.value;
    const untouched = current.trim() === '' || current === this.autoPrefix;
    if (untouched && this.latest?.view) {
      this.autoPrefix = orderPrefix(this.latest.view, unitId);
      this.textEl.value = this.autoPrefix;
    }
    this.textEl.focus();
  }

  private send(): void {
    if (this.latest?.gameOver) return;
    const text = this.textEl.value.trim();
    if (!text) return;
    const err = this.h.onSendOrder(this.unitSel.value || undefined, text);
    this.errEl.textContent = err ?? '';
    if (!err) this.textEl.value = '';
  }

  /** Refresh the clock text only; cheap enough to call every animation frame. */
  tick(nowWall: number): void {
    if (this.latest) this.clockEl.textContent = clockText(this.latest, nowWall);
  }

  render(state: ClientState, nowWall: number): void {
    this.latest = state;
    this.tick(nowWall);
    this.linkEl.textContent = LINK_LABEL[state.link];
    this.staffEl.hidden = !state.staffAtWork;
    const over = gameOverText(state);
    this.overEl.hidden = over === undefined;
    this.overEl.textContent = over ?? '';
    this.textEl.disabled = this.sendBtn.disabled = this.unitSel.disabled = over !== undefined;
    const units = state.view?.ownUnits ?? [];
    const uk = units.map((u) => `${u.id}|${u.name}`).join(';');
    if (uk !== this.unitsKey) {
      this.unitsKey = uk;
      const keep = this.unitSel.value;
      this.unitSel.innerHTML =
        `<option value="">(name the unit in the order)</option>` +
        units.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
      this.unitSel.value = keep;
    }
    this.pendingEl.innerHTML = state.pending
      .map(
        (p) =>
          `<li><i>Pending</i> sent ${esc(formatGameTime(p.sentAtGame))}: ${esc(p.text)}<br><small>Delivery time unknown until it is carried.</small></li>`,
      )
      .join('');
    this.noticeEl.innerHTML = state.notices
      .slice(-3)
      .map((n) => `<li>${esc(n.message)}</li>`)
      .join('');
    const tk = JSON.stringify([state.dispatches.map((d) => d.id), [...state.read]]);
    if (tk !== this.trayKey) {
      this.trayKey = tk;
      this.byId.clear();
      this.trayEl.innerHTML = [...state.dispatches]
        .sort((a, b) => b.receivedAtGame - a.receivedAtGame)
        .map((d) => {
          this.byId.set(d.id, d);
          const unread = !state.read.has(d.id);
          return `<li data-id="${esc(d.id)}" class="${unread ? 'unread' : 'read'}" tabindex="0">
            <b>${unread ? '● ' : ''}${esc(d.from)}</b>
            <small>written ${esc(formatGameTime(d.writtenAtGame))} · received ${esc(formatGameTime(d.receivedAtGame))}${d.location ? ' · 📍 locate' : ''}</small>
            <div>${esc(d.text)}</div></li>`;
        })
        .join('');
    }
  }
}
