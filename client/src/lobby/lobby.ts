/** The lobby screens: make a game and see yours, and wait in a game's room until it starts. */
import {
  createLobbyGame,
  fetchGame,
  fetchGames,
  fetchScenarios,
  joinSide,
  setReady,
  startGame,
  type GameInfo,
  type SessionType,
} from './api.js';
import {
  RATE_PRESETS,
  SESSION_LABELS,
  inviteLink,
  parseRate,
  rateLabel,
  startBlocker,
} from './model.js';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const panel = (app: HTMLElement): HTMLElement => {
  app.querySelector('#lobby')?.remove();
  const p = el('div', { id: 'lobby' });
  app.append(p);
  return p;
};

/** The create-a-game form and the list of the player's games. Games open with `?game=<id>`. */
export async function showGameList(app: HTMLElement): Promise<void> {
  const root = panel(app);
  const msg = el('p', { id: 'lobby-msg', role: 'status' });
  const [scenarios, games] = await Promise.all([fetchScenarios(), fetchGames()]);

  const scenario = el('select', { id: 'new-scenario' });
  for (const s of scenarios) scenario.append(el('option', { value: s.id }, s.name));
  const session = el('select', { id: 'new-session' });
  for (const [value, label] of Object.entries(SESSION_LABELS)) {
    session.append(el('option', { value }, label));
  }
  const rate = el('select', { id: 'new-rate' });
  for (const r of RATE_PRESETS) rate.append(el('option', { value: String(r) }, rateLabel(r)));
  rate.append(el('option', { value: 'custom' }, 'Custom…'));
  const custom = el('input', {
    id: 'new-rate-custom',
    type: 'text',
    placeholder: 'e.g. 30',
    hidden: true,
  });
  rate.addEventListener('change', () => {
    custom.hidden = rate.value !== 'custom';
  });
  const pause = el('select', { id: 'new-pause' });
  pause.append(
    el('option', { value: 'unanimous' }, 'Pause by unanimous vote'),
    el('option', { value: 'majority' }, 'Pause by majority vote'),
    el('option', { value: 'off' }, 'Players cannot pause'),
  );

  const create = el('button', { id: 'new-create', type: 'button' }, 'Create game');
  create.addEventListener('click', () => {
    const r = rate.value === 'custom' ? parseRate(custom.value) : Number(rate.value);
    if (r === undefined) {
      msg.textContent = 'Enter a clock ratio between 0.01 and 86400, for example 30.';
      return;
    }
    create.disabled = true;
    void createLobbyGame({
      scenario: scenario.value,
      rate: r,
      sessionType: session.value as SessionType,
      ...(pause.value === 'off'
        ? {}
        : { pause: { rule: pause.value as 'unanimous' | 'majority' } }),
    })
      .then((id) => window.location.assign(`/?game=${encodeURIComponent(id)}`))
      .catch((e: unknown) => {
        msg.textContent = e instanceof Error ? e.message : String(e);
        create.disabled = false;
      });
  });

  const list = el('ul', { id: 'game-list' });
  if (games.length === 0) list.append(el('li', {}, 'No games yet.'));
  for (const g of games) {
    const name = scenarios.find((s) => s.id === g.scenario)?.name ?? g.scenario;
    const link = el(
      'a',
      { href: `/?game=${encodeURIComponent(g.id)}` },
      `${name}, ${SESSION_LABELS[g.sessionType]}, ${rateLabel(g.rate)}`,
    );
    list.append(
      el(
        'li',
        {},
        link,
        ` — ${g.status === 'lobby' ? 'in the lobby' : 'started'}${g.side ? `, you are ${g.side}` : ''}`,
      ),
    );
  }

  root.append(
    el('h2', {}, 'New game'),
    el('label', {}, 'Scenario ', scenario),
    el('label', {}, 'Session ', session),
    el('label', {}, 'Clock ', rate, custom),
    el('label', {}, 'Pause ', pause),
    create,
    msg,
    el('h2', {}, 'Your games'),
    list,
  );
}

/**
 * The room of a game that has not started: who sits where, who is ready, the invite link, and
 * the start button for the creator. Resolves once the game has started.
 */
export function showRoom(app: HTMLElement, first: GameInfo): Promise<void> {
  const root = panel(app);
  const id = first.id;
  return new Promise((resolve) => {
    let shown = '';
    const render = (info: GameInfo, error?: string) => {
      shown = JSON.stringify(info);
      root.replaceChildren();
      const hot = info.sessionType === 'hot_seat';
      root.append(
        el('h2', {}, `Lobby: ${SESSION_LABELS[info.sessionType]}, ${rateLabel(info.rate)}`),
      );
      const sides = el('ul', { id: 'room-sides' });
      for (const s of info.sides) {
        const row = el(
          'li',
          {},
          `${s.side}: ${s.taken ? (s.ready ? 'ready' : 'seated') : 'open'}${info.you === s.side ? ' (you)' : ''} `,
        );
        if (!s.taken && !info.you && !hot) {
          const take = el('button', { type: 'button' }, `Take ${s.side}`);
          take.addEventListener('click', () => {
            void joinSide(id, s.side).then(poll, (e: unknown) => render(info, String(e)));
          });
          row.append(take);
        }
        sides.append(row);
      }
      root.append(sides);
      if (!hot) {
        const link = inviteLink(window.location.origin, id);
        root.append(
          el(
            'p',
            {},
            'Invite link: ',
            el('input', { id: 'invite', readOnly: true, value: link, size: 40 }),
          ),
        );
      }
      if (info.you && !info.creator) {
        const ready = el(
          'button',
          { id: 'room-ready', type: 'button' },
          info.ready ? 'Not ready' : 'Ready',
        );
        ready.addEventListener('click', () => {
          void setReady(id, !info.ready).then(poll, (e: unknown) => render(info, String(e)));
        });
        root.append(ready);
      }
      const blocker = startBlocker(info);
      if (info.creator) {
        const go = el(
          'button',
          { id: 'room-start', type: 'button', disabled: blocker !== undefined },
          'Start game',
        );
        go.addEventListener('click', () => {
          go.disabled = true;
          void startGame(id).then(poll, (e: unknown) =>
            render(info, e instanceof Error ? e.message : String(e)),
          );
        });
        root.append(go);
      }
      root.append(
        el(
          'p',
          { id: 'lobby-msg', role: 'status' },
          error ?? (info.creator ? (blocker ?? '') : 'Waiting for the host to start.'),
        ),
      );
    };
    const poll = () => {
      void fetchGame(id)
        .then((info) => {
          if (info.status === 'started') {
            root.remove();
            clearInterval(timer);
            resolve();
          } else if (JSON.stringify(info) !== shown) {
            // Redraw only on a change, so a click or a selected invite link is not lost to the poll.
            render(info);
          }
        })
        .catch(() => undefined);
    };
    const timer = setInterval(poll, 2000);
    render(first);
  });
}
