<script lang="ts">
  import { untrack } from 'svelte';
  import Orders from './Orders.svelte';
  import type { HqSnapshot, Scope } from '../../contracts';
  import type { StoragePort } from './repository';
  let { initial, scope, storage }: { initial: HqSnapshot; scope: Scope; storage: StoragePort } =
    $props();
  let current = $state(untrack(() => initial));
  export function emit(next: HqSnapshot) {
    current = next;
  }
</script>

<Orders snapshot={current} {scope} storageFactory={() => storage} />
