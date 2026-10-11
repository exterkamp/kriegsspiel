<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Plotting, type ReportPlacementController } from './interactions/plotting';
  import type { ShellViewContext } from './shell/types';
  import type { PlacementEnvironment } from './placementPorts';
  let {
    controller,
    context,
    hub,
    canvas,
    onEnvironment,
  }: {
    controller: ReportPlacementController;
    context: ShellViewContext;
    hub: HTMLElement;
    canvas: HTMLCanvasElement;
    onEnvironment: (environment: PlacementEnvironment | null) => void;
  } = $props();
  $effect(() => {
    onEnvironment({ context, hub, canvas });
  });
  onDestroy(() => onEnvironment(null));
</script>

<Plotting {controller} {hub} {canvas} />
