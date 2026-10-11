<script lang="ts">
  import { activeView, gameState, showOnTable } from './store.js';
  import { formatAge, rosterRows } from './roster.js';
  import { formatGameTime, gameNowMs } from '../net/state.js';

  // Aging is read against game time, so the roster re-reads it now and then.
  let wall = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (wall = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const nowGame = $derived(
    $gameState.clock ? gameNowMs($gameState.clock, wall) : ($gameState.view?.atGame ?? 0),
  );
  const rows = $derived(rosterRows($gameState.view, nowGame));

  function focus(r: (typeof rows)[number]): void {
    showOnTable.set(r.position);
    activeView.set('table');
  }
</script>

<h2>Order of battle</h2>
{#if rows.length === 0}
  <p>No formations reported yet.</p>
{:else}
  <table class="roster">
    <thead>
      <tr><th>Formation</th><th>Strength</th><th>Supply</th><th>Morale</th><th>Reported</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.id)}
        <tr class={r.freshness} data-unit={r.id}>
          <th scope="row">
            <button type="button" onclick={() => focus(r)} aria-label="Show {r.name} on the table"
              >{r.name}</button
            >
          </th>
          <td class:unknown={r.strength === undefined}>{r.strength ?? 'unknown'}</td>
          <td class:unknown={r.supply === undefined}
            >{r.supply === undefined ? 'unknown' : `${r.supply}%`}</td
          >
          <td class:unknown={r.morale === undefined}
            >{r.morale === undefined ? 'unknown' : `${r.morale}%`}</td
          >
          <td>
            {formatGameTime(r.reportedAt)}
            <small class="age"
              >{formatAge(r.ageMs)} old{r.freshness === 'fresh' ? '' : ` (${r.freshness})`}</small
            >
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .roster {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid #c9bb94;
  }
  th[scope='row'] {
    font-weight: normal;
  }
  .roster button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #2a2118;
    text-decoration: underline;
    cursor: pointer;
  }
  .roster button:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .unknown {
    font-style: italic;
    opacity: 0.7;
  }
  .age {
    display: block;
  }
  tr.aging {
    opacity: 0.85;
  }
  /* Floor of 0.75 keeps the dark text readable on paper; the unknown fade does not stack on it. */
  tr.stale {
    opacity: 0.75;
  }
  tr.stale .unknown {
    opacity: 1;
  }
  tr.stale .age {
    font-weight: bold;
  }
</style>
