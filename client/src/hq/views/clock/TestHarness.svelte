<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { SourceState } from '../../contracts';
  import Clock from './Clock.svelte';
  let {
    packet,
  }: {
    packet: Writable<{
      state: SourceState;
      kind: 'fixture' | 'live';
      gameMs: number | null;
      compact?: boolean;
    }>;
  } = $props();
</script>

<Clock {...$packet} />
