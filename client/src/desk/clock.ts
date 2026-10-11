import { formatGameTime, formatRate, gameNowMs, type ClientState } from '../net/state.js';

export interface ClockView {
  /** `Day 1 14:05`, or a placeholder before the server has sent a clock. */
  time: string;
  /** `4:1`; empty before a clock arrives. */
  rate: string;
  status: 'running' | 'paused' | 'stopped' | 'none';
  /** The umpire is still working on something game time depends on. */
  staffAtWork: boolean;
  /** The label for the status badge. */
  label: string;
}

const LABEL = { running: 'Running', paused: 'Paused', stopped: 'Stopped', none: 'No clock' };

/** What the desk clock shows, from the client state at a local wall time. Pure, so it needs no DOM. */
export function clockView(state: ClientState, nowWall: number): ClockView {
  const c = state.clock;
  if (!c) return { time: '--', rate: '', status: 'none', staffAtWork: false, label: LABEL.none };
  return {
    time: formatGameTime(gameNowMs(c, nowWall)),
    rate: formatRate(c.rate),
    status: c.status,
    staffAtWork: state.staffAtWork && !state.gameOver,
    label: LABEL[c.status],
  };
}

/** One line for assistive tech and the compact clock's tooltip. */
export function clockSummary(v: ClockView): string {
  if (v.status === 'none') return 'No clock yet';
  const parts = [v.time, v.label.toLowerCase(), `rate ${v.rate}`];
  if (v.staffAtWork) parts.push('staff at work');
  return parts.join(', ');
}
