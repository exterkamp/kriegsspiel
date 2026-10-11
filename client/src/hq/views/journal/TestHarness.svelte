<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { HqSnapshot, Scope } from '../../contracts';
  import type { StorageFactory } from './notes';
  import Journal from './Journal.svelte';
  // DOM tests update both scoped props on a single mounted view.
  let {
    session,
    storageFactory,
  }: {
    session: Writable<{ snapshot: HqSnapshot; scope: Scope }>;
    storageFactory: StorageFactory;
  } = $props();
</script>

<Journal snapshot={$session.snapshot} scope={$session.scope} {storageFactory} />
