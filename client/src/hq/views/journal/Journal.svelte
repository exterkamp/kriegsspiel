<script lang="ts">
  import { untrack } from 'svelte';
  import type { HqSnapshot, Scope } from '../../contracts';
  import {
    browserStorage,
    NOTE_LIMIT,
    NotesStore,
    notesKey,
    sameScope,
    type StorageFactory,
  } from './notes';
  import { categories, matchesPaper, paperText, suppliedPapers, type Filter } from './presentation';
  import { formatGameTime } from '../../presentation/gameTime';

  let {
    snapshot,
    scope,
    storageFactory = browserStorage,
  }: {
    snapshot: HqSnapshot | null;
    scope: Scope;
    storageFactory?: StorageFactory;
  } = $props();
  let query = $state('');
  let filter = $state<Filter>('all');
  let notes = $state('');
  let savedNotes = $state('');
  let status = $state('Loading local notes…');
  let store = $state<NotesStore | null>(null);
  let loadedKey = $state('');
  let canSave = $state(false);
  let hasNotes = $state(false);
  let exportText = $state<string | null>(null);
  const scopeKey = $derived(notesKey(scope));
  const current = $derived(loadedKey === scopeKey);
  const scoped = $derived(snapshot !== null && sameScope(snapshot.scope, scope));
  const supplied = $derived(suppliedPapers(scoped ? snapshot!.papers : []));
  const visible = $derived(supplied.papers.filter((paper) => matchesPaper(paper, query, filter)));
  const showNotes = $derived(
    current &&
      hasNotes &&
      (filter === 'all' || filter === 'notes') &&
      notes.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function loadNotes(next: NotesStore) {
    const result = next.load();
    if (result.ok) {
      notes = result.text;
      savedNotes = notes;
      hasNotes = true;
      exportText = null;
    }
    canSave = result.ok;
    status = result.ok === true ? 'Local notes loaded. Changes need Save.' : result.message;
  }
  $effect(() => {
    const key = scopeKey;
    const factory = storageFactory;
    const next = new NotesStore(
      untrack(() => scope),
      factory,
    );
    if (untrack(() => loadedKey) !== key) {
      notes = '';
      savedNotes = '';
      hasNotes = false;
      exportText = null;
    }
    store = next;
    loadedKey = key;
    query = '';
    filter = 'all';
    untrack(() => loadNotes(next));
  });
  function saveNotes() {
    if (!store || !current) return;
    const result = store.save(notes);
    if (result.ok === true) {
      savedNotes = notes;
      status = 'Notes saved in this browser for this game, side and player.';
    } else status = result.message;
  }
  function prepareExport() {
    exportText = [
      'Fixture HQ journal',
      `Game: ${scope.gameId} · Side: ${scope.sideId} · Player: ${scope.playerId}`,
      'Only papers in the supplied snapshot are included. Order and pause histories are unavailable in this fixture contract.',
      ...visible.map(paperText),
      ...(showNotes
        ? [
            `Personal notes (${notes === savedNotes ? 'no unsaved edits' : 'unsaved edits'}; no game timestamp)\n${notes}`,
          ]
        : []),
    ].join('\n\n');
  }
</script>

<section class="journal" aria-label="Fixture journal">
  <h3>Journal</h3>
  <p>
    Fixture journal: only papers in the supplied snapshot. Order history and pause history are
    unavailable in this fixture contract.
  </p>
  <p>
    Personal notes stay in this browser for this game, side and player. One writer is supported;
    cross-tab atomicity and cross-device synchronization are not provided.
  </p>
  <div class="tools">
    <label>Search journal <input type="search" bind:value={query} /></label>
    <label
      >Filter journal <select bind:value={filter}>
        <option value="all">All entries</option>
        <option value="papers">All papers</option>
        {#each categories as category (category)}<option value={category}>{category}</option>{/each}
        <option value="notes">Personal notes</option>
      </select></label
    >
    <button type="button" onclick={prepareExport}>Prepare text export</button>
  </div>
  {#if snapshot === null}<p>Waiting for a supplied snapshot. Paper history is unavailable.</p>
  {:else if !scoped}<p role="alert">
      Snapshot and journal belong to different HQ sessions. Papers are hidden.
    </p>
  {:else}
    {#if supplied.conflicts}<p role="alert">
        Conflicting paper IDs were omitted. A corrected snapshot is required.
      </p>{/if}
    <p role="status">{visible.length} matching papers · chronological by received game time.</p>
    {#if visible.length === 0}<p>No supplied papers match this search and filter.</p>{/if}
    <ol aria-label="Supplied papers">
      {#each visible as paper (paper.id)}
        <li>
          <article aria-label={`Paper ${paper.id}`}>
            <h4>{paper.from} · {paper.category}</h4>
            <p>Paper ID: {paper.id}</p>
            <dl>
              <dt>Written</dt>
              <dd>{formatGameTime(paper.writtenAtGame)}</dd>
              <dt>Received</dt>
              <dd>{formatGameTime(paper.receivedAtGame)}</dd>
              <dt>Observed</dt>
              <dd>
                {formatGameTime(paper.observedAtGame)}
              </dd>
            </dl>
            <p class="prose">{paper.text}</p>
          </article>
        </li>
      {/each}
    </ol>
  {/if}
  <section aria-label="Local personal notebook">
    <h4>Personal notebook</h4>
    <p>Notes have no supplied game timestamp and are separate from the paper chronology.</p>
    <label
      >Personal notes
      <textarea
        value={current ? notes : ''}
        oninput={(event) => {
          notes = event.currentTarget.value;
          exportText = null;
        }}
        maxlength={NOTE_LIMIT}
        disabled={!current || (!canSave && !hasNotes)}
        readonly={current && hasNotes && !canSave}
        rows="8"
      ></textarea>
    </label>
    <p>
      {current ? notes.length : 0} / {NOTE_LIMIT} characters. {current && notes !== savedNotes
        ? 'Unsaved edits.'
        : ''}
    </p>
    <button type="button" onclick={saveNotes} disabled={!current || !canSave}
      >Save personal notes</button
    >
    <button
      type="button"
      onclick={() => {
        if (store && current) loadNotes(store);
      }}>Reload local notes (discard edits)</button
    >
    <p role="status" aria-live="polite">{status}</p>
    {#if showNotes}<p class="prose" aria-label="Matching personal notes">
        {notes || 'Notebook is empty.'}
      </p>{/if}
  </section>
  {#if current && exportText !== null}
    <label
      >Journal text export (select and copy)
      <textarea
        readonly
        value={exportText}
        rows="12"
        onfocus={(event) => event.currentTarget.select()}
      ></textarea>
    </label>
    <p>
      Export captures the current search and filter when prepared, including matching unsaved notes.
      Select the text and copy or save it using your browser.
    </p>
  {/if}
</section>

<style>
  .journal {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    color: var(--ink, #21180f);
    background: var(--paper, #f3e7c8);
    font-family: Georgia, 'Times New Roman', serif;
    max-width: 64rem;
  }
  h3,
  h4 {
    font-weight: normal;
  }
  p {
    line-height: 1.5;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    align-items: end;
  }
  label {
    min-inline-size: 0;
    max-inline-size: 100%;
    display: block;
  }
  input,
  select,
  textarea,
  button {
    min-inline-size: 0;
    white-space: normal;
    overflow-wrap: anywhere;
    font: inherit;
    color: inherit;
    background: var(--paper, #f3e7c8);
    border: 2px solid currentColor;
    padding: 0.6rem;
    max-width: 100%;
    box-sizing: border-box;
  }
  input,
  select,
  textarea {
    white-space: pre-wrap;
    display: block;
  }
  textarea {
    white-space: pre-wrap;
    width: 100%;
  }
  button {
    cursor: pointer;
    margin: 0.4rem 0;
  }
  button:disabled {
    cursor: default;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  ol {
    padding-left: 1.5rem;
  }
  article {
    border-bottom: 1px solid currentColor;
    padding: 0.5rem 0;
  }
  .prose,
  dd {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.3rem 0.8rem;
  }
  dd {
    margin: 0;
  }
</style>
