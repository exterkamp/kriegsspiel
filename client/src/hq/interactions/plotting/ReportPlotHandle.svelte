<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Result } from '../../contracts';
  import type { PlotPointer, PlotRequest } from './types';
  let {
    paperId,
    disabled,
    onStart,
  }: {
    paperId: string;
    disabled: boolean;
    onStart: (paperId: string, pointer: PlotPointer | null) => Result<PlotRequest>;
  } = $props();
  let feedback = $state('');
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  function start(pointer: PlotPointer | null) {
    if (!alive || disabled) return;
    try {
      const result = onStart(paperId, pointer);
      if (alive) feedback = result.ok ? '' : result.error.message;
    } catch {
      if (alive) feedback = 'Report placement could not start.';
    }
  }
  function down(event: PointerEvent) {
    if (
      disabled ||
      !event.isPrimary ||
      event.button !== 0 ||
      !['mouse', 'touch', 'pen'].includes(event.pointerType)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    start({
      pointerId: event.pointerId,
      pointerType: event.pointerType as PlotPointer['pointerType'],
      isPrimary: event.isPrimary,
      button: event.button,
      clientXCssPx: event.clientX,
      clientYCssPx: event.clientY,
    });
  }
</script>

<div class="report-plot-handle">
  <button
    class="drag"
    {disabled}
    onpointerdown={down}
    ondragstart={(event) => event.preventDefault()}
    onclick={(event) => {
      if (event.detail === 0) start(null);
    }}>Drag report to map</button
  >
  <button {disabled} onclick={() => start(null)}>Choose report coordinates</button>
  <p role="status" aria-live="polite">{feedback}</p>
</div>

<style>
  .report-plot-handle {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  .drag {
    touch-action: none;
  }
  button {
    font: inherit;
    color: inherit;
    background: var(--paper, #fff8e7);
    border: 2px solid currentColor;
    padding: 0.5rem;
    max-inline-size: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
</style>
