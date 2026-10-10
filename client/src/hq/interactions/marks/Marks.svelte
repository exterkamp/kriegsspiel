<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type {
    MarkCreateInput,
    MarkEditInput,
    MarkGeometry,
    Paper,
    PersonalMark,
    PointM,
    PublicArtwork,
    Result,
  } from '../../contracts';

  let {
    marks,
    artwork,
    papers,
    busy,
    writable,
    dirty,
    status,
    onCreate,
    onEdit,
    onDelete,
    onSave,
    onReload,
    onFocus,
  }: {
    marks: readonly PersonalMark[];
    artwork: PublicArtwork;
    papers: readonly Paper[];
    busy: boolean;
    writable: boolean;
    dirty: boolean;
    status: string;
    onCreate: (input: MarkCreateInput) => Result<void>;
    onEdit: (id: string, input: MarkEditInput) => Result<void>;
    onDelete: (id: string) => Result<void>;
    onSave: () => Promise<Result<void>>;
    onReload: () => Promise<Result<void>>;
    onFocus: (id: string) => Promise<Result<void>>;
  } = $props();
  let original = $state.raw<PersonalMark | null>(null);
  let label = $state('');
  let kind = $state<MarkGeometry['kind']>('pin');
  let x = $state('');
  let y = $state('');
  let radius = $state('');
  let points = $state('');
  let symbol = $state<'cross' | 'dot' | 'flag'>('cross');
  let paperId = $state('');
  let formDirty = $state(false);
  let reloadConfirmed = $state(false);
  let feedback = $state('');
  let pending = $state<'save' | 'reload' | 'focus' | 'mutation' | null>(null);
  let exported = $state<string | null>(null);
  let exportedDirty = $state(false);
  let alive = true;
  let focusAction = 0;
  let labelEditor = $state<HTMLInputElement | undefined>();
  let listHeading = $state<HTMLHeadingElement | undefined>();
  let markList = $state<HTMLUListElement | undefined>();
  async function moveFocus(action: number, target: () => HTMLElement | undefined) {
    await tick();
    if (!alive || action !== focusAction) return;
    const element = target();
    if (element?.isConnected && !element.matches(':disabled')) element.focus();
  }
  const occupied = $derived(busy || pending !== null);
  const locked = $derived(occupied || !writable);
  const discardNeeded = $derived(dirty || formDirty);
  $effect(() => {
    void marks;
    void dirty;
    reloadConfirmed = false;
  });
  onDestroy(() => {
    alive = false;
    focusAction++;
  });

  function edited() {
    focusAction++;
    formDirty = true;
    reloadConfirmed = false;
  }
  function reset() {
    original = null;
    label = '';
    kind = 'pin';
    x = '';
    y = '';
    radius = '';
    points = '';
    symbol = 'cross';
    paperId = '';
    formDirty = false;
    reloadConfirmed = false;
  }
  function guard(write: boolean): boolean {
    if (!alive) return false;
    focusAction++;
    if (occupied) {
      feedback = 'Please wait for the pending marks action.';
      return false;
    }
    if (write && !writable) {
      feedback = 'Mark editing is unavailable. Resolve the storage status or explicitly reload.';
      return false;
    }
    return true;
  }
  function number(text: string, field: string): number {
    if (text.length > 64 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
      throw new Error(`${field} must be a finite number.`);
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
    return value;
  }
  function point(xText: string, yText: string): PointM {
    const at = { x: number(xText, 'East coordinate'), y: number(yText, 'South coordinate') };
    if (at.x < 0 || at.x > artwork.widthM || at.y < 0 || at.y > artwork.heightM)
      throw new Error(
        `Coordinates must be within 0–${artwork.widthM} m east and 0–${artwork.heightM} m south.`,
      );
    return at;
  }
  function geometry(): MarkGeometry {
    if (
      !Number.isFinite(artwork.widthM) ||
      !Number.isFinite(artwork.heightM) ||
      artwork.widthM <= 0 ||
      artwork.heightM <= 0
    )
      throw new Error('Public map bounds are unavailable.');
    if (kind === 'polyline' || kind === 'arrow') {
      if (points.length > 16384)
        throw new Error('Coordinate text is too long (maximum 16,384 characters).');
      const lines = points.trim().split('\n');
      if (lines.length < 2 || lines.length > 256)
        throw new Error('A line or arrow needs 2–256 points.');
      const parsed = lines.map((line) => {
        const pair = line.split(',');
        if (pair.length !== 2) throw new Error('Enter one east, south coordinate pair per line.');
        return point(pair[0]!, pair[1]!);
      });
      return { kind, points: parsed };
    }
    const at = point(x, y);
    if (kind === 'ring') {
      const radiusM = number(radius, 'Radius');
      if (radiusM <= 0 || radiusM > Math.hypot(artwork.widthM, artwork.heightM))
        throw new Error('Radius must be positive and no greater than the map diagonal.');
      return { kind, centre: at, radiusM };
    }
    if (kind === 'symbol') {
      if (!['cross', 'dot', 'flag'].includes(symbol)) throw new Error('Choose cross, dot or flag.');
      return { kind, at, symbol };
    }
    if (kind !== 'pin') throw new Error('Choose a supported mark shape.');
    return { kind, at };
  }
  function accept(result: Result<void>, success: string): boolean {
    if (!alive) return false;
    feedback = result.ok === true ? success : result.error.message;
    return result.ok;
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!guard(true)) return;
    if (!original && marks.length >= 200) {
      feedback = 'The local mark limit is 200. Delete a mark before adding another.';
      return;
    }
    if (label.length > 256) {
      feedback = 'Label must be at most 256 characters.';
      return;
    }
    let input: MarkEditInput;
    try {
      input = { label, geometry: geometry() };
    } catch (error) {
      feedback = error instanceof Error ? error.message : 'Invalid mark geometry.';
      return;
    }
    if (
      original &&
      (!marks.some((mark) => mark.id === original!.id) ||
        original.map.id !== artwork.id ||
        original.map.revision !== artwork.revision)
    ) {
      feedback =
        'This mark is no longer available on the current public map. The form has been retained.';
      return;
    }
    if (
      !original &&
      paperId &&
      (!papers.some((paper) => paper.id === paperId) || paperId.length > 128)
    ) {
      feedback = 'The selected paper is unavailable. Choose another paper or a manual source.';
      return;
    }
    pending = 'mutation';
    try {
      const result = original
        ? onEdit(original.id, input)
        : onCreate({ ...input, source: paperId ? { kind: 'paper', paperId } : { kind: 'manual' } });
      if (accept(result, 'Local mark edits accepted. Use Save to persist them.')) reset();
    } catch {
      if (alive) feedback = 'The mark action failed. The form has been retained.';
    } finally {
      if (alive) pending = null;
    }
  }
  function startEdit(mark: PersonalMark) {
    if (!guard(true)) return;
    if (mark.map.id !== artwork.id || mark.map.revision !== artwork.revision) {
      feedback = 'This mark belongs to a different public map.';
      return;
    }
    original = mark;
    label = mark.label;
    kind = mark.geometry.kind;
    const shape = mark.geometry;
    if (shape.kind === 'arrow' || shape.kind === 'polyline')
      points = shape.points.map((at) => `${at.x}, ${at.y}`).join('\n');
    else if (shape.kind === 'ring') {
      x = String(shape.centre.x);
      y = String(shape.centre.y);
      radius = String(shape.radiusM);
    } else if ('at' in shape) {
      x = String(shape.at.x);
      y = String(shape.at.y);
      if (shape.kind === 'symbol') symbol = shape.symbol;
    }
    formDirty = false;
    reloadConfirmed = false;
    feedback = '';
    void moveFocus(focusAction, () => labelEditor);
  }
  function remove(id: string) {
    if (!guard(true)) return;
    const action = focusAction;
    const index = marks.findIndex((mark) => mark.id === id);
    const neighbor = marks[index + 1]?.id ?? marks[index - 1]?.id;
    pending = 'mutation';
    try {
      if (accept(onDelete(id), 'Local deletion accepted. Use Save to persist it.')) {
        if (original?.id === id) reset();
        void moveFocus(action, () => {
          const buttons = [
            ...(markList?.querySelectorAll<HTMLButtonElement>('button[data-edit-mark]') ?? []),
          ];
          return (
            buttons.find((button) => button.dataset.editMark === neighbor) ??
            buttons[0] ??
            listHeading
          );
        });
      }
    } catch {
      if (alive) feedback = 'Deletion failed. Local edits have been retained.';
    } finally {
      if (alive) pending = null;
    }
  }
  async function action(kind: 'save' | 'reload' | 'focus', id?: string) {
    if (!guard(kind === 'save')) return;
    if (kind === 'save' && !dirty) {
      feedback = 'No accepted local mark changes to save.';
      return;
    }
    if (kind === 'reload' && discardNeeded && !reloadConfirmed) {
      feedback = 'Confirm that reload may discard unsaved marks and form edits.';
      return;
    }
    pending = kind;
    feedback =
      kind === 'save'
        ? 'Saving local marks…'
        : kind === 'reload'
          ? 'Reloading local marks…'
          : 'Focusing the mark…';
    try {
      const result = await (kind === 'save'
        ? onSave()
        : kind === 'reload'
          ? onReload()
          : onFocus(id!));
      // Focus belongs to the root session and may finish after this panel has unmounted.
      if (!alive) return;
      const succeeded = accept(
        result,
        kind === 'save'
          ? 'Save completed.'
          : kind === 'reload'
            ? 'Reload completed.'
            : 'Mark focus completed.',
      );
      if (kind === 'reload' && succeeded) reset();
    } catch {
      if (alive) feedback = 'The marks action failed. Local edits have been retained.';
    } finally {
      if (alive) {
        pending = null;
        if (kind === 'reload') reloadConfirmed = false;
      }
    }
  }
  function exportJson() {
    focusAction++;
    exported = JSON.stringify(marks, null, 2);
    exportedDirty = dirty;
  }
  const time = (value: number | null, display = false) =>
    value === null ? 'Unavailable' : `${value} game ms${display ? ' (fixture display time)' : ''}`;
</script>

<section class="marks" aria-label="Personal fixture marks" aria-busy={occupied}>
  <h3>Personal map marks</h3>
  <p class="notice">
    Local fixture marks only. Shared and server-backed marks are unavailable. Coordinates are metres
    from the north-west corner; east increases right, south increases down.
  </p>
  <p>
    {dirty ? 'Unsaved local mark changes.' : 'No unsaved local mark changes.'}{formDirty
      ? ' Unsubmitted form edits.'
      : ''}
  </p>
  <p role="status" aria-live="polite">{status}</p>
  <p class="feedback" role="status" aria-live="polite">{feedback}</p>
  <div class="actions">
    <button disabled={locked || !dirty} onclick={() => action('save')}>Save local marks</button>
    <button onclick={exportJson}>Export marks as JSON</button>
    {#if discardNeeded}<label
        ><input
          type="checkbox"
          checked={reloadConfirmed}
          disabled={occupied}
          onchange={(event) => (reloadConfirmed = event.currentTarget.checked)}
        /> I understand reload discards unsaved marks and form edits.</label
      >{/if}
    <button
      disabled={occupied || (discardNeeded && !reloadConfirmed)}
      onclick={() => action('reload')}>Reload local marks</button
    >
  </div>
  {#if exported !== null}<label
      >JSON export (accepted local list; {exportedDirty
        ? 'unsaved changes included'
        : 'no unsaved changes'})<textarea class="export" readonly value={exported} rows="8"
      ></textarea></label
    >
    <p>
      This export captures the list when Export was chosen. Choose Export again after changes.
      Unsubmitted form edits are excluded.
    </p>{/if}
  <h4>{original ? 'Edit personal mark' : 'Create personal mark'}</h4>
  <form onsubmit={submit}>
    <fieldset disabled={locked}>
      <legend>{original ? 'Label and geometry only; source is frozen' : 'New local mark'}</legend>
      <label
        >Label (plain text, up to 256 characters)<input
          bind:this={labelEditor}
          name="label"
          maxlength="256"
          bind:value={label}
          oninput={edited}
        /></label
      >
      <label
        >Shape<select name="kind" bind:value={kind} onchange={edited}
          ><option value="pin">Pin</option><option value="polyline">Polyline</option><option
            value="arrow">Arrow</option
          ><option value="ring">Ring</option><option value="symbol">Symbol</option></select
        ></label
      >
      {#if kind === 'polyline' || kind === 'arrow'}
        <label
          >Points: one east, south pair per line (2–256 points)<textarea
            name="points"
            maxlength="16384"
            rows="5"
            bind:value={points}
            oninput={edited}
          ></textarea></label
        >
      {:else}
        <label
          >East coordinate (m; 0–{artwork.widthM})<input
            name="x"
            inputmode="decimal"
            maxlength="64"
            bind:value={x}
            oninput={edited}
          /></label
        >
        <label
          >South coordinate (m; 0–{artwork.heightM})<input
            name="y"
            inputmode="decimal"
            maxlength="64"
            bind:value={y}
            oninput={edited}
          /></label
        >
        {#if kind === 'ring'}<label
            >Radius (m; positive, at most {Math.hypot(artwork.widthM, artwork.heightM)})<input
              name="radius"
              inputmode="decimal"
              maxlength="64"
              bind:value={radius}
              oninput={edited}
            /></label
          >{/if}
        {#if kind === 'symbol'}<label
            >Symbol<select name="symbol" bind:value={symbol} onchange={edited}
              ><option value="cross">Cross</option><option value="dot">Dot</option><option
                value="flag">Flag</option
              ></select
            ></label
          >{/if}
      {/if}
      {#if !original}<label
          >Source paper (optional; frozen when created)<select
            name="paperId"
            bind:value={paperId}
            onchange={edited}
            ><option value="">Manual mark — no paper</option
            >{#each papers as paper (paper.id)}<option value={paper.id}
                >{paper.from} · {paper.id}</option
              >{/each}</select
          ></label
        >{/if}
      <button type="submit" disabled={!original && marks.length >= 200}
        >{original ? 'Apply mark edit' : 'Add local mark'}</button
      >
      {#if original}<button
          type="button"
          onclick={() => {
            if (guard(true)) reset();
          }}>Start a new mark</button
        >{/if}
    </fieldset>
  </form>
  {#if original}
    <section aria-label="Frozen mark provenance">
      <h4>Frozen source</h4>
      <dl>
        <dt>Originally placed</dt>
        <dd>{time(original.placedAtGame, true)}</dd>
        <dt>Edited</dt>
        <dd>{time(original.editedAtGame, true)}</dd>
      </dl>
      {#if original.source.kind === 'manual'}<p>
          Manual source. No report dates or reported location.
        </p>{:else}
        <dl>
          <dt>Paper ID</dt>
          <dd>{original.source.paperId}</dd>
          <dt>Written</dt>
          <dd>{time(original.source.writtenAtGame)}</dd>
          <dt>Received</dt>
          <dd>{time(original.source.receivedAtGame)}</dd>
          <dt>Observed</dt>
          <dd>{time(original.source.observedAtGame)}</dd>
          <dt>Reported location</dt>
          <dd>
            {original.source.reportedLocation
              ? `${original.source.reportedLocation.x} m east, ${original.source.reportedLocation.y} m south`
              : 'Unavailable'}
          </dd>
        </dl>
        <p>{original.source.excerpt}</p>
      {/if}
    </section>
  {/if}
  <h4 bind:this={listHeading} tabindex="-1">Local marks ({marks.length}/200)</h4>
  {#if marks.length === 0}<p>No personal marks in the local list.</p>{:else}<ul
      bind:this={markList}
    >
      {#each marks as mark (mark.id)}<li>
          <strong>{mark.label || 'Unlabelled mark'}</strong> · {mark.geometry.kind}
          <div class="actions">
            <button
              disabled={locked}
              data-edit-mark={mark.id}
              aria-label={`Edit mark ${mark.label || mark.id}`}
              onclick={() => startEdit(mark)}>Edit</button
            ><button
              disabled={locked}
              aria-label={`Delete mark ${mark.label || mark.id}`}
              onclick={() => remove(mark.id)}>Delete</button
            ><button
              disabled={occupied}
              aria-label={`Focus mark ${mark.label || mark.id}`}
              onclick={() => action('focus', mark.id)}>Focus on map</button
            >
          </div>
        </li>{/each}
    </ul>{/if}
</section>

<style>
  .marks {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    color: var(--ink, inherit);
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1.5;
  }
  h3,
  h4 {
    margin: 1rem 0 0.5rem;
  }
  .notice {
    border-left: 0.25rem solid currentColor;
    padding-left: 0.8rem;
  }
  label {
    display: block;
    margin: 0.65rem 0;
  }
  input:not([type='checkbox']),
  select,
  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 38rem;
  }
  input,
  select,
  textarea,
  button {
    min-inline-size: 0;
    max-inline-size: 100%;
    box-sizing: border-box;
    white-space: normal;
    overflow-wrap: anywhere;
    font: inherit;
    color: inherit;
    background: var(--paper, transparent);
    border: 1px solid currentColor;
    padding: 0.45rem;
  }
  textarea {
    white-space: pre-wrap;
  }
  legend {
    max-inline-size: 100%;
  }
  input[type='checkbox'] {
    margin-right: 0.5rem;
  }
  button {
    border-width: 2px;
    cursor: pointer;
  }
  button:disabled,
  fieldset:disabled {
    cursor: default;
  }
  button:disabled {
    border-style: dashed;
  }
  fieldset {
    min-inline-size: 0;
    border: 1px solid currentColor;
    padding: 0.8rem;
    margin: 1rem 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }
  .actions label {
    flex-basis: 100%;
  }
  li {
    margin-bottom: 0.8rem;
  }
  .feedback {
    min-height: 1.5em;
    font-weight: bold;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 0.4rem 1rem;
  }
  dt {
    font-weight: bold;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  .export {
    font-family: monospace;
    font-size: 0.9rem;
  }
</style>
