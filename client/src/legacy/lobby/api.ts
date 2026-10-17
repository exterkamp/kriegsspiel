/** The lobby REST calls (server/src/api/app.ts): make a game, list yours, join, ready up, start. */
import type { UmpireSettings, ApprovedBattlefield } from '@kriegsspiel/protocol';

export type SessionType = 'team_vs_team' | 'co_op_vs_ai' | 'hot_seat';

export interface PauseSettings {
  rule: 'unanimous' | 'majority';
  maxPauseMs?: number;
}

export interface GameSummary {
  id: string;
  scenario: string;
  status: 'lobby' | 'started';
  sessionType: SessionType;
  rate: number;
  /** The umpire settings chosen at creation; `mode: 'turns'` marks a turn-mode game (D39). */
  umpire?: UmpireSettings;
  /** The side you hold, or null. */
  side: string | null;
  creator: boolean;
  createdAtMs: number;
}

export interface GameInfo extends GameSummary {
  battlefield?: ApprovedBattlefield;
  you: string | null;
  ready: boolean;
  pause: PauseSettings | null;
  /** The host took you out of this room; you cannot rejoin. */
  removed?: boolean;
  sides: Array<{
    side: string;
    taken: boolean;
    ready: boolean;
    /** Staff and subordinates at this side's table (never who they are). */
    roles?: Array<{ role: string; units?: string[]; you: boolean }>;
  }>;
}

/** Who the host removes: a side's seat holder, or one of its role holders (a subordinate by one of their units). */
export interface KickTarget {
  side: string;
  role?: string;
  unit?: string;
}

export interface NewGame {
  scenario: string;
  rate: number;
  sessionType: SessionType;
  pause?: PauseSettings;
  /** The umpire's dial and persona (3.11), and turn mode with its settings (D39); the server defaults each. */
  dial?: UmpireSettings['dial'];
  persona?: UmpireSettings['persona'];
  mode?: 'turns';
  turnMinutes?: number;
  turnDeadlineHours?: number;
}

type Fetch = typeof fetch;

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** A readable reason for a failed call, from the server's `error` code. */
async function failure(res: Response, what: string): Promise<Error> {
  let code = '';
  try {
    code = ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    // no body
  }
  return new Error(`${what} (${code || res.status})`);
}

/** A scenario as the lobby lists it: its time limit in game minutes, when the server gives one. */
export interface ScenarioListing {
  id: string;
  name: string;
  lengthMinutes?: number;
}

export async function fetchScenarios(f: Fetch = fetch): Promise<ScenarioListing[]> {
  const res = await f('/scenarios');
  if (!res.ok) throw await failure(res, 'could not load the scenarios');
  return ((await res.json()) as { scenarios: ScenarioListing[] }).scenarios;
}

export async function fetchGames(f: Fetch = fetch): Promise<GameSummary[]> {
  const res = await f('/games');
  if (!res.ok) throw await failure(res, 'could not load your games');
  return ((await res.json()) as { games: GameSummary[] }).games;
}

export async function fetchGame(
  id: string,
  f: Fetch = fetch,
  signal?: AbortSignal,
): Promise<GameInfo> {
  const res = await f(`/games/${encodeURIComponent(id)}?battlefieldVersion=1`, {
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  if (res.status === 404) throw new Error('no such game');
  if (!res.ok) throw await failure(res, 'could not read the game');
  return (await res.json()) as GameInfo;
}

/** Makes a game that waits in the lobby; resolves to its id. */
export async function createLobbyGame(game: NewGame, f: Fetch = fetch): Promise<string> {
  const res = await f('/games', jsonInit({ ...game, lobby: true }));
  if (!res.ok) throw await failure(res, 'could not create the game');
  return ((await res.json()) as { id: string }).id;
}

export async function joinSide(id: string, side: string, f: Fetch = fetch): Promise<void> {
  const res = await f(
    `/games/${encodeURIComponent(id)}/join?battlefieldVersion=1`,
    jsonInit({ side }),
  );
  if (res.status === 409) throw new Error(`${side} is already taken`);
  if (!res.ok) throw await failure(res, 'could not join');
}

export async function setReady(id: string, ready: boolean, f: Fetch = fetch): Promise<void> {
  const res = await f(`/games/${encodeURIComponent(id)}/ready`, jsonInit({ ready }));
  if (!res.ok) throw await failure(res, 'could not change ready');
}

export async function startGame(id: string, f: Fetch = fetch): Promise<void> {
  const res = await f(`/games/${encodeURIComponent(id)}/start`, jsonInit({}));
  if (res.status === 409) {
    const body = (await res.json()) as { error: string };
    throw new Error(
      body.error === 'sides_open' ? 'Every side needs a player first.' : 'Everyone must be ready.',
    );
  }
  if (!res.ok) throw await failure(res, 'could not start');
}

/** Gives up your seat or role in a game that has not started. */
export async function leaveGame(id: string, f: Fetch = fetch): Promise<void> {
  const res = await f(`/games/${encodeURIComponent(id)}/leave`, jsonInit({}));
  if (!res.ok) throw await failure(res, 'could not leave');
}

/** The host removes another player from a game that has not started. */
export async function kickPlayer(id: string, who: KickTarget, f: Fetch = fetch): Promise<void> {
  const res = await f(`/games/${encodeURIComponent(id)}/kick`, jsonInit(who));
  if (!res.ok) throw await failure(res, 'could not remove the player');
}
