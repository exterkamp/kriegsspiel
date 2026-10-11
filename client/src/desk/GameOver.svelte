<script lang="ts">
  import { fetchGame } from '../lobby/api.js';
  import { fetchWindowAt } from '../window/api.js';
  import { activeView, gameId, gameState, windowOpen } from './store.js';
  import {
    HEADLINE,
    lossesBetween,
    reasonText,
    replayRequest,
    resultFor,
    summaryLines,
  } from './gameOver.js';

  let {
    onMenu,
    onNewGame,
    onPlayAgain,
  }: {
    onMenu: () => void;
    onNewGame: () => void;
    onPlayAgain: (id: string, side: string | undefined) => void;
  } = $props();

  const over = $derived($gameState.gameOver!);
  const side = $derived($gameState.view?.side);
  const result = $derived(resultFor(over, side));
  let losses = $state<{ own: number; enemy: number } | undefined>();
  $effect(() => {
    const game = $gameId;
    const s = side;
    if (!game || !s) return;
    const end = over.atGame;
    Promise.all([fetchWindowAt(game, 0, s), fetchWindowAt(game, end, s)])
      .then(([a, b]) => (losses = lossesBetween(a, b, s)))
      .catch(() => {});
  });
  let firstButton = $state<HTMLButtonElement>();
  $effect(() => firstButton?.focus());
  let busy = $state(false);
  let error = $state('');

  async function playAgain(): Promise<void> {
    const game = $gameId;
    if (!game || busy) return;
    busy = true;
    error = '';
    try {
      const info = await fetchGame(game);
      const res = await fetch('/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(replayRequest(info, side ?? info.side ?? undefined)),
      });
      if (!res.ok) throw new Error(`could not create a game (${res.status})`);
      onPlayAgain(((await res.json()) as { id: string }).id, side ?? info.side ?? undefined);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
    }
  }

  function journal(): void {
    activeView.set('journal');
  }
</script>

<div
  class="over"
  class:victory={result === 'victory'}
  aria-labelledby="over-h"
  aria-modal="true"
  role="dialog"
>
  <h2 id="over-h">{HEADLINE[result]}</h2>
  <p class="reason">{reasonText(over)}</p>
  <ul>
    {#each summaryLines(over, losses) as line (line)}<li>{line}</li>{/each}
  </ul>
  <div class="row">
    <button type="button" bind:this={firstButton} onclick={() => windowOpen.set(true)}
      >View the umpire's window</button
    >
    <button type="button" onclick={journal}>Read the journal</button>
  </div>
  <div class="row">
    <button type="button" disabled={busy} onclick={playAgain}>Play again</button>
    <button type="button" onclick={onNewGame}>New game</button>
    <button type="button" onclick={onMenu}>Main menu</button>
  </div>
  {#if error}<p role="alert" class="err">{error}</p>{/if}
</div>

<style>
  .over {
    position: fixed;
    left: 50%;
    top: 12%;
    transform: translateX(-50%);
    width: min(460px, calc(100% - 16px));
    box-sizing: border-box;
    padding: 18px 22px;
    background: #f4eedb;
    color: #2a2014;
    border-radius: 2px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
    z-index: 6;
    text-align: center;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 28px;
  }
  .victory h2 {
    color: #2f6b2f;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 8px;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .err {
    color: #a83232;
  }
</style>
