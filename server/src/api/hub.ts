/**
 * Hub: the WebSocket connections of every game, and what each has been told.
 *
 * It pushes only `SideView` data built by `sideViewOf` (the visibility filter), and only
 * what changed since the connection's last push, so a client sees the initial view, then
 * view updates, new dispatches and clock changes as the game moves.
 */
import {
  parseCommand,
  serializeServerMessage,
  PROTOCOL_VERSION,
  MAX_MARKS,
  type ClockState,
  type Command,
  type DraftSnapshot,
  type Mark,
  type PauseProposal,
  type ServerMessage,
} from '@kriegsspiel/protocol';
import type { GameActor, GameStore } from '../game/index.js';
import type { PauseTransition } from '../pause.js';
import { DraftBook, DraftError } from '../drafts/book.js';
import { StaffDesk } from './conference.js';
import { sideViewOf } from './sideView.js';
import { staffOfficer } from '../umpire/index.js';
import { mayForward, viewForRole, type Seat, type SideId } from '@kriegsspiel/engine';
import type { Forward } from '../lobby/store.js';

/** The slice of a `ws` socket the hub uses. */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

const OPEN = 1;

interface Connection {
  side: SideId;
  userId: string | undefined;
  /** The role this player holds. Unset in shared-HQ play, where the connection sees the whole side view. */
  seat: Seat | undefined;
  socket: Socket;
  lastView: string;
  lastClock: string;
  sentDispatches: Set<string>;
  gameOverSent: boolean;
  /** The last `pauseState` sent, without its countdown. */
  lastPause: string;
  /** The newest pause step this connection has been told about. */
  pauseSeen: number;
}

type PauseResult = Extract<ServerMessage, { kind: 'pauseResult' }>;

/** What a pause machine step means to the players, or undefined for a step that only opens a vote. */
export function pauseResultOf(step: PauseTransition): Omit<PauseResult, 'v' | 'kind'> | undefined {
  const cause = step.cause;
  if (cause === 'proposed') return undefined;
  if (step.to === 'paused') {
    return step.from === 'resume_proposed'
      ? { outcome: 'cancelled', cause, proposalKind: 'resume' }
      : { outcome: 'paused', cause };
  }
  if (step.to === 'running') {
    return step.from === 'pause_proposed'
      ? { outcome: 'cancelled', cause, proposalKind: 'pause' }
      : { outcome: 'resumed', cause };
  }
  return undefined;
}

const error = (code: string, message: string): ServerMessage => ({
  v: PROTOCOL_VERSION,
  kind: 'error',
  code,
  message,
});

export class Hub {
  private readonly conns = new Map<string, Set<Connection>>();
  /** When each side's staff officers are next free (game time). */
  private readonly staffDesk = new StaffDesk();

  /** Each side's marks, loaded from the store on first use and kept here (the hub is their only writer). */
  private readonly marks = new Map<string, Promise<Mark[]>>();
  /** Each side's shared order drafts, loaded on first use; the hub is their only writer (D6c). */
  private readonly drafts = new Map<string, Promise<DraftBook>>();
  /** Game time each side was last pushed a view at; written to the store when its last connection closes. */
  private readonly seen = new Map<string, number>();
  /** Saves run one after another per side, so the last write is the newest list. */
  private readonly saves = new Map<string, Promise<void>>();

  constructor(
    private readonly lookup: (gameId: string) => GameActor | undefined,
    private readonly onError: (gameId: string, e: unknown) => void,
    private readonly store?: Pick<
      GameStore,
      'saveMarks' | 'loadMarks' | 'saveDrafts' | 'loadDrafts' | 'saveSeen' | 'loadSeen'
    >,
    /** The side a signed-in user sits on in a game, to name who asked for a pause. */
    private readonly sideOf: (gameId: string, userId: string) => SideId | undefined = () =>
      undefined,
    /** Papers HQ has forwarded in a game (kept by the lobby record, so they survive a restart). */
    private readonly forwards: {
      list(gameId: string): readonly Forward[];
      add(gameId: string, forward: Forward): void;
    } = { list: () => [], add: () => undefined },
  ) {}

  /** Forwards per game, read from the lobby record once and kept in step by `handleForward`. */
  private readonly forwardCache = new Map<string, Forward[]>();

  private forwardsOf(gameId: string): Forward[] {
    let list = this.forwardCache.get(gameId);
    if (!list) {
      list = [...this.forwards.list(gameId)];
      this.forwardCache.set(gameId, list);
    }
    return list;
  }

  /** The ids of papers HQ forwarded to the seat's formations. */
  private forwardedTo(gameId: string, conn: Connection): string[] {
    const units = conn.seat?.role === 'subordinate' ? (conn.seat.units ?? []) : [];
    return this.forwardsOf(gameId)
      .filter((f) => f.side === conn.side && units.includes(f.unit))
      .map((f) => f.dispatchId);
  }

  private viewOf(gameId: string, game: GameActor, conn: Connection) {
    return sideViewOf(
      game.state,
      conn.side,
      game.gameClock.snapshot(),
      conn.seat,
      conn.seat ? this.forwardedTo(gameId, conn) : [],
      game.narrationFor(conn.side),
    );
  }

  private marksOf(gameId: string, side: SideId): Promise<Mark[]> {
    const key = `${gameId}\0${side}`;
    let p = this.marks.get(key);
    if (!p) {
      p = this.store ? this.store.loadMarks(gameId, side) : Promise.resolve([]);
      this.marks.set(key, p);
      // A failed load must not stick: the next use retries.
      p.catch(() => this.marks.delete(key));
    }
    return p;
  }

  private saveMarks(gameId: string, side: SideId, marks: Mark[]): void {
    if (!this.store) return;
    const key = `${gameId}\0${side}`;
    const snapshot = [...marks];
    const run = (this.saves.get(key) ?? Promise.resolve()).then(() =>
      this.store!.saveMarks(gameId, side, snapshot),
    );
    const tail = run.catch((e) => this.onError(gameId, e));
    this.saves.set(key, tail);
    void tail.then(() => {
      if (this.saves.get(key) === tail) this.saves.delete(key);
    });
  }

  private draftsOf(gameId: string, side: SideId): Promise<DraftBook> {
    const key = `${gameId}\0${side}`;
    let p = this.drafts.get(key);
    if (!p) {
      p = (this.store ? this.store.loadDrafts(gameId, side) : Promise.resolve([])).then((list) =>
        DraftBook.from(list),
      );
      this.drafts.set(key, p);
      p.catch(() => this.drafts.delete(key));
    }
    return p;
  }

  private saveDrafts(gameId: string, side: SideId, book: DraftBook): void {
    if (!this.store) return;
    const key = `drafts\0${gameId}\0${side}`;
    const snapshot = structuredClone(book.toJSON());
    const run = (this.saves.get(key) ?? Promise.resolve()).then(() =>
      this.store!.saveDrafts(gameId, side, snapshot),
    );
    const tail = run.catch((e) => this.onError(gameId, e));
    this.saves.set(key, tail);
    void tail.then(() => {
      if (this.saves.get(key) === tail) this.saves.delete(key);
    });
  }

  /** Tell every connection of a side something about its drafts. */
  private broadcastSide(gameId: string, side: SideId, message: ServerMessage): void {
    for (const c of this.conns.get(gameId) ?? []) if (c.side === side) this.send(c, message);
  }

  /** Run one draft command against the side's book, tell the side what changed, and keep the book. */
  private async handleDraftCommand(
    gameId: string,
    conn: Connection,
    command: Extract<
      Command,
      {
        kind:
          | 'createDraft'
          | 'draftEdit'
          | 'draftComment'
          | 'resolveComment'
          | 'readDraft'
          | 'syncDrafts'
          | 'forkDraft'
          | 'mergeDraft';
      }
    >,
  ): Promise<void> {
    const book = await this.draftsOf(gameId, conn.side);
    const by = conn.userId ?? conn.side;
    const now = Date.now();
    const side = conn.side;
    const state = (draft: DraftSnapshot): ServerMessage => ({
      v: PROTOCOL_VERSION,
      kind: 'draftState',
      draft: structuredClone(draft),
    });
    try {
      switch (command.kind) {
        case 'createDraft': {
          const d = book.create(command.draft, by, {
            ...(command.text === undefined ? {} : { text: command.text }),
            ...(command.title === undefined ? {} : { title: command.title }),
          });
          this.broadcastSide(gameId, side, state(d));
          break;
        }
        case 'forkDraft':
          this.broadcastSide(gameId, side, state(book.fork(command.draft, command.newDraft, by)));
          break;
        case 'syncDrafts':
          this.send(conn, {
            v: PROTOCOL_VERSION,
            kind: 'drafts',
            drafts: structuredClone(book.toJSON()),
          });
          return;
        case 'draftEdit':
        case 'draftComment':
        case 'resolveComment': {
          if (command.kind === 'draftEdit') {
            // A resend of an edit already applied: answer the sender with the original entry only.
            const done = book.sentOp(command.draft, by, command.opId);
            if (done) {
              this.send(conn, {
                v: PROTOCOL_VERSION,
                kind: 'draftEntry',
                draft: command.draft,
                entry: done,
              });
              return;
            }
          }
          const entry =
            command.kind === 'draftEdit'
              ? book.edit(command.draft, by, now, {
                  baseRev: command.baseRev,
                  op: command.op,
                  ...(command.opId === undefined ? {} : { opId: command.opId }),
                })
              : command.kind === 'draftComment'
                ? book.comment(command.draft, by, now, {
                    baseRev: command.baseRev,
                    ...command.comment,
                  })
                : book.resolve(command.draft, by, now, command.commentId, command.resolved);
          this.broadcastSide(gameId, side, {
            v: PROTOCOL_VERSION,
            kind: 'draftEntry',
            draft: command.draft,
            entry,
          });
          break;
        }
        case 'readDraft': {
          const rev = book.read(command.draft, by, command.rev);
          if (rev === undefined) return;
          this.broadcastSide(gameId, side, {
            v: PROTOCOL_VERSION,
            kind: 'draftReceipt',
            draft: command.draft,
            reader: by,
            rev,
          });
          break;
        }
        case 'mergeDraft': {
          const { parent, entries } = book.merge(command.draft, now);
          for (const entry of entries)
            this.broadcastSide(gameId, side, {
              v: PROTOCOL_VERSION,
              kind: 'draftEntry',
              draft: parent,
              entry,
            });
          this.broadcastSide(gameId, side, state(book.get(command.draft)!));
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof DraftError)) throw e;
      this.send(conn, error(e.code, e.message));
      return;
    }
    this.saveDrafts(gameId, side, book);
  }

  /** Tell every connection of a side its marks. */
  private broadcastMarks(gameId: string, side: SideId, marks: readonly Mark[]): void {
    for (const c of this.conns.get(gameId) ?? [])
      if (c.side === side) this.send(c, { v: PROTOCOL_VERSION, kind: 'marks', marks: [...marks] });
  }

  /** Send to every open socket a user has in a game (on `side`, if given); returns how many were open. */
  sendToUser(gameId: string, userId: string, message: ServerMessage, side?: SideId): number {
    let n = 0;
    for (const c of this.conns.get(gameId) ?? []) {
      if (c.userId !== userId || c.socket.readyState !== OPEN) continue;
      if (side !== undefined && c.side !== side) continue;
      this.send(c, message);
      n++;
    }
    return n;
  }

  /** Number of open connections to a game. */
  count(gameId: string): number {
    return this.conns.get(gameId)?.size ?? 0;
  }

  /** Closes every socket a user has open, e.g. after they delete their account or log out everywhere. */
  disconnectUser(userId: string, reason = 'signed out'): void {
    for (const set of this.conns.values()) {
      for (const c of [...set]) if (c.userId === userId) c.socket.close(1008, reason);
    }
  }

  /** Serve one player's socket: send the initial view, then handle its commands. */
  attach(gameId: string, side: SideId, socket: Socket, userId?: string, seat?: Seat): void {
    const conn: Connection = {
      side,
      userId,
      seat,
      socket,
      lastView: '',
      lastClock: '',
      sentDispatches: new Set(),
      gameOverSent: false,
      lastPause: '',
      pauseSeen: this.lookup(gameId)?.pauseSteps.at(-1)?.n ?? 0,
    };
    const set = this.conns.get(gameId) ?? new Set();
    // A side with a connection already open is not away, so it gets no catch-up.
    const away = ![...set].some((c) => c.side === side);
    const seenKey = `${gameId}\0${side}`;
    const seenInMemory = this.seen.get(seenKey);
    set.add(conn);
    this.conns.set(gameId, set);
    const detach = () => {
      if (!set.delete(conn)) return;
      const at = this.seen.get(seenKey);
      if (at !== undefined && ![...set].some((c) => c.side === side)) {
        void this.store?.saveSeen(gameId, side, at).catch((e) => this.onError(gameId, e));
      }
      if (set.size === 0 && this.conns.get(gameId) === set) this.conns.delete(gameId);
    };
    socket.on('close', detach);
    socket.on('error', () => {
      detach();
      socket.close();
    });
    socket.on('message', (data, isBinary) => {
      void this.handle(gameId, conn, data, isBinary).catch((e) => {
        this.onError(gameId, e);
        this.send(conn, error('internal', 'the server could not handle that message'));
      });
    });
    const sinceP: Promise<number | undefined> = !away
      ? Promise.resolve(undefined)
      : seenInMemory !== undefined
        ? Promise.resolve(seenInMemory)
        : (this.store?.loadSeen(gameId, side) ?? Promise.resolve(undefined));
    this.push(gameId, conn);
    void sinceP
      .then((since) => this.sendCatchUp(gameId, conn, since))
      .catch((e) => this.onError(gameId, e));
    void this.draftsOf(gameId, side)
      .then((book) =>
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'drafts',
          drafts: structuredClone(book.toJSON()),
        }),
      )
      .catch((e) => this.onError(gameId, e));
    void this.marksOf(gameId, side)
      .then((marks) => this.send(conn, { v: PROTOCOL_VERSION, kind: 'marks', marks: [...marks] }))
      .catch((e) => this.onError(gameId, e));
  }

  /** Tell a returning side what arrived while it was away: dispatches delivered after its last visit. */
  private sendCatchUp(gameId: string, conn: Connection, since: number | undefined): void {
    const game = this.lookup(gameId);
    if (since === undefined || !game) return;
    const view = this.viewOf(gameId, game, conn);
    if (view.atGame <= since) return;
    const dispatchIds = view.dispatches.filter((d) => d.receivedAtGame > since).map((d) => d.id);
    this.send(conn, {
      v: PROTOCOL_VERSION,
      kind: 'catchUp',
      sinceGame: since,
      atGame: view.atGame,
      dispatchIds,
    });
  }

  /** The game changed (a tick or a command): bring every connection up to date. */
  notify(gameId: string): void {
    for (const conn of [...(this.conns.get(gameId) ?? [])]) this.push(gameId, conn);
  }

  /** Close every connection to a game. */
  closeGame(gameId: string, code = 1001, reason = 'game closed'): void {
    for (const conn of [...(this.conns.get(gameId) ?? [])]) conn.socket.close(code, reason);
    this.conns.delete(gameId);
  }

  /** Save the seen time of every side that still has a connection, so a restart does not lose it. */
  async flushSeen(): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const [gameId, set] of this.conns) {
      for (const side of new Set([...set].map((c) => c.side))) {
        const at = this.seen.get(`${gameId}\0${side}`);
        if (at !== undefined && this.store)
          saves.push(this.store.saveSeen(gameId, side, at).catch((e) => this.onError(gameId, e)));
      }
    }
    await Promise.all(saves);
  }

  closeAll(): void {
    for (const id of [...this.conns.keys()]) this.closeGame(id, 1001, 'server shutting down');
  }

  private send(conn: Connection, message: ServerMessage): void {
    if (conn.socket.readyState !== OPEN) return;
    conn.socket.send(serializeServerMessage(message));
  }

  private push(gameId: string, conn: Connection): void {
    const game = this.lookup(gameId);
    if (!game) return;
    try {
      const clock: ClockState = game.gameClock.snapshot();
      const view = this.viewOf(gameId, game, conn);
      this.seen.set(`${gameId}\0${conn.side}`, view.atGame);
      const clockJson = JSON.stringify(clock);
      if (clockJson !== conn.lastClock) {
        // The first push carries the clock inside the view.
        if (conn.lastClock !== '')
          this.send(conn, { v: PROTOCOL_VERSION, kind: 'clockState', clock });
        conn.lastClock = clockJson;
      }
      this.pushPause(gameId, game, conn);
      const first = conn.lastView === '';
      // Only while the game is still waiting on the confirm: later joiners must not be told it is paused.
      if (first && game.restart && clock.status === 'paused' && !game.state.world.outcome) {
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'serverRestarted',
          downMs: game.restart.downMs,
        });
      }
      for (const dispatch of view.dispatches) {
        if (conn.sentDispatches.has(dispatch.id)) continue;
        conn.sentDispatches.add(dispatch.id);
        // Papers already in the initial view are not pushed a second time.
        if (!first) this.send(conn, { v: PROTOCOL_VERSION, kind: 'dispatch', dispatch });
      }
      const viewJson = JSON.stringify(view);
      if (viewJson !== conn.lastView) {
        conn.lastView = viewJson;
        this.send(conn, { v: PROTOCOL_VERSION, kind: 'viewUpdate', view });
      }
      // The outcome is public, so it is the same for both sides; it follows the final view.
      const outcome = game.state.world.outcome;
      if (outcome && !conn.gameOverSent) {
        conn.gameOverSent = true;
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'gameOver',
          winner: outcome.winner,
          reason: outcome.reason,
          atGame: outcome.time,
        });
      }
    } catch (e) {
      this.onError(gameId, e);
    }
  }

  /** Tell a connection how the pause vote stands and what was settled since it last looked. */
  private pushPause(gameId: string, game: GameActor, conn: Connection): void {
    const state = game.pauseState;
    if (!state) return;
    const steps = game.pauseSteps.filter((s) => s.n > conn.pauseSeen);
    for (const { n, step } of steps) {
      conn.pauseSeen = n;
      const result = pauseResultOf(step);
      if (!result) continue;
      const bySide = step.by === undefined ? undefined : this.sideOf(gameId, step.by);
      this.send(conn, {
        v: PROTOCOL_VERSION,
        kind: 'pauseResult',
        ...result,
        ...(bySide === undefined ? {} : { bySide }),
      });
    }
    const open = state.proposal;
    let proposal: PauseProposal | undefined;
    if (open) {
      const votes = Object.values(open.votes);
      const mine = conn.userId === undefined ? undefined : open.votes[conn.userId];
      const bySide = this.sideOf(gameId, open.by);
      proposal = {
        id: open.id,
        kind: state.phase === 'resume_proposed' ? 'resume' : 'pause',
        ...(bySide === undefined ? {} : { bySide }),
        byYou: conn.userId !== undefined && open.by === conn.userId,
        ...(open.reason === undefined ? {} : { reason: open.reason }),
        yes: votes.filter((v) => v).length,
        no: votes.filter((v) => !v).length,
        voters: state.voters,
        ...(mine === undefined ? {} : { myVote: mine }),
        msLeft: Math.max(0, open.deadlineMs - state.nowMs),
      };
    }
    // The countdown changes every push, so only the rest decides whether anything is new.
    const key = JSON.stringify([state.phase, proposal && { ...proposal, msLeft: 0 }]);
    if (key === conn.lastPause) return;
    conn.lastPause = key;
    this.send(conn, {
      v: PROTOCOL_VERSION,
      kind: 'pauseState',
      phase: state.phase,
      ...(proposal ? { proposal } : {}),
    });
  }

  /** HQ passes a paper in its own view on to the subordinate commanding `unit`. */
  /**
   * Have the staff stage write the answer to a question the desk just accepted. The client holds it
   * back until the officer's cost has elapsed. With no umpire, or no usable reply, the message carries
   * no text and the client answers from its own view.
   */
  private async answerStaff(
    game: GameActor,
    conn: Connection,
    command: Extract<Command, { kind: 'askStaff' }>,
  ): Promise<void> {
    let answer;
    try {
      answer = await game.answerStaff(conn.side, command.role, command.question);
    } catch (e) {
      answer = undefined;
      this.onError(game.id, e);
    }
    const fallback = staffOfficer(game.state.world.seed, conn.side, 'chiefOfStaff');
    this.send(conn, {
      v: PROTOCOL_VERSION,
      kind: 'staffAnswer',
      questionId: command.questionId,
      role: command.role,
      ...(answer ? { text: answer.text } : {}),
      basedOnGame: answer?.basedOnGame ?? game.state.time,
      officer: answer
        ? { name: answer.officer.name, traits: answer.officer.traits }
        : { name: fallback.name, traits: fallback.traits },
    });
  }

  private handleForward(
    gameId: string,
    game: GameActor,
    conn: Connection,
    command: Extract<Command, { kind: 'forwardDispatch' }>,
  ): void {
    if (!conn.seat || !mayForward(conn.seat)) {
      this.send(conn, error('not_permitted', 'only the commander or chief of staff can forward'));
      return;
    }
    const world = game.state.world;
    const unit = world.units.find((u) => u.id === command.unit);
    if (!unit || unit.side !== conn.side || unit.strength <= 0) {
      this.send(conn, error('bad_unit', 'that is not one of your living formations'));
      return;
    }
    // Only a paper the forwarder can see themselves can be passed on.
    const mine = viewForRole(world, conn.side, conn.seat, game.state.time);
    const known = [...mine.reports, ...mine.documents].some((p) => p.id === command.dispatchId);
    if (!known) {
      this.send(conn, error('no_such_dispatch', 'you hold no such paper'));
      return;
    }
    const already = this.forwardsOf(gameId).some(
      (f) => f.side === conn.side && f.unit === command.unit && f.dispatchId === command.dispatchId,
    );
    if (!already) {
      const forward = { side: conn.side, dispatchId: command.dispatchId, unit: command.unit };
      this.forwards.add(gameId, forward);
      this.forwardsOf(gameId).push(forward);
      this.notify(gameId);
    }
  }

  private async handlePauseCommand(
    game: GameActor,
    conn: Connection,
    command: Extract<Command, { kind: 'proposePause' | 'proposeResume' | 'vote' }>,
  ): Promise<void> {
    if (!game.pauseState) {
      this.send(conn, error('pause_unavailable', 'this game has no pause voting'));
      return;
    }
    if (conn.userId === undefined) {
      this.send(conn, error('not_a_voter', 'sign in to vote on a pause'));
      return;
    }
    const by = conn.userId;
    let result;
    try {
      if (command.kind === 'vote') {
        result = await game.submit({
          kind: 'vote',
          by,
          proposal: command.proposal,
          yes: command.yes,
        });
      } else if (command.kind === 'proposeResume') {
        result = await game.submit({ kind: 'proposeResume', by });
      } else {
        const reason = command.reason?.trim();
        result = await game.submit({ kind: 'proposePause', by, ...(reason ? { reason } : {}) });
      }
    } catch (e) {
      this.send(conn, error('game_closed', e instanceof Error ? e.message : 'game is closed'));
      return;
    }
    if (result.ok) return;
    // The machine's messages name the player; the client gets fixed wording instead.
    const text = result.kind === 'rejection' ? result.reason : '';
    if (/not a voter/.test(text)) {
      this.send(conn, error('not_a_voter', 'you do not vote in this game'));
    } else if (/already voted/.test(text)) {
      this.send(conn, error('pause_refused', 'you have already voted on that'));
    } else {
      this.send(conn, error('pause_refused', 'that vote is closed or cannot be started now'));
    }
  }

  private async handle(
    gameId: string,
    conn: Connection,
    data: unknown,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      this.send(conn, error('bad_message', 'messages must be JSON text'));
      return;
    }
    const parsed = parseCommand(String(data));
    if (!parsed.ok) {
      this.send(conn, error('bad_message', parsed.error));
      return;
    }
    const game = this.lookup(gameId);
    if (!game) {
      this.send(conn, error('game_closed', 'this game is no longer running'));
      return;
    }
    const command = parsed.value;
    if (command.kind === 'putMark' || command.kind === 'deleteMark') {
      // Marks are the player's own picture: stored as sent, never checked against the game.
      const list = await this.marksOf(gameId, conn.side);
      if (command.kind === 'putMark') {
        const i = list.findIndex((m) => m.id === command.mark.id);
        if (i < 0 && list.length >= MAX_MARKS) {
          this.send(conn, error('too_many_marks', `a side may keep at most ${MAX_MARKS} marks`));
          return;
        }
        if (i < 0) list.push(command.mark);
        else list[i] = command.mark;
      } else {
        const i = list.findIndex((m) => m.id === command.markId);
        if (i >= 0) list.splice(i, 1);
      }
      this.saveMarks(gameId, conn.side, list);
      this.broadcastMarks(gameId, conn.side, list);
      return;
    }
    if (
      command.kind === 'createDraft' ||
      command.kind === 'draftEdit' ||
      command.kind === 'draftComment' ||
      command.kind === 'resolveComment' ||
      command.kind === 'readDraft' ||
      command.kind === 'syncDrafts' ||
      command.kind === 'forkDraft' ||
      command.kind === 'mergeDraft'
    ) {
      await this.handleDraftCommand(gameId, conn, command);
      return;
    }
    if (
      command.kind === 'proposePause' ||
      command.kind === 'proposeResume' ||
      command.kind === 'vote'
    ) {
      await this.handlePauseCommand(game, conn, command);
      return;
    }
    if (command.kind === 'forwardDispatch') {
      this.handleForward(gameId, game, conn, command);
      return;
    }
    if (command.kind === 'askStaff') {
      if (game.state.world.outcome) {
        this.send(conn, error('game_over', `${command.questionId}: the game has ended`));
        return;
      }
      const charge = this.staffDesk.ask(gameId, conn.side, command.role, game.gameClock.now());
      if (charge.ok) {
        this.send(conn, {
          v: PROTOCOL_VERSION,
          kind: 'staffQueued',
          questionId: command.questionId,
          role: command.role,
          askedAtGame: charge.askedAtGame,
          answerAtGame: charge.answerAtGame,
          costMs: charge.costMs,
        });
        void this.answerStaff(game, conn, command);
      } else {
        this.send(
          conn,
          error(
            'staff_busy',
            `${command.questionId}: that officer is still answering your last question`,
          ),
        );
      }
      return;
    }
    if (command.kind !== 'issueOrder') {
      this.send(conn, error('not_implemented', `${command.kind} is not supported yet`));
      return;
    }
    // The client disables the order box once the game ends, but the guarantee belongs here:
    // an order queued into a finished game could still be parsed (at model cost) and logged.
    if (game.state.world.outcome) {
      this.send(conn, error('game_over', `${command.orderId}: the game has ended`));
      return;
    }
    if (command.text === undefined) {
      this.send(conn, error('not_implemented', 'order drafts are not supported yet; send text'));
      return;
    }
    // Only the commander and subordinate commanders sign. Whether a subordinate may sign for the
    // addressee is checked by the actor once the parse names it.
    if (conn.seat && conn.seat.role !== 'commander' && conn.seat.role !== 'subordinate') {
      this.send(conn, error('not_permitted', 'staff officers draft orders; the commander signs'));
      return;
    }
    let result;
    try {
      result = await game.submit({
        kind: 'order',
        side: conn.side,
        text: command.text,
        ...(conn.seat ? { signer: conn.seat } : {}),
        ...(command.courier ? { courier: command.courier } : {}),
      });
    } catch (e) {
      this.send(conn, error('game_closed', e instanceof Error ? e.message : 'game is closed'));
      return;
    }
    if (result.ok) return;
    if (result.kind === 'clarification') {
      const options = result.options?.length ? ` (${result.options.join(', ')})` : '';
      this.send(
        conn,
        error('order_clarification', `${command.orderId}: ${result.question}${options}`),
      );
    } else {
      this.send(conn, error('order_rejected', `${command.orderId}: ${result.reason}`));
    }
  }
}
