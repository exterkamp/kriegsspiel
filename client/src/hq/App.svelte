<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type {
    HqDataSource,
    HqRepository,
    MapSurface,
    PublicArtwork,
    Result,
    PersonalMarksRepository,
  } from './contracts';
  import Shell from './shell/Shell.svelte';
  import Roster from './views/roster/Roster.svelte';
  import Journal from './views/journal/Journal.svelte';
  import InTray from './views/intray/InTray.svelte';
  import Clock from './views/clock/Clock.svelte';
  import Marks from './interactions/marks/Marks.svelte';
  import {
    BrowserPersonalMarksRepository,
    createPersonalMarksController,
    type PersonalMarksState,
  } from './data/marks';
  import { failure, sameScope, success } from './data/common';
  import { createFormationFocus } from './sessionActions';
  import type { ShellViewContext } from './shell/types';
  import { projectGameTime } from './data/fixture';
  let {
    source,
    surface,
    repository,
    artwork,
    marksRepository,
  }: {
    source: HqDataSource;
    surface: MapSurface;
    repository: HqRepository;
    artwork: PublicArtwork;
    marksRepository?: PersonalMarksRepository;
  } = $props();
  const life = new AbortController();
  const personalMarks = untrack(() =>
    createPersonalMarksController(
      marksRepository ??
        new BrowserPersonalMarksRepository(source.scope, artwork, () => window.localStorage),
    ),
  );
  let markState = $state.raw<PersonalMarksState>(personalMarks.getState());
  onMount(() => {
    const stop = personalMarks.subscribe((state) => {
      markState = state;
    });
    if (
      sameScope(personalMarks.scope, source.scope) &&
      JSON.stringify(personalMarks.artwork) === JSON.stringify(artwork)
    )
      void personalMarks.initialize();
    else feedback = 'Personal marks belong to another headquarters or map.';
    return stop;
  });
  let focusOperation: AbortController | null = null;
  function beginFocus() {
    focusOperation?.abort();
    focusOperation = new AbortController();
    if (life.signal.aborted) focusOperation.abort();
    return focusOperation;
  }
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
    const operation = beginFocus();
    const result = await createFormationFocus(operation.signal)(context, id);
    if (!life.signal.aborted && ticket === action)
      feedback = result.ok ? 'Formation located on the map.' : result.error.message;
    return result;
  }
  async function focusMark(context: ShellViewContext, id: string): Promise<Result<void>> {
    const ticket = ++action;
    const operation = beginFocus();
    const mark = markState.marks.find((item) => item.id === id);
    let result: Result<void>;
    if (!mark || life.signal.aborted)
      result = failure('not-found', 'This personal mark is unavailable.');
    else if (
      !sameScope(mark.scope, context.surface.scope) ||
      !sameScope(mark.scope, context.state.scope)
    )
      result = failure('scope-mismatch', 'This mark belongs to another headquarters.');
    else {
      const at =
        mark.geometry.kind === 'ring'
          ? mark.geometry.centre
          : 'at' in mark.geometry
            ? mark.geometry.at
            : mark.geometry.points[0]!;
      try {
        result = await context.surface.focusAt(at, { signal: operation.signal });
      } catch {
        result = failure('internal', 'The personal mark could not be located.');
      }
    }
    if (operation.signal.aborted) result = failure('aborted', 'Personal mark focus was cancelled.');
    if (!life.signal.aborted && ticket === action)
      feedback = result.ok ? 'Personal mark located on the map.' : result.error.message;
    return result;
  }
  async function plotPaper(context: ShellViewContext, paperId: string): Promise<Result<void>> {
    const ticket = ++action;
    const operation = beginFocus();
    const snapshot = context.sourceState.snapshot;
    const paper = snapshot?.papers.find((item) => item.id === paperId);
    if (
      life.signal.aborted ||
      !snapshot ||
      !paper?.location ||
      !sameScope(snapshot.scope, source.scope) ||
      !sameScope(snapshot.scope, context.surface.scope) ||
      !sameScope(snapshot.scope, context.navigation.scope)
    ) {
      const result = failure('invalid-data', 'No approved report location is available.');
      if (!life.signal.aborted && ticket === action && !result.ok) feedback = result.error.message;
      return result;
    }
    const created = personalMarks.create(
      {
        label: `${paper.from}: report`.slice(0, 256),
        geometry: { kind: 'pin', at: { ...paper.location } },
        source: { kind: 'paper', paperId },
      },
      snapshot,
      projectGameTime(context.sourceState, source.kind, monotonicMs),
    );
    if (!created.ok) {
      if (!life.signal.aborted && ticket === action) feedback = created.error.message;
      return created;
    }
    // Creation succeeded in local RAM. Navigation/focus failure must not invite duplicate creation.
    let located: Result<void>;
    try {
      const selected = context.navigation.select({
        kind: 'paper',
        id: paperId,
        scope: snapshot.scope,
      });
      if (!selected.ok) throw new Error('Report selection failed');
      const navigated = await context.navigation.navigate('table', null, {
        signal: operation.signal,
      });
      located =
        navigated.ok && !operation.signal.aborted
          ? await context.surface.focusAt(paper.location, { signal: operation.signal })
          : navigated.ok
            ? failure('aborted', 'Map navigation was cancelled.')
            : navigated;
    } catch {
      located = failure('internal', 'The report mark could not be located on the map.');
    }
    if (!life.signal.aborted && ticket === action)
      feedback = located.ok
        ? 'Report plotted locally. Save local marks to retain it.'
        : `Report mark created locally. ${located.error.message} Save local marks to retain it.`;
    return success(undefined);
  }
  onDestroy(() => {
    life.abort();
    focusOperation?.abort();
    personalMarks.dispose();
  });
</script>

<Shell {source} {surface} {repository} {artwork} marks={markState.marks}>
  {#snippet clock(context: ShellViewContext)}
    <Clock
      state={context.sourceState}
      kind={source.kind}
      gameMs={projectGameTime(context.sourceState, source.kind, monotonicMs)}
      compact={context.state.view === 'table'}
    />
    <p class="session-feedback" role="status" aria-live="polite">{feedback}</p>
  {/snippet}
  {#snippet tableTools(context: ShellViewContext)}
    <Marks
      marks={markState.marks}
      {artwork}
      papers={context.sourceState.snapshot?.papers ?? []}
      busy={markState.busy}
      writable={markState.writable}
      dirty={markState.dirty}
      status={markState.error?.message ??
        (markState.busy
          ? 'Personal marks storage is busy.'
          : markState.dirty
            ? 'Personal marks have unsaved changes.'
            : 'Personal marks are saved in this browser.')}
      onCreate={(input) =>
        personalMarks.create(
          input,
          context.sourceState.snapshot,
          context.sourceState.snapshot
            ? projectGameTime(context.sourceState, source.kind, monotonicMs)
            : null,
        )}
      onEdit={(id, input) =>
        personalMarks.edit(
          id,
          input,
          context.sourceState.snapshot
            ? projectGameTime(context.sourceState, source.kind, monotonicMs)
            : null,
        )}
      onDelete={(id) => personalMarks.remove(id)}
      onSave={() => personalMarks.save()}
      onReload={() => personalMarks.reload()}
      onFocus={(id) => focusMark(context, id)}
    />
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
    {:else if context.state.view === 'in-tray'}
      <InTray
        snapshot={context.sourceState.snapshot}
        scope={source.scope}
        onPlotPaper={(id) => plotPaper(context, id)}
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
