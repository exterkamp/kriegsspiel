<script lang="ts">
  import { onMount } from 'svelte';
  import type { WindowTimeline } from '@kriegsspiel/protocol';
  import { fetchWindowAt, fetchWindowTimeline } from '../window/api.js';
  import { stepMark, unitNotes, type BeliefChoice } from '../window/model.js';
  import { formatGameTime } from '../net/state.js';
  import { gameId, windowBelief, windowFrame, windowHover, windowOpen } from './store.js';

  let timeline = $state<WindowTimeline | undefined>();
  let at = $state(0);
  let error = $state('');
  let ticket = 0;

  async function load(ms: number): Promise<void> {
    const game = $gameId;
    if (!game) return;
    const mine = ++ticket;
    try {
      const frame = await fetchWindowAt(game, ms);
      if (mine !== ticket) return;
      at = frame.gameMs;
      error = '';
      windowFrame.set(frame);
    } catch (e) {
      if (mine === ticket) error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    const game = $gameId;
    if (game)
      fetchWindowTimeline(game)
        .then((tl) => {
          timeline = tl;
          return load(tl.endMs);
        })
        .catch((e) => {
          error = e instanceof Error ? e.message : String(e);
        });
    return () => {
      ticket++;
      windowFrame.set(undefined);
      windowHover.set(undefined);
    };
  });

  function step(dir: 1 | -1): void {
    if (!timeline) return;
    const i = stepMark(timeline.marks, at, dir);
    void load(i >= 0 ? timeline.marks[i]!.ms : dir > 0 ? timeline.endMs : 0);
  }

  const BELIEFS: { id: BeliefChoice; label: string }[] = [
    { id: 'none', label: 'Truth only' },
    { id: 'blue', label: 'Blue believed' },
    { id: 'red', label: 'Red believed' },
  ];

  const notes = $derived(
    $windowFrame && $windowHover ? unitNotes($windowFrame, $windowHover) : [],
  );
  const hovered = $derived($windowFrame?.units.find((u) => u.id === $windowHover));
</script>

<section id="umpire-window" class="window" aria-label="Umpire's window">
  <header>
    <h2>Umpire's window</h2>
    <button type="button" onclick={() => windowOpen.set(false)}>Close</button>
  </header>
  {#if error}
    <p role="alert">{error === 'game_not_over' ? 'Available once the game has ended.' : error}</p>
  {:else if !timeline}
    <p role="status">Rebuilding the game from its log…</p>
  {:else}
    <p class="outcome">
      {timeline.outcome.winner ? `${timeline.outcome.winner} won` : 'No winner'}: {timeline.outcome.reason},
      at {formatGameTime(timeline.outcome.time)}
    </p>
    <div class="scrub">
      <button type="button" aria-label="Previous event" onclick={() => step(-1)}>◀</button>
      <input
        type="range"
        min="0"
        max={timeline.endMs}
        step="60000"
        value={at}
        aria-label="Game time"
        aria-valuetext={formatGameTime(at)}
        oninput={(e) => (at = Number(e.currentTarget.value))}
        onchange={(e) => void load(Number(e.currentTarget.value))}
      />
      <button type="button" aria-label="Next event" onclick={() => step(1)}>▶</button>
      <output>{formatGameTime(at)}</output>
    </div>
    <fieldset>
      <legend>Overlay</legend>
      {#each BELIEFS as b (b.id)}
        <label><input type="radio" name="belief" value={b.id} bind:group={$windowBelief} /> {b.label}</label>
      {/each}
    </fieldset>
    <div class="hover" aria-live="polite">
      {#if hovered}
        <b>{hovered.name}</b>
        ({hovered.side}) strength {Math.round(hovered.strength)}, morale {Math.round(hovered.morale)}
        {#if notes.length === 0}<p>No fire or rulings in the last 30 minutes.</p>
        {:else}<ul>{#each notes as n, i (i)}<li>{n}</li>{/each}</ul>{/if}
      {:else}
        <p>Point at a unit on the table for its dice, modifiers and rulings.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .window {
    position: fixed;
    left: 8px;
    top: 8px;
    width: min(360px, calc(100% - 16px));
    max-height: 60%;
    overflow: auto;
    box-sizing: border-box;
    padding: 10px 14px;
    background: #f4eedb;
    color: #2a2014;
    border-radius: 2px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    z-index: 6;
    font-size: 13px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .scrub {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .scrub input {
    flex: 1;
    min-width: 0;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 8px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  legend {
    font-weight: bold;
  }
  ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 4px 8px;
    font: inherit;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 3px solid #ffd76a;
  }
</style>
