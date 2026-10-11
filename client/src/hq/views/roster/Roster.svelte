<script lang="ts">
  import { onDestroy } from 'svelte';
  import type {
    HqNavigation,
    HqSnapshot,
    MapSurface,
    RosterRow,
    Result,
    ShellState,
  } from '../../contracts';
  import Table from '../../ui/Table.svelte';
  import { numberValue, provenance, sameScope, sharesSnapshot, snapshotAge } from './presentation';

  // Borrowed ports: the coordinator owns their lifecycle and display clock.
  let {
    snapshot,
    navigation,
    surface,
    gameMs,
    onFocusUnit,
  }: {
    snapshot: HqSnapshot | null;
    navigation: HqNavigation;
    surface: MapSurface;
    gameMs: number | null;
    /** Session-owned handoff. Root teardown owns cancellation; view teardown only ignores completion. */
    onFocusUnit?: (unitId: string) => Promise<Result<void>>;
  } = $props();
  let status = $state('');
  let pendingId = $state<string | null>(null);
  let alive = true;
  let request = 0;
  let operation: AbortController | null = null;
  let unsubscribe = () => {};
  let observedSnapshot: HqSnapshot | null | undefined;
  let observedNavigation: HqNavigation | undefined;
  let observedSurface: MapSurface | undefined;
  const compatible = $derived(
    snapshot === null ||
      (sameScope(snapshot.scope, navigation.scope) && sameScope(snapshot.scope, surface.scope)),
  );
  // The frozen roster is already the filtered own-formation list. Never add contacts from pieces.
  const rows = $derived(compatible ? (snapshot?.roster ?? []) : []);

  function cancel(message = 'Formation focus canceled.') {
    request++;
    operation?.abort();
    operation = null;
    unsubscribe();
    unsubscribe = () => {};
    if (alive) {
      pendingId = null;
      status = message;
    }
  }
  $effect(() => {
    const current = snapshot;
    const currentNavigation = navigation;
    const currentSurface = surface;
    if (
      observedSnapshot !== undefined &&
      (observedSnapshot !== current ||
        observedNavigation !== currentNavigation ||
        observedSurface !== currentSurface)
    ) {
      if (operation)
        cancel(
          onFocusUnit
            ? 'Roster changed; the map action remains with headquarters.'
            : 'Formation focus canceled because the snapshot or session changed.',
        );
    }
    observedSnapshot = current;
    observedNavigation = currentNavigation;
    observedSurface = currentSurface;
  });
  function selected(state: ShellState, origin: HqSnapshot, id: string): boolean {
    return (
      sameScope(state.scope, origin.scope) &&
      state.selection.kind === 'unit' &&
      state.selection.id === id &&
      sameScope(state.selection.scope, origin.scope)
    );
  }
  async function focusFormation(row: RosterRow) {
    cancel('');
    const origin = snapshot;
    if (!alive || !origin) return;
    if (!sameScope(origin.scope, navigation.scope) || !sameScope(origin.scope, surface.scope)) {
      status = 'Formation focus unavailable: ports belong to another HQ session.';
      return;
    }
    if (!origin.roster.includes(row) || row.position.kind !== 'snapshot') {
      status = 'Formation focus unavailable: no supplied position.';
      return;
    }
    const id = row.unitId;
    const position = row.position.value;
    const nav = navigation;
    const map = surface;
    const controller = new AbortController();
    operation = controller;
    const ticket = ++request;
    const current = () =>
      alive &&
      ticket === request &&
      !controller.signal.aborted &&
      snapshot === origin &&
      navigation === nav &&
      surface === map;
    let release = () => {};
    let stage: 'navigation' | 'focus' = 'navigation';
    pendingId = id;
    status = `Opening the map table for ${row.name}…`;
    try {
      if (onFocusUnit) {
        // No view-owned AbortSignal crosses this boundary. Navigation may unmount us.
        const focused = await onFocusUnit(id);
        if (!current()) return;
        status =
          focused.ok === true
            ? `${row.name} focused at its supplied snapshot position.`
            : focused.error.code === 'aborted'
              ? 'Formation focus canceled.'
              : `Map focus failed: ${focused.error.message}`;
        return;
      }
      const selection = nav.select({ kind: 'unit', id, scope: origin.scope });
      if (selection.ok === false) {
        if (current()) status = `Selection failed: ${selection.error.message}`;
        return;
      }
      if (!selected(selection.value, origin, id)) {
        status = 'Selection failed: the navigation session did not accept this scoped formation.';
        return;
      }
      release = nav.subscribe((state) => {
        if (
          current() &&
          (!selected(state, origin, id) || (stage === 'focus' && state.view !== 'table'))
        )
          cancel('Formation focus canceled because navigation or selection changed.');
      });
      unsubscribe = release;
      if (!current()) return;
      const result = await nav.navigate('table', null, { signal: controller.signal });
      if (!current()) return;
      if (result.ok === false) {
        status =
          result.error.code === 'aborted'
            ? 'Formation focus canceled.'
            : `Navigation failed: ${result.error.message}`;
        return;
      }
      if (
        result.value.view !== 'table' ||
        !selected(result.value, origin, id) ||
        !selected(nav.getState(), origin, id) ||
        nav.getState().view !== 'table'
      ) {
        status =
          'Formation focus canceled: the selected formation is no longer active on the map table.';
        return;
      }
      stage = 'focus';
      status = `Focusing ${row.name} at its supplied snapshot position…`;
      const focused = await map.focusAt(position, { signal: controller.signal });
      if (!current()) return;
      status =
        focused.ok === true
          ? `${row.name} focused at its supplied snapshot position.`
          : focused.error.code === 'aborted'
            ? 'Formation focus canceled.'
            : `Map focus failed: ${focused.error.message}`;
    } catch {
      if (current()) status = 'Formation focus failed. Please try again.';
    } finally {
      release();
      if (ticket === request) {
        unsubscribe();
        unsubscribe = () => {};
        operation = null;
        if (alive) pendingId = null;
      }
    }
  }
  onDestroy(() => {
    alive = false;
    cancel();
  });
</script>

<section class="roster" aria-label="Order of battle roster" aria-busy={pendingId !== null}>
  <h3>Order of battle</h3>
  <p class="notice">
    Fixture roster — supplied own formations only. Report dates unavailable; these values have
    snapshot provenance. Commander information is unavailable in this fixture projection.
  </p>
  {#if !compatible}
    <p role="status">
      Roster unavailable: snapshot, navigation and map surface belong to different HQ sessions.
    </p>
  {:else if snapshot === null}
    <p>No roster snapshot available. Waiting for a supplied snapshot.</p>
  {:else if rows.length === 0}
    <p class:stale={(snapshotAge(snapshot.atGame, gameMs) ?? 0) > 0}>
      {provenance(snapshot.atGame, gameMs)}
    </p>
    <p>No own formations supplied in this snapshot.</p>
  {:else}
    <Table label="Own formations; scroll to read all seven columns and map actions">
      {#snippet caption()}
        <strong>Own formations — snapshot values, report dates unavailable</strong>
        <small class:stale={(snapshotAge(snapshot.atGame, gameMs) ?? 0) > 0}>
          {provenance(snapshot.atGame, gameMs)}. Applies to supplied values unless separately
          annotated below; unknown fields remain unavailable.
        </small>
      {/snippet}
      {#snippet header()}
        <tr>
          <th scope="col" style="width: 20%">Formation</th>
          <th scope="col" style="width: 15%">Commander</th>
          <th scope="col" style="width: 9%">Strength</th>
          <th scope="col" style="width: 9%">Morale</th>
          <th scope="col" style="width: 9%">Supply</th>
          <th scope="col" style="width: 22%">Position</th>
          <th scope="col" style="width: 16%">Map table</th>
        </tr>
      {/snippet}
      {#snippet body()}
        {#each rows as row (row.unitId)}
          <tr>
            <th class="table-text" scope="row">{row.name}</th>
            <td class="table-text">
              <strong>Unknown</strong><small
                >{row.commander.kind === 'unknown'
                  ? row.commander.reason
                  : 'Commander information unavailable in this fixture projection.'}</small
              >
            </td>
            {#each [{ label: 'Strength', knowledge: row.strength, percent: false }, { label: 'Morale', knowledge: row.morale, percent: true }, { label: 'Supply', knowledge: row.supply, percent: true }] as field (field.label)}
              <td
                class="table-value"
                class:stale={field.knowledge.kind === 'snapshot' &&
                  (snapshotAge(field.knowledge.atGame, gameMs) ?? 0) > 0}
              >
                <strong>{numberValue(field.knowledge, field.percent)}</strong>
                {#if field.knowledge.kind === 'unknown'}
                  <small>{field.knowledge.reason}</small>
                {:else if !sharesSnapshot(field.knowledge.atGame, snapshot.atGame)}
                  <small>{provenance(field.knowledge.atGame, gameMs)}</small>
                {/if}
              </td>
            {/each}
            <td
              class="table-value"
              class:stale={row.position.kind === 'snapshot' &&
                (snapshotAge(row.position.atGame, gameMs) ?? 0) > 0}
            >
              {#if row.position.kind === 'unknown'}<strong>Unknown</strong><small
                  >{row.position.reason}</small
                >{:else}<strong
                  ><span class="coordinate">{row.position.value.x} m east,</span>
                  <span class="coordinate">{row.position.value.y} m south</span></strong
                >
                {#if !sharesSnapshot(row.position.atGame, snapshot.atGame)}
                  <small>{provenance(row.position.atGame, gameMs)}</small>
                {/if}
              {/if}
            </td>
            <td class="table-action"
              ><button
                disabled={row.position.kind === 'unknown' || (!!onFocusUnit && pendingId !== null)}
                onclick={() => focusFormation(row)}
                aria-label={`Focus ${row.name} on map table`}
                >{pendingId === row.unitId ? 'Opening / focusing…' : 'Focus on map table'}</button
              >{#if row.position.kind === 'unknown'}<small
                  >Focus unavailable: position unknown.</small
                >{/if}</td
            >
          </tr>
        {/each}
      {/snippet}
    </Table>
  {/if}
  {#if pendingId !== null && !onFocusUnit}<button onclick={() => cancel()}
      >Cancel formation focus</button
    >{/if}
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .roster {
    color: var(--ink, inherit);
    font-family: Georgia, 'Times New Roman', serif;
    line-height: 1.5;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: normal;
    word-break: normal;
  }
  h3 {
    font-size: 1.3rem;
    margin: 1rem 0 0.5rem;
  }
  .notice {
    border-left: 0.25rem solid currentColor;
    padding-left: 0.8rem;
  }
  small {
    display: block;
    font-size: 0.85rem;
  }
  .coordinate {
    display: block;
  }
  td strong {
    font-weight: normal;
  }
  .stale {
    border-left: 0.2rem dashed currentColor;
    padding-left: 0.6rem;
  }
  button {
    font: inherit;
    color: inherit;
    background: var(--paper, transparent);
    border: 2px solid currentColor;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    border-style: dashed;
  }
  :focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
  .status {
    min-height: 1.5em;
    font-weight: bold;
  }
</style>
