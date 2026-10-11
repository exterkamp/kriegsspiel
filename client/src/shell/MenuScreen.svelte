<script lang="ts">
  import { onMount } from 'svelte';
  import Menu from './Menu.svelte';
  import type { ContinueRow } from './continueList.js';

  interface Props {
    email: string;
    load: () => Promise<ContinueRow[]>;
    onNewGame: () => void;
    onContinue: (id: string) => void;
    onSignOut: () => void;
  }
  let { load, ...rest }: Props = $props();
  let games = $state<ContinueRow[] | undefined>();
  let loadError = $state<string | undefined>();

  onMount(() => {
    load().then(
      (g) => (games = g),
      (e: unknown) => (loadError = e instanceof Error ? e.message : String(e)),
    );
  });
</script>

<Menu {...rest} {games} {loadError} />
