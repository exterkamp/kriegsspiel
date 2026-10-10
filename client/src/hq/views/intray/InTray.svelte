<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { HqSnapshot, Scope, Result, Paper } from '../../contracts';
  import { createInTrayStore, sameScope, type StoragePort, type PaperStatus } from './store';
  import { categories, collectPapers, gameDate } from './papers';
  let {
    snapshot,
    scope,
    storageFactory,
    onPlotPaper,
  }: {
    snapshot: HqSnapshot | null;
    scope: Scope;
    storageFactory?: () => StoragePort;
    onPlotPaper?: (paperId: string) => Promise<Result<void>>;
  } = $props();
  const fixedScope = untrack(() => Object.freeze({ ...scope }));
  const store = untrack(() => createInTrayStore(fixedScope, storageFactory));
  let ui = $state(store.getState());
  const unsubscribe = store.subscribe((next) => {
    ui = next;
  });
  let alive = true;
  let openedId = $state<string | null>(null);
  let category = $state<string>('all');
  let disposition = $state('active');
  let search = $state('');
  let notice = $state('');
  let discard = $state(false);
  let exportText = $state<string | null>(null);
  let exportDirty = $state(false);
  let plotting = $state(false);
  const scopeValid = $derived(
    sameScope(scope, fixedScope) && (!snapshot || sameScope(snapshot.scope, fixedScope)),
  );
  const collected = $derived(collectPapers(scopeValid ? (snapshot?.papers ?? []) : []));
  const statuses = $derived(new Map(ui.document?.records.map((r) => [r.paperId, r.status]) ?? []));
  const opened = $derived(collected.papers.find((p) => p.id === openedId) ?? null);
  const mutable = $derived(scopeValid && ui.writable && !ui.busy);
  const statusOf = (p: Paper): PaperStatus | null =>
    ui.document ? (statuses.get(p.id) ?? 'unread') : null;
  const pileOf = (p: Paper) => {
    const s = statusOf(p);
    return s === 'filed' || s === 'discarded' ? s : 'active';
  };
  const unread = $derived(
    ui.document ? collected.papers.filter((p) => statusOf(p) === 'unread').length : null,
  );
  const visible = $derived(
    collected.papers.filter(
      (p) =>
        (category === 'all' || p.category === category) &&
        pileOf(p) === disposition &&
        `${p.from} ${p.text} ${p.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
  );
  async function report(operation: Promise<Result<void>>, success: string) {
    const result = await operation;
    if (alive) notice = result.ok === true ? success : result.error.message;
  }
  void report(store.load(), 'Saved state loaded.');
  function open(p: Paper) {
    openedId = p.id;
    const status = statusOf(p);
    if (!mutable) {
      notice = 'Paper opened. Read-state was not saved: storage is unavailable or busy.';
      return;
    }
    if (status === 'unread') void report(store.update(p.id, 'read'), 'Read-state saved.');
    else notice = 'Paper opened; its disposition is unchanged.';
  }
  function change(status: PaperStatus) {
    if (!opened || !mutable) return;
    void report(store.update(opened.id, status), 'Disposition saved.');
  }
  async function plot() {
    if (!opened?.location || !onPlotPaper || plotting || !scopeValid) return;
    plotting = true;
    notice = 'Plotting paper…';
    try {
      const result = await onPlotPaper(opened.id);
      if (alive) notice = result.ok === true ? 'Paper plotted.' : result.error.message;
    } catch {
      if (alive) notice = 'Plot callback failed. Paper remains open.';
    } finally {
      if (alive) plotting = false;
    }
  }
  async function reload() {
    if (ui.dirty && !discard) return;
    await report(store.load(discard), 'Saved state reloaded.');
    if (alive) discard = false;
  }
  onDestroy(() => {
    alive = false;
    unsubscribe();
    store.dispose();
  });
</script>

<section class="intray" aria-label="In-tray">
  <h1>In-tray</h1>
  <p>Fixture papers — local reading and filing state only.</p>
  <p role="status" aria-live="polite">
    {!scopeValid
      ? 'Scope mismatch. Remount the in-tray for this scope.'
      : (ui.error?.message ?? notice)}
  </p>
  <p>
    {ui.busy
      ? 'Storage busy.'
      : ui.dirty
        ? 'Unsaved local changes.'
        : ui.document && ui.writable
          ? 'Local state saved.'
          : 'Persisted read-state unavailable.'} Unread: {unread === null ||
    (!ui.writable && !ui.dirty)
      ? 'unavailable'
      : unread}
  </p>
  {#if collected.conflicts || collected.invalid}<p role="alert">
      Excluded {collected.conflicts} conflicting paper IDs and {collected.invalid} invalid papers.
    </p>{/if}
  <nav aria-label="Category piles">
    <button aria-pressed={category === 'all'} onclick={() => (category = 'all')}>All papers</button>
    {#each categories as name (name)}<button
        aria-pressed={category === name}
        onclick={() => (category = name)}
        >{name} ({collected.papers.filter((p) => p.category === name && pileOf(p) === disposition)
          .length})</button
      >{/each}
  </nav>
  <nav aria-label="Disposition piles">
    {#each ['active', 'filed', 'discarded'] as name (name)}<button
        aria-pressed={disposition === name}
        onclick={() => (disposition = name)}>{name}</button
      >{/each}
  </nav>
  <label>Search papers <input type="search" bind:value={search} /></label>
  <h2>Arrivals — newest received first</h2>
  {#if !visible.length}<p>No supplied papers in this pile.</p>{/if}
  <ol>
    {#each visible as paper (paper.id)}
      <li>
        <button onclick={() => open(paper)}>Open {paper.id} — {paper.from}</button>
        <span
          >{gameDate(paper.receivedAtGame)} · {ui.writable || ui.dirty
            ? (statusOf(paper) ?? 'Read-state unavailable')
            : 'Read-state unavailable'}</span
        >
      </li>
    {/each}
  </ol>
  {#if opened}
    <article aria-label="Opened paper" tabindex="-1">
      <h2>Paper {opened.id}</h2>
      <dl>
        <dt>From</dt>
        <dd>{opened.from}</dd>
        <dt>Category</dt>
        <dd>{opened.category}</dd>
        <dt>Written at</dt>
        <dd>{gameDate(opened.writtenAtGame)}</dd>
        <dt>Received at</dt>
        <dd>{gameDate(opened.receivedAtGame)}</dd>
        <dt>Observed at</dt>
        <dd>{gameDate(opened.observedAtGame)}</dd>
        <dt>Location</dt>
        <dd>{opened.location ? `${opened.location.x}, ${opened.location.y} metres` : 'Unknown'}</dd>
        <dt>Unit</dt>
        <dd>{opened.unitId ?? 'Unknown'}</dd>
        <dt>Size estimate</dt>
        <dd>{opened.sizeEstimate ?? 'Unknown'}</dd>
        <dt>Confidence</dt>
        <dd>{opened.confidence ?? 'Unknown'}</dd>
      </dl>
      <p class="body">{opened.text}</p>
      <p>Attachments and sketches unavailable.</p>
      <button disabled={!mutable} onclick={() => change('filed')}>File</button>
      <button disabled={!mutable} onclick={() => change('discarded')}>Discard</button>
      {#if statusOf(opened) === 'filed' || statusOf(opened) === 'discarded'}<button
          disabled={!mutable}
          onclick={() => change('read')}>Restore to active</button
        >{/if}
      <button disabled={!scopeValid || !opened.location || !onPlotPaper || plotting} onclick={plot}
        >Plot paper</button
      >
    </article>
  {/if}
  <h2>Local state</h2>
  <button
    disabled={!mutable || !ui.dirty}
    onclick={() => report(store.save(), 'Local state saved.')}>Retry save</button
  >
  <button
    disabled={!ui.document}
    onclick={() => {
      exportText = JSON.stringify(ui.document, null, 2);
      exportDirty = ui.dirty;
    }}>Export JSON</button
  >
  {#if exportText !== null}<label
      >Local state JSON ({exportDirty
        ? 'includes unsaved changes'
        : 'loaded or saved state'})<textarea readonly value={exportText}></textarea></label
    >{/if}
  {#if ui.dirty}<label
      ><input type="checkbox" bind:checked={discard} /> Discard unsaved changes on reload</label
    >{/if}
  <button disabled={ui.busy || (ui.dirty && !discard) || !scopeValid} onclick={reload}
    >Reload saved state</button
  >
</section>

<style>
  .intray {
    color: var(--ink, #231b12);
    background: var(--paper, #fff8e7);
    padding: 1.5rem;
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1.5;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-block: 1rem;
  }
  button,
  input,
  textarea {
    font: inherit;
    color: inherit;
    background: var(--paper, #fff8e7);
    border: 1px solid currentColor;
    padding: 0.4rem 0.65rem;
  }
  button {
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    font-weight: bold;
    outline: 2px solid currentColor;
  }
  button:disabled {
    opacity: 0.65;
    cursor: default;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  li {
    margin-block: 0.7rem;
  }
  article {
    border: 2px solid currentColor;
    padding: 1rem;
    margin-block: 1rem;
  }
  dt {
    font-weight: bold;
  }
  dd {
    margin-left: 1rem;
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 12rem;
    box-sizing: border-box;
  }
  h1,
  h2 {
    line-height: 1.2;
  }
</style>
