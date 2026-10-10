<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { HqDataSource, HqRepository, MapSurface, PublicArtwork, Result } from './contracts';
  import Shell from './shell/Shell.svelte';
  import Roster from './views/roster/Roster.svelte';
  import Journal from './views/journal/Journal.svelte';
  import Clock from './views/clock/Clock.svelte';
  import { createFormationFocus } from './sessionActions';
  import type { ShellViewContext } from './shell/types';
  import { projectGameTime } from './data/fixture';
  let {
    source,
    surface,
    repository,
    artwork,
  }: {
    source: HqDataSource;
    surface: MapSurface;
    repository: HqRepository;
    artwork: PublicArtwork;
  } = $props();
  const life = new AbortController();
  const focusFormation = createFormationFocus(life.signal);
  let feedback = $state('');
  let action = 0;
  let monotonicMs = $state(performance.now());
  onMount(() => {
    const timer = window.setInterval(() => {
      monotonicMs = performance.now();
    }, 250);
    return () => window.clearInterval(timer);
  });
  async function focus(context: ShellViewContext, id: string): Promise<Result<void>> {
    const ticket = ++action;
    const result = await focusFormation(context, id);
    if (!life.signal.aborted && ticket === action)
      feedback = result.ok ? 'Formation located on the map.' : result.error.message;
    return result;
  }
  onDestroy(() => life.abort());
</script>

<Shell {source} {surface} {repository} {artwork}>
  {#snippet clock(context: ShellViewContext)}
    <Clock
      state={context.sourceState}
      kind={source.kind}
      gameMs={projectGameTime(context.sourceState, source.kind, monotonicMs)}
      compact={context.state.view === 'table'}
    />
    <p class="session-feedback" role="status" aria-live="polite">{feedback}</p>
  {/snippet}
  {#snippet view(context: ShellViewContext)}
    {#if context.state.view === 'roster'}
      <Roster
        snapshot={context.sourceState.snapshot}
        navigation={context.navigation}
        surface={context.surface}
        gameMs={projectGameTime(context.sourceState, source.kind, monotonicMs)}
        onFocusUnit={(id) => focus(context, id)}
      />
    {:else if context.state.view === 'journal'}
      <Journal snapshot={context.sourceState.snapshot} scope={source.scope} />
    {:else}
      <p>This service is unavailable in the fixture desk.</p>
    {/if}
  {/snippet}
</Shell>

<style>
  .session-feedback {
    margin: 0;
    padding: 0.25rem 0.5rem;
    background: var(--paper, #f3e6c6);
    color: var(--ink, #302719);
    font-family: Georgia, serif;
  }
  .session-feedback:empty {
    display: none;
  }
</style>
