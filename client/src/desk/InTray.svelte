<script lang="ts">
  import { formatGameTime } from '../net/state.js';
  import { PILES, sortTray, type Pile } from './tray.js';
  import { discard, gameState, markRead, setFiled, showOnTable, trayMarks, activeView } from './store.js';

  let pile = $state<Pile>('urgent');
  let openId = $state<string | undefined>(undefined);
  let showFiled = $state(false);

  const sorted = $derived(sortTray($gameState.dispatches, $trayMarks));
  const current = $derived(sorted.piles.find((p) => p.id === pile)!);
  const list = $derived(showFiled ? sorted.filed : current.items);
  const open = $derived(list.find((d) => d.id === openId));

  function pick(id: Pile): void {
    pile = id;
    showFiled = false;
    openId = undefined;
  }
  function openDispatch(id: string): void {
    openId = id;
    markRead(id);
  }
  /** Move the viewer on to the next paper in the pile once this one is gone. */
  function after(id: string): void {
    const i = list.findIndex((d) => d.id === id);
    openId = list[i + 1]?.id ?? list[i - 1]?.id;
  }
  function onFile(id: string, on: boolean): void {
    after(id);
    setFiled(id, on);
  }
  function onDiscard(id: string): void {
    after(id);
    discard(id);
  }
  function locate(): void {
    if (!open?.location) return;
    showOnTable.set(open.location);
    activeView.set('table');
  }
</script>

<div class="tray">
  <h2>In-tray</h2>
  <div class="piles" role="group" aria-label="Piles">
    {#each sorted.piles as p (p.id)}
      <button
        type="button"
        class="pile"
        aria-pressed={!showFiled && pile === p.id}
        onclick={() => pick(p.id)}
      >
        {p.label} <span class="n">{p.items.length}</span>
        {#if p.unread > 0}<span class="unread-dot" aria-label="{p.unread} unread">●{p.unread}</span>{/if}
      </button>
    {/each}
    <button
      type="button"
      class="pile"
      aria-pressed={showFiled}
      onclick={() => {
        showFiled = true;
        openId = undefined;
      }}>Filed <span class="n">{sorted.filed.length}</span></button
    >
  </div>

  <div class="cols">
    <ul class="list" aria-label={showFiled ? 'Filed dispatches' : `${current.label} dispatches`}>
      {#each list as d (d.id)}
        {@const unread = !$gameState.read.has(d.id)}
        <li>
          <button
            type="button"
            class="row"
            class:unread
            aria-current={openId === d.id}
            onclick={() => openDispatch(d.id)}
          >
            <b>{unread ? '● ' : ''}{d.from}</b>
            <small>received {formatGameTime(d.receivedAtGame)}</small>
          </button>
        </li>
      {:else}
        <li class="empty">Nothing here.</li>
      {/each}
    </ul>

    <article class="viewer" aria-live="polite">
      {#if open}
        <h3>{open.from}</h3>
        <dl>
          <dt>Written</dt>
          <dd>{formatGameTime(open.writtenAtGame)}</dd>
          <dt>Received</dt>
          <dd>{formatGameTime(open.receivedAtGame)}</dd>
        </dl>
        <p class="text">{open.text}</p>
        {#if open.location || open.unit || open.sizeEstimate}
          <aside class="sketch" aria-label="Attached sketch">
            <b>Sketch</b>
            {#if open.unit}<span>Unit: {open.unit}</span>{/if}
            {#if open.sizeEstimate}<span>Strength: {open.sizeEstimate}</span>{/if}
            {#if open.location}
              <button type="button" onclick={locate}>Show on table</button>
            {/if}
          </aside>
        {/if}
        <div class="actions">
          {#if showFiled}
            <button type="button" onclick={() => onFile(open.id, false)}>Return to pile</button>
          {:else}
            <button type="button" onclick={() => onFile(open.id, true)}>File</button>
          {/if}
          <button type="button" onclick={() => onDiscard(open.id)}>Discard</button>
        </div>
      {:else}
        <p class="empty">Select a dispatch to read it.</p>
      {/if}
    </article>
  </div>
</div>

<style>
  h2 {
    margin: 0 0 8px;
  }
  .piles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 4px 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #c9a95c;
    font-weight: bold;
  }
  button:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .n {
    opacity: 0.65;
  }
  .unread-dot {
    color: #a83232;
    font-size: 11px;
    margin-left: 2px;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 12px;
  }
  @media (max-width: 600px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
    .list {
      max-height: 22vh;
    }
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 40vh;
    overflow: auto;
  }
  .row {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-top: 1px solid #cbbf9b;
    border-radius: 0;
    padding: 4px 2px;
    color: inherit;
  }
  .row.unread {
    font-weight: bold;
  }
  .row[aria-current='true'] {
    background: #e7dcb4;
  }
  .row small {
    display: block;
    opacity: 0.75;
    font-weight: normal;
  }
  .viewer h3 {
    margin: 0 0 4px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 8px;
    margin: 0 0 8px;
    font-size: 13px;
  }
  dt {
    opacity: 0.7;
  }
  dd {
    margin: 0;
  }
  .text {
    white-space: pre-wrap;
    margin: 0 0 8px;
  }
  .sketch {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: center;
    border: 1px dashed #5a4a36;
    padding: 6px;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .empty {
    opacity: 0.6;
    font-style: italic;
    list-style: none;
  }
</style>
