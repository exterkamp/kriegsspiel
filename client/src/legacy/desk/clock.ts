import { formatGameTime, formatRate, gameNowMs, type ClientState } from '../net/state.js';
import { turnLine, turnPhase } from './turn.js';

export interface ClockView {
  /** `Day 1 14:05`, or a placeholder before the server has sent a clock. */
  time: string;
  /** `4:1`; empty before a clock arrives. */
  rate: string;
  status: 'running' | 'paused' | 'stopped' | 'none';
  /** The umpire is still working on something game time depends on. */
  staffAtWork: boolean;
  /** A vote to pause or resume is open. */
  vote?: 'pause' | 'resume';
  /** The label for the status badge. */
  label: string;
  /** Turn mode (D39): the open turn, `Turn 3: 08:20 to 08:40`; `time` then holds it and `rate` is empty. */
  turn?: string;
  /** Turn mode: the turn length, `20-min turns`, shown in place of the rate once no turn is open. */
  turnLength?: string;
}

const LABEL = { running: 'Running', paused: 'Paused', stopped: 'Stopped', none: 'No clock' };

const TURN_LABEL = {
  writing: 'Writing orders',
  sent: 'Orders sent',
  resolving: 'Turn being decided',
  over: 'Game over',
};

/** What the desk clock shows, from the client state at a local wall time. Pure, so it needs no DOM. */
export function clockView(state: ClientState, nowWall: number): ClockView {
  if (state.turnMode) return turnClockView(state);
  const c = state.clock;
  if (!c) return { time: '--', rate: '', status: 'none', staffAtWork: false, label: LABEL.none };
  const open = state.pause?.proposal;
  return {
    ...(open && !state.gameOver ? { vote: open.kind } : {}),
    // After the game ends the clock stands at the final moment; it must not tick or step back.
    time: formatGameTime(state.gameOver ? state.gameOver.atGame : gameNowMs(c, nowWall)),
    rate: formatRate(c.rate),
    status: c.status,
    staffAtWork: state.staffAtWork && !state.gameOver,
    label: LABEL[c.status],
  };
}

/**
 * A turn-mode game (D39): game time only moves when a turn is decided, so the clock shows the open turn and
 * where the side stands in it, with no rate. After the game it stands at the final moment.
 */
function turnClockView(state: ClientState): ClockView {
  const phase = turnPhase(state);
  const t = state.turn;
  const end = state.gameOver?.atGame ?? state.clock?.gameMs ?? state.view?.atGame;
  return {
    time: t && !state.gameOver ? turnLine(t) : end === undefined ? '--' : formatGameTime(end),
    rate: '',
    status: phase === 'over' ? 'stopped' : 'paused',
    // The status label says the turn is being decided; the desk shows the umpire at work.
    staffAtWork: false,
    label: TURN_LABEL[phase],
    ...(t && !state.gameOver ? { turn: turnLine(t) } : {}),
    ...(state.turnMinutes ? { turnLength: `${state.turnMinutes}-min turns` } : {}),
  };
}

/** One line for assistive tech and the compact clock's tooltip. */
export function clockSummary(v: ClockView): string {
  if (v.turn) return [v.turn, v.label.toLowerCase()].join(', ');
  if (v.status === 'none') return 'No clock yet';
  // A finished turn-mode game has no rate to give.
  const parts = [
    v.time,
    v.label.toLowerCase(),
    ...(v.rate ? [`rate ${v.rate}`] : []),
    ...(v.turnLength ? [v.turnLength] : []),
  ];
  if (v.vote) parts.push(`${v.vote} proposed`);
  if (v.staffAtWork) parts.push('staff at work');
  return parts.join(', ');
}
