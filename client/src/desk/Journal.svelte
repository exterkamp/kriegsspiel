<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { gameState, journal, addNote } from './store.js';
  import { deliveryStatus } from './orders.js';
  import { formatGameTime, gameNowMs } from '../net/state.js';
  import {
    JOURNAL_KINDS,
    chronological,
    exportText,
    filterEntries,
    type JournalKind,
  } from './journal.js';

  let query = $state('');
  const kinds = new SvelteSet<JournalKind>();
  let note = $state('');

  // Delivery status is read against game time, so the journal re-reads it now and then.
  let wall = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (wall = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const nowGame = $derived($gameState.clock ? gameNowMs($gameState.clock, wall) : 0);

  const shown = $derived(chronological(filterEntries($journal, { query, kinds })));

  /** Delivery progress for an order still riding; the saved line alone has no ride to show. */
  function ride(id: string) {
    const p = $gameState.pending.find((o) => `order:${o.orderId}` === id);
    if (!p) return undefined;
    const s = deliveryStatus(p, nowGame);
    return { progress: p.etaGame === undefined ? undefined : s.fraction, label: s.label };
  }

  function toggle(k: JournalKind): void {
    if (!kinds.delete(k)) kinds.add(k);
  }

  function addNoteNow(e: Event): void {
    e.preventDefault();
    addNote(note);
    note = '';
  }

  function download(): void {
    const blob = new Blob([exportText($journal)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'war-diary.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<h2>Journal</h2>

<form class="note" onsubmit={addNoteNow}>
  <label for="journal-note">Add a note</label>
  <textarea id="journal-note" rows="2" bind:value={note}></textarea>
  <button type="submit" id="journal-add" disabled={note.trim() === ''}>Write in diary</button>
</form>

<div class="tools">
  <label for="journal-search">Search</label>
  <input id="journal-search" type="search" bind:value={query} />
  {#each JOURNAL_KINDS as k (k.id)}
    <button type="button" aria-pressed={kinds.has(k.id)} onclick={() => toggle(k.id)}>
      {k.label}
    </button>
  {/each}
  <button type="button" id="journal-export" onclick={download} disabled={$journal.length === 0}>
    Export as text
  </button>
</div>

{#if $journal.length === 0}
  <p>Nothing recorded yet.</p>
{:else if shown.length === 0}
  <p>No entries match.</p>
{:else}
  <ul>
    {#each shown as j (j.id)}
      {@const r = j.kind === 'order' ? ride(j.id) : undefined}
      <li data-kind={j.kind}>
        <small>{formatGameTime(j.at)}</small>
        {j.text}
        {#if r}
          <div class="delivery">
            {#if r.progress !== undefined}<progress
                max="1"
                value={r.progress}
                aria-label="Delivery progress"
              ></progress>{/if}
            <small>{r.label}</small>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .note,
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .note textarea {
    flex: 1 1 100%;
    font: inherit;
  }
  button {
    font: inherit;
    font-size: 13px;
    padding: 3px 8px;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    background: #efe6c8;
    color: #2a2118;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #c9a95c;
    font-weight: bold;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .delivery {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 2px 0 6px;
  }
  .delivery progress {
    width: 8em;
  }
  ul {
    margin: 0;
    padding-left: 18px;
  }
</style>
