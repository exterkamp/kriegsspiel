<script lang="ts">
  import type { SourceState } from '../../contracts';
  import { clockDisplay, formatGameTime, validGameTime } from './presentation';

  let {
    state,
    kind,
    gameMs,
    compact = false,
  }: {
    state: SourceState;
    kind: 'fixture' | 'live';
    gameMs: number | null;
    compact?: boolean;
  } = $props();
  const clock = $derived(state.snapshot?.clock);
  const display = $derived(clockDisplay(state, kind, gameMs));
  const rate = $derived(
    clock && Number.isFinite(clock.rate) && clock.rate > 0 ? `${clock.rate}:1` : 'Unavailable',
  );
  const mode = $derived(
    clock && ['realtime', 'manual', 'fast-forward', 'unknown'].includes(clock.mode)
      ? clock.mode
      : 'unknown',
  );
  const status = $derived(
    clock && ['running', 'paused', 'stopped'].includes(clock.status) ? clock.status : 'unknown',
  );
  const barrier = $derived(clock?.barrier?.kind ?? 'unknown');
  const need = $derived(
    clock?.barrier?.kind === 'working' &&
      validGameTime(clock.barrier.needAtGame) &&
      validGameTime(clock.authoritativeGameMs) &&
      clock.barrier.needAtGame >= clock.authoritativeGameMs
      ? clock.barrier.needAtGame
      : null,
  );
</script>

<section class="clock" class:compact aria-label="HQ game clock">
  <p class="title">{kind === 'fixture' ? 'Fixture clock' : 'Live clock observation'}</p>
  <dl>
    <div class="time">
      <dt>Game time</dt>
      <dd>{formatGameTime(display.time)}</dd>
    </div>
    <div>
      <dt>Supplied rate</dt>
      <dd>{rate}</dd>
    </div>
    <div>
      <dt>Supplied status</dt>
      <dd>{status}</dd>
    </div>
    <div>
      <dt>Mode</dt>
      <dd>{mode}</dd>
    </div>
    <div>
      <dt>Connection</dt>
      <dd>{state.connection}</dd>
    </div>
    <div>
      <dt>Freshness</dt>
      <dd>{state.stale ? 'Stale observation' : 'Not marked stale'}</dd>
    </div>
  </dl>
  <p class="barrier" role="status" aria-live="polite">
    {#if barrier === 'working'}
      Staff at work · display held. {need === null
        ? 'Need time unavailable.'
        : `Supplied need time: ${formatGameTime(need)}.`}
    {:else if barrier === 'clear'}Barrier clear in supplied observation.
    {:else}Barrier unknown · display held.{/if}
  </p>
  <p class="provenance">
    {#if display.time === null}Game time unavailable; no valid authoritative anchor supplied.
    {:else if display.projected}Shared parent display time · eligible realtime fixture.
    {:else}Frozen at supplied authoritative game time.{/if}
    {#if kind === 'live'}
      Live clock projection is unavailable.{/if}
  </p>
  {#if !compact}<p>Clock controls and pause voting are unavailable in this view.</p>{/if}
</section>

<style>
  .clock {
    color: var(--ink, #21180f);
    background: var(--paper, #f3e7c8);
    font-family: Georgia, 'Times New Roman', serif;
    border: 1px solid currentColor;
    padding: 0.8rem;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0.4rem 0;
    line-height: 1.4;
  }
  .title {
    font-weight: bold;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.4rem;
    margin: 0.5rem 0;
  }
  dt {
    font-size: 0.9em;
  }
  dd {
    margin: 0;
  }
  .time dd {
    font-variant-numeric: tabular-nums;
    font-size: 1.15em;
  }
  .barrier {
    font-weight: bold;
  }
  .compact {
    padding: 0.4rem 0.7rem;
    font-size: 0.9rem;
  }
  .compact dl {
    gap: 0.3rem 1rem;
  }
</style>
