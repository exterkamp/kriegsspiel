/** What the shell may do to the running game screen. The live client registers itself here once it has connected. */
export interface GameHandle {
  /** Stop reconnecting and close the socket. The game itself keeps running on the server. */
  disconnect(): void;
}

let current: GameHandle | undefined;

export const registerGame = (h: GameHandle | undefined): void => {
  current = h;
};

/** Closes the game's connection cleanly, if there is one. Safe to call twice. */
export function disconnectGame(): void {
  current?.disconnect();
  current = undefined;
}
