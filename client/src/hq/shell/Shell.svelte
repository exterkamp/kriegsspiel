<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import type {
    HqDataSource,
    HqNavigation,
    HqRepository,
    HqSnapshot,
    LocalDocument,
    MapSurface,
    PublicArtwork,
    Result,
    ShellState,
    SourceState,
    ViewId,
  } from '../contracts';
  import { createHqNavigation, routes, sameScope } from './navigation';
  import type { ShellViewContext } from './types';

  let {
    surface,
    source,
    artwork,
    repository,
    navigation,
    view,
    clock,
  }: {
    surface: MapSurface;
    source: HqDataSource;
    artwork: PublicArtwork;
    repository: HqRepository;
    navigation?: HqNavigation;
    view?: Snippet<[ShellViewContext]>;
    clock?: Snippet<[ShellViewContext]>;
  } = $props();
  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let nav = $state<HqNavigation>();
  let shellState = $state<ShellState>({
    scope: { gameId: '', sideId: '', playerId: '' },
    view: 'table',
    selection: { kind: 'none' },
  });
  let data = $state<SourceState>({ connection: 'idle', stale: false, snapshot: null, error: null });
  let error = $state('');
  let storageStatus = $state('Preferences not loaded.');
  let highContrast = $state(false);
  let reducedMotion = $state(false);
  let systemMotion = $state(false);
  let ready = $state(false);
  let busy = $state(false);
  let document: LocalDocument | null = null;
  let alive = false;
  let life: AbortController;
  let applyController: AbortController | null = null;
  let applyQueue: Promise<unknown> = Promise.resolve();
  let saveQueue: Promise<unknown> = Promise.resolve();
  let newest: HqSnapshot | null = null;
  let candidate: SourceState | null = null;
  let synchronizingSelection = false;
  const choices = { view: 0, selection: 0, contrast: 0, motion: 0, camera: 0 };
  let cameraRestoreChoice = 0;
  let pendingCamera: LocalDocument['camera'] = null;
  let unsubscribeData = () => {};
  let unsubscribeNavigation = () => {};
  // Both slots share accepted data; the coordinator owns display-time projection.
  const context = $derived<ShellViewContext | null>(
    nav
      ? {
          state: shellState,
          sourceState: data,
          navigation: nav,
          surface,
          capabilities: source.capabilities,
        }
      : null,
  );
  const motion = () => reducedMotion || systemMotion;
  function report<T>(result: Result<T>): result is { ok: true; value: T } {
    if (result.ok === false && result.error.code !== 'aborted' && alive)
      error = result.error.message;
    return result.ok;
  }
  async function focus(viewId: ViewId, key: string | null, signal: AbortSignal) {
    await tick();
    if (!alive || signal.aborted) return;
    const object = key
      ? Array.from(root.querySelectorAll<HTMLButtonElement>('[data-focus-key]')).find(
          (el) => el.dataset.focusKey === key,
        )
      : null;
    (object ?? root.querySelector<HTMLElement>(`[data-heading="${viewId}"]`))?.focus();
  }
  let navigationTicket = 0;
  async function go(viewId: ViewId, key: string | null = null, restoring = false) {
    if (!ready) return;
    if (!restoring) choices.view++;
    const ticket = ++navigationTicket;
    busy = true;
    try {
      const result = await nav!.navigate(viewId, key, { signal: life.signal });
      if (!alive || ticket !== navigationTicket) return;
      if (report(result)) persist();
    } catch {
      if (alive && ticket === navigationTicket) error = 'Navigation failed. Please try again.';
    } finally {
      if (alive && ticket === navigationTicket) busy = false;
    }
  }
  function invoke<T>(action: () => Result<T>): Result<T> {
    try {
      return action();
    } catch {
      return {
        ok: false,
        error: { code: 'internal', message: 'The map operation failed.', retry: 'never' },
      };
    }
  }
  async function focusSelection() {
    choices.camera++;
    const selection = shellState.selection;
    const piece = data.snapshot?.pieces.find(
      (p) => selection.kind === 'unit' && p.relationship === 'own' && p.unitId === selection.id,
    );
    if (!piece) return;
    try {
      report(await surface.focusAt(piece.position, { signal: life.signal }));
    } catch {
      if (alive) error = 'The map focus operation failed.';
    }
  }
  function persist() {
    if (!document || !alive) return;
    const desired = {
      view: shellState.view,
      selection: shellState.selection,
      highContrast,
      reducedMotion,
    };
    const camera = invoke(() => surface.getCamera());
    const save = async () => {
      if (!document || !alive) return;
      try {
        const result = await repository.save(
          { ...document, ...desired, camera: camera.ok ? camera.value : document.camera },
          document.revision,
          { signal: life.signal },
        );
        if (!alive) return;
        if (result.ok === true) {
          document = result.value.document;
          storageStatus = `Preferences saved (${result.value.durability}).`;
        } else {
          storageStatus = `Preferences not saved: ${result.error.message}`;
          if (result.error.code === 'conflict') document = null;
        }
      } catch {
        if (alive) storageStatus = 'Preferences not saved: repository failed.';
      }
    };
    saveQueue = saveQueue.then(save, save);
  }
  function selectionFor(snapshot: HqSnapshot) {
    const selection = shellState.selection;
    if (selection.kind === 'none') return selection;
    const exists =
      sameScope(selection.scope, snapshot.scope) &&
      (selection.kind === 'paper'
        ? snapshot.papers.some((p) => p.id === selection.id)
        : snapshot.pieces.some((p) => p.relationship === 'own' && p.unitId === selection.id));
    return exists ? selection : { kind: 'none' as const };
  }
  function publishHealth(next: SourceState) {
    // Valid source health is independent of renderer success. Keep rendered knowledge
    // but revoke freshness until the current presentation accepts it.
    applyController?.abort();
    candidate = null;
    data = { ...data, connection: next.connection, error: next.error, stale: true };
    if (next.error) error = next.error.message;
  }
  function receive(next: SourceState) {
    if (!ready || !alive) return;
    if (!next.snapshot) {
      publishHealth(next);
      return;
    }
    const snapshot = next.snapshot;
    if (source.kind !== 'fixture') {
      error = 'Live map presentation is unavailable under this fixture contract.';
      return;
    }
    if (!sameScope(snapshot.scope, source.scope)) {
      error = 'Snapshot belongs to another HQ session.';
      return;
    }
    if (
      newest &&
      (snapshot.epoch !== newest.epoch ||
        snapshot.ordinal < newest.ordinal ||
        snapshot.atGame < newest.atGame)
    ) {
      error = 'Obsolete snapshot rejected; reopen this HQ session to change epochs.';
      return;
    }
    if (
      newest &&
      snapshot.ordinal === newest.ordinal &&
      JSON.stringify(snapshot) !== JSON.stringify(newest)
    ) {
      error = 'Conflicting snapshot observation rejected.';
      return;
    }
    // Reject invalid observations atomically, including their claimed health.
    publishHealth(next);
    newest = snapshot;
    candidate = next;
    applyCandidate();
  }
  function applyCandidate() {
    const next = candidate;
    const snapshot = next?.snapshot;
    if (!snapshot || !ready || !alive) return;
    applyController?.abort();
    const controller = new AbortController();
    applyController = controller;
    data = { ...data, stale: true };
    const selection = selectionFor(snapshot);
    const apply = async () => {
      if (!alive || controller.signal.aborted) return;
      try {
        const result = await surface.apply(
          {
            scope: snapshot.scope,
            revision: crypto.randomUUID(),
            snapshot: { atGame: snapshot.atGame, epoch: snapshot.epoch, ordinal: snapshot.ordinal },
            artwork,
            mode: 'fixture-knowledge-preview',
            pieces: snapshot.pieces,
            selection,
          },
          { signal: controller.signal },
        );
        if (!alive || controller.signal.aborted) return;
        if (!report(result)) return;
        // Desk data becomes authoritative for this UI only after the same map apply succeeds.
        data = { ...next, stale: next.stale || next.connection !== 'ready' || next.error !== null };
        if (next.error) error = next.error.message;
        if (JSON.stringify(selection) !== JSON.stringify(shellState.selection)) {
          synchronizingSelection = true;
          try {
            report(nav!.select(selection));
          } finally {
            synchronizingSelection = false;
          }
        }
        if (pendingCamera) {
          if (choices.camera === cameraRestoreChoice)
            report(invoke(() => surface.restoreCamera(pendingCamera!)));
          pendingCamera = null;
        }
      } catch {
        if (alive && !controller.signal.aborted) error = 'The map presentation failed.';
      }
    };
    applyQueue = applyQueue.then(apply, apply);
  }
  function snap(view: 'top-down' | 'oblique') {
    choices.camera++;
    report(invoke(() => surface.snap(view)));
    persist();
  }
  function changeContrast(event: Event) {
    choices.contrast++;
    highContrast = (event.currentTarget as HTMLInputElement).checked;
    persist();
  }
  function changeMotion(event: Event) {
    choices.motion++;
    reducedMotion = (event.currentTarget as HTMLInputElement).checked;
    persist();
  }
  function pick(event: MouseEvent) {
    if (!ready || busy || shellState.view !== 'table') return;
    const result = invoke(() => surface.pickAt(event.clientX, event.clientY));
    if (!report(result) || result.value.kind !== 'piece') return;
    const hit = result.value;
    const own = data.snapshot?.pieces.find(
      (p) => p.key === hit.key && p.unitId === hit.unitId && p.relationship === 'own',
    );
    if (own) {
      report(nav!.select({ kind: 'unit', id: own.unitId, scope: source.scope }));
      persist();
    }
  }
  function shortcut(event: KeyboardEvent) {
    const target = event.target;
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !(target instanceof Element)
    )
      return;
    if (
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]',
      ) ||
      root.ownerDocument.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
    )
      return;
    const route = routes.find((r) => r.key === event.key.toLowerCase());
    if (route) {
      event.preventDefault();
      void go(route.view, route.view);
    } else if (event.key === 'Escape' && shellState.view !== 'table') {
      event.preventDefault();
      void go('table');
    }
  }
  function unavailable(viewId: ViewId): string {
    const feature =
      viewId === 'orders'
        ? 'sign-order'
        : viewId === 'conference'
          ? 'conference'
          : viewId === 'replay'
            ? 'replay'
            : viewId === 'roster'
              ? 'roster-reports'
              : viewId === 'in-tray'
                ? 'dispatch-sketches'
                : 'personal-marks';
    const capability = source.capabilities[feature];
    return capability.state === 'unavailable'
      ? capability.reason
      : 'This desk view is awaiting its dedicated component. No action service is connected here.';
  }
  onMount(() => {
    alive = true;
    life = new AbortController();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    systemMotion = media.matches;
    const changed = () => {
      systemMotion = media.matches;
    };
    media.addEventListener('change', changed);
    nav = navigation ?? createHqNavigation({ surface, reducedMotion: motion, focus });
    const consistent = [surface.scope, repository.scope, nav!.scope].every((scope) =>
      sameScope(scope, source.scope),
    );
    const resize = () => {
      if (!ready) return;
      const box = canvas.getBoundingClientRect();
      if (box.width > 0 && box.height > 0)
        report(invoke(() => surface.resize(box.width, box.height, window.devicePixelRatio || 1)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const initialize = async () => {
      if (!consistent) {
        error = 'HQ ports belong to different game, side or player sessions.';
        return;
      }
      try {
        if (!report(await surface.mount(canvas, { signal: life.signal })) || !alive) return;
        ready = true;
        resize();
        unsubscribeNavigation = nav!.subscribe((next) => {
          if (!alive) return;
          if (!sameScope(next.scope, source.scope)) {
            error = 'Navigation belongs to another HQ session.';
            return;
          }
          const changedSelection =
            JSON.stringify(shellState.selection) !== JSON.stringify(next.selection);
          if (!synchronizingSelection) {
            if (changedSelection) choices.selection++;
            if (shellState.view !== next.view) choices.view++;
          }
          shellState = next;
          if (changedSelection && !synchronizingSelection) applyCandidate();
        });
        unsubscribeData = source.subscribe(receive);
        const loadChoices = { ...choices };
        // Read-only source opening is independent of restoring local preferences.
        const opening = source.open({ signal: life.signal }).catch((): Result<HqSnapshot> => ({
          ok: false,
          error: { code: 'internal', message: 'The source failed to open.', retry: 'never' },
        }));
        const loaded = await repository.load({ signal: life.signal });
        if (!alive) return;
        if (
          loaded.ok &&
          loaded.value.document.schemaVersion === 1 &&
          sameScope(loaded.value.document.scope, source.scope) &&
          (loaded.value.document.selection.kind === 'none' ||
            sameScope(loaded.value.document.selection.scope, source.scope))
        ) {
          document = loaded.value.document;
          if (choices.contrast === loadChoices.contrast) highContrast = document.highContrast;
          if (choices.motion === loadChoices.motion) reducedMotion = document.reducedMotion;
          storageStatus = `Preferences loaded (${loaded.value.durability}).`;
          const camera = document.camera;
          if (
            choices.camera === loadChoices.camera &&
            camera?.mapId === artwork.id &&
            camera.mapRevision === artwork.revision
          ) {
            pendingCamera = camera;
            cameraRestoreChoice = choices.camera;
          }
          if (choices.selection === loadChoices.selection) {
            synchronizingSelection = true;
            try {
              report(nav!.select(document.selection));
            } finally {
              synchronizingSelection = false;
            }
            applyCandidate();
          }
        } else {
          storageStatus =
            loaded.ok === true
              ? 'Preferences rejected: incompatible version or scope.'
              : `Preferences unavailable: ${loaded.error.message}`;
        }
        const opened = await opening;
        if (!alive) return;
        if (report(opened)) {
          // The subscription may already have delivered a newer observation.
          receive(source.getState());
          await applyQueue;
        }
        if (document && ready && choices.view === loadChoices.view)
          await go(document.view, null, true);
        if (document) persist();
      } catch {
        if (alive) error = 'HQ initialization failed. No fallback service was started.';
      }
    };
    void initialize();
    return () => {
      alive = false;
      life.abort();
      applyController?.abort();
      observer.disconnect();
      media.removeEventListener('change', changed);
      unsubscribeData();
      unsubscribeNavigation();
      nav!.dispose();
      surface.dispose();
      source.dispose();
      repository.dispose();
    };
  });
</script>

<svelte:window onkeydown={shortcut} />
<section
  bind:this={root}
  class="hq"
  class:high-contrast={highContrast}
  class:reduced-motion={motion()}
  aria-label="Headquarters desk"
  aria-busy={busy}
>
  <div
    class="map-layer"
    class:at-desk={shellState.view !== 'table'}
    inert={shellState.view !== 'table'}
  >
    <canvas
      bind:this={canvas}
      onclick={pick}
      onpointerdown={() => choices.camera++}
      onwheel={() => choices.camera++}
      aria-label="Fixture knowledge map; select own pieces using the list below"
    ></canvas>
  </div>
  <header>
    <h1>Headquarters</h1>
    {#if clock && context}{@render clock(context)}{/if}
    <p>
      {source.kind === 'fixture'
        ? 'Fixture / demo — no live game services'
        : 'Read-only source — no command services'}
    </p>
    {#if surface.implementation === 'legacy-tile-preview'}<p class="notice">
        Degraded legacy preview: tile-centre placement, eight-way facing; continuous geometry and
        footprints unavailable.
      </p>{/if}
    <p>
      Source: {data.connection}{data.stale ? ' · stale snapshot' : ''}{data.snapshot
        ? ` · snapshot at ${data.snapshot.atGame} game ms`
        : ' · no snapshot available'}
    </p>
  </header>
  <nav class="desk" aria-label="Desk objects">
    {#each routes as route (route.view)}<button
        data-focus-key={route.view}
        aria-current={shellState.view === route.view ? 'page' : undefined}
        disabled={!ready}
        onclick={() => go(route.view, route.view)}
        ><span>{route.object}</span><strong>{route.label}</strong><small
          >Key {route.key.toUpperCase()}</small
        ></button
      >{/each}
  </nav>
  <main class:paper={shellState.view !== 'table'}>
    <h2 tabindex="-1" data-heading={shellState.view}>
      {routes.find((route) => route.view === shellState.view)?.label}
    </h2>
    {#if shellState.view === 'table'}
      <div class="map-tools">
        <button disabled={!ready || busy} onclick={() => snap('top-down')}>Top-down</button>
        <button disabled={!ready || busy} onclick={() => snap('oblique')}>Oblique</button>
        <label
          >Own-piece selection <select
            disabled={!ready || busy}
            value={shellState.selection.kind === 'unit' ? shellState.selection.id : ''}
            onchange={(event) => {
              choices.selection++;
              report(
                nav!.select(
                  event.currentTarget.value
                    ? { kind: 'unit', id: event.currentTarget.value, scope: source.scope }
                    : { kind: 'none' },
                ),
              );
              persist();
            }}
            ><option value="">No piece selected</option
            >{#each data.snapshot?.pieces.filter((piece) => piece.relationship === 'own') ?? [] as piece (piece.key)}<option
                value={piece.unitId}>{piece.label}</option
              >{/each}</select
          ></label
        >
        <button
          disabled={!ready || busy || shellState.selection.kind !== 'unit'}
          onclick={focusSelection}>Focus selected piece</button
        >
      </div>
      <p class="credit">{artwork.credit} · {artwork.licence}</p>
    {:else}
      <button onclick={() => go('table')}>Return to map table</button>
      {#if view}{@render view(context!)}{:else}<p class="empty">{unavailable(shellState.view)}</p>
        <p>
          This is an empty fixture desk view. Orders, annotations, staff requests and replay reveal
          are unavailable.
        </p>{/if}
    {/if}
    <p class="selection">
      Shared selection: {shellState.selection.kind === 'none'
        ? 'none'
        : `${shellState.selection.kind} ${shellState.selection.id}`}
    </p>
  </main>
  <footer>
    <label
      ><input type="checkbox" checked={highContrast} onchange={changeContrast} /> High contrast</label
    >
    <label
      ><input type="checkbox" checked={reducedMotion} onchange={changeMotion} /> Reduce motion</label
    >
    <p role="status" aria-live="polite">{storageStatus}</p>
    <p class="error" role="status" aria-live="polite">{error}</p>
  </footer>
</section>

<style>
  .hq {
    --paper: #f3e7c8;
    --ink: #21180f;
    position: relative;
    isolation: isolate;
    min-height: 100vh;
    color: var(--ink);
    background: #39291c;
    font-family: Georgia, 'Times New Roman', serif;
    padding: 1.2rem;
    box-sizing: border-box;
  }
  .map-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    opacity: 0.85;
    transition: opacity 180ms ease;
  }
  .map-layer.at-desk {
    opacity: 0.18;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  header,
  footer,
  main {
    background: var(--paper);
    padding: 1rem 1.4rem;
    max-width: 64rem;
    margin: 0 auto 1rem;
    border: 2px solid #503821;
    box-shadow: 0 3px 12px #0006;
  }
  h1,
  h2 {
    margin: 0 0 0.5rem;
    font-weight: normal;
  }
  p {
    line-height: 1.5;
    margin: 0.5rem 0;
  }
  .desk {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
    margin: 1rem auto;
    max-width: 70rem;
  }
  button,
  select {
    font: inherit;
    color: var(--ink);
    background: var(--paper);
    border: 2px solid #503821;
    padding: 0.65rem 0.9rem;
    cursor: pointer;
  }
  button:disabled,
  select:disabled {
    cursor: default;
    opacity: 0.65;
  }
  .desk button {
    min-width: 8rem;
    box-shadow: 2px 4px 0 #1f140c;
  }
  .desk span,
  .desk strong,
  .desk small {
    display: block;
  }
  .desk span {
    font-style: italic;
    margin-bottom: 0.3rem;
  }
  .desk small {
    margin-top: 0.3rem;
  }
  [aria-current='page'] {
    outline: 3px solid #c1a361;
  }
  :focus-visible,
  h2:focus {
    outline: 3px solid #185f89;
    outline-offset: 4px;
  }
  .map-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }
  .paper {
    min-height: 18rem;
    max-width: 48rem;
    font-size: 1.15rem;
  }
  footer label {
    display: inline-block;
    margin-right: 1rem;
  }
  .error,
  .notice {
    font-weight: bold;
  }
  .error {
    color: #8b1912;
  }
  .high-contrast {
    --paper: #fff;
    --ink: #000;
  }
  .high-contrast button,
  .high-contrast select {
    border-color: #000;
  }
  .reduced-motion .map-layer {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .map-layer {
      transition: none;
    }
  }
  @media (max-width: 600px) {
    .hq {
      padding: 0.5rem;
    }
    .desk button {
      min-width: 6rem;
      flex: 1;
    }
    header,
    footer,
    main {
      padding: 0.8rem;
    }
  }
</style>
