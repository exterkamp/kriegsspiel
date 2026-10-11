<script lang="ts">
  import { untrack } from 'svelte';
  import InTray from './InTray.svelte';
  import type { HqSnapshot, Scope } from '../../contracts';
  import type { StoragePort } from './store';
  let { initial, scope, storage }: { initial: HqSnapshot; scope: Scope; storage: StoragePort } =
    $props();
  let current = $state(untrack(() => initial));
  export function emit(next: HqSnapshot) {
    current = next;
  }
</script>

<InTray snapshot={current} {scope} storageFactory={() => storage} />
