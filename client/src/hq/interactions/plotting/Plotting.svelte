<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { formatGameTime } from '../../presentation/gameTime';
  import type { PointM } from '../../contracts';
  import type { PlotPointer, PlotState, ReportPlacementController } from './types';
  let {
    controller,
    hub,
    canvas,
  }: {
    controller: ReportPlacementController;
    hub: HTMLElement;
    canvas: HTMLCanvasElement;
  } = $props();
  let plotState = $state.raw<PlotState>(untrack(() => controller.getState()));
  let east = $state('');
  let south = $state('');
  let label = $state('');
  let feedback = $state('');
  let eastInput = $state<HTMLInputElement | undefined>();
  let alive = false;
  const active = () => ['navigating', 'placing', 'committing'].includes(plotState.phase);
  function coordinate(text: string): number {
    if (text.length > 64 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
      return NaN;
    return Number(text);
  }
  function chosen(): PointM {
    return { x: coordinate(east), y: coordinate(south) };
  }
  function preview() {
    if (!alive || plotState.phase !== 'placing' || plotState.requestId === null) return;
    const id = plotState.requestId;
    const result = controller.preview(id, chosen(), label);
    if (alive && plotState.requestId === id) feedback = result.ok ? '' : result.error.message;
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!alive || plotState.phase !== 'placing' || plotState.requestId === null) return;
    const id = plotState.requestId;
    const result = controller.place(id, chosen(), label);
    if (alive && plotState.requestId === id) feedback = result.ok ? '' : result.error.message;
  }
  function cancel() {
    const current = controller.getState();
    if (
      ['navigating', 'placing', 'committing'].includes(current.phase) &&
      current.requestId !== null
    )
      controller.cancel(current.requestId);
  }
  onMount(() => {
    alive = true;
    let lastRequest: number | null = null;
    let focusedRequest: number | null = null;
    let lastMove: { id: number; pointer: PlotPointer } | null = null;
    let click: PlotPointer | null = null;
    const stop = controller.subscribe((next) => {
      if (!alive) return;
      plotState = next;
      if (next.requestId !== lastRequest) {
        lastRequest = next.requestId;
        east = next.paper?.location ? String(next.paper.location.x) : '';
        south = next.paper?.location ? String(next.paper.location.y) : '';
        label = next.label;
        feedback = '';
        lastMove = null;
      }
      if (next.pointerId === null) lastMove = null;
      if (
        next.phase === 'placing' &&
        next.pointerId === null &&
        focusedRequest !== next.requestId
      ) {
        const id = next.requestId;
        focusedRequest = id;
        void tick().then(() => {
          if (
            alive &&
            plotState.requestId === id &&
            plotState.phase === 'placing' &&
            plotState.pointerId === null
          )
            eastInput?.focus({ preventScroll: true });
        });
      }
    });
    const packet = (event: PointerEvent): PlotPointer => ({
      pointerId: event.pointerId,
      pointerType: event.pointerType as PlotPointer['pointerType'],
      isPrimary: event.isPrimary,
      button: event.button,
      clientXCssPx: event.clientX,
      clientYCssPx: event.clientY,
    });
    function pointer(event: PointerEvent) {
      if (event.type === 'pointerdown') click = null;
      if (!active() || plotState.requestId === null) return;
      const secondary =
        event.type === 'pointerdown' && event.pointerType === 'touch' && !event.isPrimary;
      const owned = event.pointerId === plotState.pointerId;
      const contact = event.type === 'pointerdown' && event.target === canvas;
      if (!secondary && !owned && !contact) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const p = packet(event);
      const id = plotState.requestId;
      const kind = {
        pointerdown: 'down',
        pointermove: 'move',
        pointerup: 'up',
        pointercancel: 'cancel',
        lostpointercapture: 'lost-capture',
      }[event.type] as 'down' | 'move' | 'up' | 'cancel' | 'lost-capture';
      if (kind === 'move' && owned) lastMove = { id, pointer: p };
      if (kind === 'up' && owned) click = p;
      const result = controller.pointer(id, kind, p);
      if (!result.ok && alive && plotState.requestId === id) feedback = result.error.message;
    }
    function compatibilityClick(event: MouseEvent) {
      if (!click || event.detail === 0) return;
      const samePointer = 'pointerId' in event && event.pointerId === click.pointerId;
      const samePosition =
        event.clientX === click.clientXCssPx && event.clientY === click.clientYCssPx;
      if (!samePointer && !samePosition) return;
      click = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function key(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !active()) return;
      // Native modal Escape must reach the dialog's default cancel action.
      // Modal backgrounds are implicitly inert; explicit inert controls also yield.
      if (
        event.defaultPrevented ||
        hub.ownerDocument.querySelector('dialog[open]') ||
        (event.target instanceof win.Element && event.target.closest('[inert]'))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
    function hidden() {
      if (hub.ownerDocument.hidden) cancel();
    }
    function refresh() {
      if (!alive || plotState.phase !== 'placing' || plotState.requestId === null) return;
      if (
        lastMove &&
        lastMove.id === plotState.requestId &&
        lastMove.pointer.pointerId === plotState.pointerId
      )
        controller.pointer(lastMove.id, 'move', lastMove.pointer);
      else if (plotState.preview)
        controller.preview(plotState.requestId, plotState.preview.at, label);
    }
    const win = hub.ownerDocument.defaultView!;
    const pointerListener = (event: Event) => pointer(event as PointerEvent);
    const events = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
    ];
    for (const name of events) hub.addEventListener(name, pointerListener, true);
    hub.addEventListener('click', compatibilityClick, true);
    win.addEventListener('keydown', key, true);
    win.addEventListener('blur', cancel);
    win.addEventListener('resize', refresh);
    win.addEventListener('scroll', refresh, true);
    hub.ownerDocument.addEventListener('visibilitychange', hidden);
    const observer = new ResizeObserver(refresh);
    observer.observe(canvas);
    return () => {
      alive = false;
      stop();
      for (const name of events) hub.removeEventListener(name, pointerListener, true);
      hub.removeEventListener('click', compatibilityClick, true);
      win.removeEventListener('keydown', key, true);
      win.removeEventListener('blur', cancel);
      win.removeEventListener('resize', refresh);
      win.removeEventListener('scroll', refresh, true);
      hub.ownerDocument.removeEventListener('visibilitychange', hidden);
      observer.disconnect();
      lastMove = null;
      click = null;
      cancel();
    };
  });
</script>

{#if plotState.phase !== 'idle' && plotState.phase !== 'disposed'}
  <section
    class="plotting"
    aria-label="Report placement"
    aria-busy={plotState.phase === 'navigating' || plotState.phase === 'committing'}
  >
    <h3>Place captured report pin</h3>
    <p>Private local pin. Save local marks explicitly to persist it.</p>
    <p>Captured paper: {plotState.paper?.id} — {plotState.paper?.from}</p>
    <p>
      Written: {formatGameTime(plotState.paper?.writtenAtGame)} · Received: {formatGameTime(
        plotState.paper?.receivedAtGame,
      )} · Observed: {formatGameTime(plotState.paper?.observedAtGame)} · Placement time: {formatGameTime(
        plotState.gameMs,
      )}
    </p>
    <p>
      Reported location: {plotState.paper?.location
        ? `${plotState.paper.location.x}, ${plotState.paper.location.y} metres`
        : 'Unknown'}. Chosen coordinates remain separate.
    </p>
    <p class="prose">{plotState.paper?.text}</p>
    <p role="status" aria-live="polite">
      {plotState.outcome === 'created'
        ? 'Created locally; unsaved.'
        : plotState.outcome === 'unknown'
          ? 'Creation outcome unknown. Inspect local marks; do not retry this request.'
          : plotState.phase === 'navigating'
            ? 'Opening table; release before arrival cancels placement.'
            : plotState.phase === 'finished'
              ? 'Placement ended.'
              : 'Choose a map contact or enter coordinates.'}
      {plotState.error?.message ?? feedback}
    </p>
    {#if plotState.phase === 'placing' || plotState.phase === 'navigating' || plotState.phase === 'committing'}
      <form onsubmit={submit}>
        <fieldset disabled={plotState.phase !== 'placing'}>
          <legend>Chosen drop coordinate</legend>
          <label
            >East (metres, 0–{controller.artwork.widthM})<input
              bind:this={eastInput}
              name="east"
              inputmode="decimal"
              maxlength="64"
              bind:value={east}
              oninput={preview}
            /></label
          >
          <label
            >South (metres, 0–{controller.artwork.heightM})<input
              name="south"
              inputmode="decimal"
              maxlength="64"
              bind:value={south}
              oninput={preview}
            /></label
          >
          <label
            >Pin label (maximum 256 characters)<input
              name="label"
              maxlength="256"
              bind:value={label}
              oninput={preview}
            /></label
          >
          <button type="submit">Create local report pin</button>
        </fieldset>
      </form>
      <button type="button" onclick={cancel}>Cancel placement</button>
    {/if}
    {#if plotState.preview}<p>
        Preview: {plotState.preview.at.x}, {plotState.preview.at.y} metres{plotState.preview.css
          ? ''
          : ' (offscreen)'}
      </p>{/if}
  </section>
  {#if plotState.preview?.css}<div
      class="preview"
      aria-hidden="true"
      style:left={`${plotState.preview.css.clientXCssPx}px`}
      style:top={`${plotState.preview.css.clientYCssPx}px`}
    >
      ＋ {plotState.label}
    </div>{/if}
{/if}

<style>
  .plotting {
    color: var(--ink, #21180f);
    background: var(--paper, #fff8e7);
    min-inline-size: 0;
    max-inline-size: 100%;
    overflow-wrap: anywhere;
    padding: 1rem;
    box-sizing: border-box;
  }
  .prose {
    white-space: pre-wrap;
  }
  form {
    touch-action: none;
  }
  fieldset {
    min-inline-size: 0;
  }
  label {
    display: block;
    margin-block: 0.5rem;
  }
  input,
  button {
    font: inherit;
    color: inherit;
    background: var(--paper, #fff8e7);
    border: 2px solid currentColor;
    max-inline-size: 100%;
    min-inline-size: 0;
    box-sizing: border-box;
    padding: 0.5rem;
  }
  input {
    display: block;
    width: 100%;
  }
  button {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  .preview {
    position: fixed;
    pointer-events: none;
    color: var(--ink, #21180f);
    background: var(--paper, #fff8e7);
    z-index: 2;
    max-inline-size: 16rem;
    overflow-wrap: anywhere;
  }
</style>
