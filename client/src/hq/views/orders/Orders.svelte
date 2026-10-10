<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { HqSnapshot, Scope, Result } from '../../contracts';
  import {
    createDraftRepository,
    sameScope,
    type DraftDocument,
    type StoragePort,
  } from './repository';
  let {
    snapshot,
    scope,
    storageFactory,
  }: { snapshot: HqSnapshot | null; scope: Scope; storageFactory?: () => StoragePort } = $props();
  const repository = untrack(() => createDraftRepository(scope, storageFactory));
  let alive = true;
  const initial = repository.load();
  let saved = $state<DraftDocument | null>(initial.ok === true ? initial.value : null);
  let text = $state(initial.ok === true ? initial.value.text : '');
  let recipientUnitId = $state<string | null>(
    initial.ok === true ? initial.value.recipientUnitId : null,
  );
  let dirty = $state(false);
  let notice = $state(initial.ok === true ? 'Local draft loaded.' : initial.error.message);
  let available = $state(initial.ok === true);
  let discard = $state(false);
  let exported = $state<{ text: string; json: string; dirty: boolean } | null>(null);
  const matchingScope = $derived(
    sameScope(scope, repository.scope) &&
      (!snapshot || sameScope(snapshot.scope, repository.scope)),
  );
  const recipients = $derived(
    matchingScope
      ? (snapshot?.roster ?? []).filter(
          (row, i, rows) =>
            row.unitId.length > 0 &&
            row.unitId.length <= 128 &&
            rows.findIndex((other) => other.unitId === row.unitId) === i,
        )
      : [],
  );
  const recipient = $derived(recipients.find((row) => row.unitId === recipientUnitId) ?? null);
  function accept(result: Result<DraftDocument>, message: string) {
    if (!alive) return;
    available = repository.getState().writable;
    if (result.ok === true) {
      saved = result.value;
      dirty = false;
      notice = message;
    } else notice = result.error.message;
  }
  function save() {
    if (!alive) return;
    if (!matchingScope) {
      notice = 'Scope mismatch. Remount this view for the current scope; draft remains unsaved.';
      return;
    }
    accept(
      repository.save(
        {
          schemaVersion: 1,
          scope: repository.scope,
          revision: saved?.revision ?? 'unloaded',
          recipientUnitId,
          text,
        },
        saved?.revision ?? 'unloaded',
      ),
      'Local draft saved.',
    );
  }
  function editText(event: Event) {
    text = (event.currentTarget as HTMLTextAreaElement).value;
    dirty = true;
    save();
  }
  function editRecipient(event: Event) {
    recipientUnitId = (event.currentTarget as HTMLSelectElement).value || null;
    dirty = true;
    save();
  }
  function reload() {
    if (!alive || !matchingScope || (dirty && !discard)) return;
    const result = repository.load();
    if (!alive) return;
    if (result.ok === true) {
      text = result.value.text;
      recipientUnitId = result.value.recipientUnitId;
      discard = false;
    }
    accept(result, 'Local draft reloaded.');
  }
  function exportDraft() {
    exported = {
      text,
      json: JSON.stringify(
        {
          schemaVersion: 1,
          scope: repository.scope,
          revision: saved?.revision ?? null,
          recipientUnitId,
          text,
          unsaved: dirty || !available,
        },
        null,
        2,
      ),
      dirty: dirty || !available,
    };
  }
  onDestroy(() => {
    alive = false;
    repository.dispose();
  });
</script>

<section class="orders" aria-label="Local order draft">
  <h1>Orders</h1>
  <p>Local draft only. Signing and sending unavailable.</p>
  <p role="status" aria-live="polite">{notice}</p>
  <p>
    {dirty
      ? 'Unsaved draft changes.'
      : available
        ? 'Local draft loaded or saved.'
        : 'Saved draft unavailable.'}
  </p>
  {#if !matchingScope}<p role="alert">
      Scope mismatch. Current own-unit recipients unavailable.
    </p>{/if}
  <label
    >Recipient — own unit
    <select value={recipientUnitId ?? ''} onchange={editRecipient}>
      <option value="">Choose an own unit</option>
      {#if recipientUnitId && !recipient}<option value={recipientUnitId}
          >Missing recipient: {recipientUnitId}</option
        >{/if}
      {#each recipients as row (row.unitId)}<option value={row.unitId}>{row.name}</option>{/each}
    </select>
  </label>
  {#if recipientUnitId && !recipient}<p>
      Stored recipient is missing from the current own roster. Choose a current own unit.
    </p>{/if}
  {#if !recipients.length}<p>No supplied own units available.</p>{/if}
  <p>Commander: unknown. Unit names identify formations, not commanders.</p>
  <label
    >Draft text <textarea value={text} oninput={editText} aria-describedby="draft-limit"
    ></textarea></label
  >
  <p id="draft-limit">
    {text.length} / 16384 characters. Longer text remains editable and exportable but cannot be saved.
  </p>
  <h2>Draft preview</h2>
  <article aria-label="Draft preview">
    <p>
      To: {recipient?.name ??
        (recipientUnitId ? `Missing recipient: ${recipientUnitId}` : 'Not selected')}
    </p>
    <p class="prose">{text || 'No draft text supplied.'}</p>
  </article>
  <p>Courier choice, courier risk, delivery estimate, annexes and delivery status unavailable.</p>
  <button disabled aria-describedby="sign-unavailable">Sign and send</button>
  <p id="sign-unavailable">Signing requires a supported command and delivery contract.</p>
  <h2>Local draft recovery</h2>
  <button disabled={!dirty || !available || !matchingScope} onclick={save}>Retry save</button>
  <button onclick={exportDraft}>Export draft</button>
  {#if exported}
    <p>Export: {exported.dirty ? 'includes unsaved draft' : 'saved draft'}.</p>
    <label>Plain text export<textarea readonly value={exported.text}></textarea></label>
    <label>JSON export<textarea readonly value={exported.json}></textarea></label>
  {/if}
  {#if dirty}<label
      ><input type="checkbox" bind:checked={discard} /> Discard unsaved changes on reload</label
    >{/if}
  <button disabled={(dirty && !discard) || !matchingScope} onclick={reload}
    >Reload saved draft</button
  >
</section>

<style>
  .orders {
    color: var(--ink, #231b12);
    background: var(--paper, #fff8e7);
    padding: 1.5rem;
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1.5;
  }
  label {
    display: block;
    margin-block: 1rem;
  }
  button,
  select,
  textarea,
  input {
    font: inherit;
    color: inherit;
    background: var(--paper, #fff8e7);
    border: 1px solid currentColor;
    padding: 0.4rem 0.65rem;
  }
  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 12rem;
  }
  button {
    cursor: pointer;
    margin-right: 0.5rem;
  }
  button:disabled {
    opacity: 0.65;
    cursor: default;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  article {
    border: 1px solid currentColor;
    padding: 1rem;
  }
  .prose {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
