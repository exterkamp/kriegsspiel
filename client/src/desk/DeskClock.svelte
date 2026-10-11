<script lang="ts">
  import { onMount } from 'svelte';
  import { activeView, gameState } from './store.js';
  import { clockSummary, clockView } from './clock.js';

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  const v = $derived(clockView($gameState, now));
  const compact = $derived($activeView === 'table');
  const link = $derived($gameState.link);
  const linkText = $derived(
    { offline: 'no server (fixture)', connecting: 'connecting…', open: '', closed: 'reconnecting…' }[
      link
    ],
  );
</script>

<section
  id="clock"
  class:compact
  data-status={v.status}
  aria-label="Clock"
  title={clockSummary(v)}
>
  <b class="time">{v.time}</b>
  <span class="rate" data-testid="clock-rate">{v.rate}</span>
  <span class="status" data-testid="clock-status">
    <span aria-hidden="true"
      >{#if v.status === 'paused'}⏸{:else if v.status === 'stopped'}⏹{:else if v.status === 'running'}▶{/if}</span
    >
    <span class:sr-only={compact && v.status === 'running'}>{v.label}</span>
  </span>
  {#if v.staffAtWork}
    <span class="staff" data-testid="clock-staff" role="status">Staff at work…</span>
  {/if}
  {#if linkText}<span class="link">{linkText}</span>{/if}
</section>

<style>
  #clock {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 4px;
    background: rgba(42, 33, 24, 0.88);
    color: #efe6c8;
    font-size: 13px;
  }
  #clock.compact {
    gap: 6px;
    padding: 4px 8px;
    font-size: 12px;
  }
  .time {
    font-variant-numeric: tabular-nums;
  }
  .rate {
    opacity: 0.8;
  }
  #clock[data-status='paused'] .status,
  #clock[data-status='stopped'] .status {
    background: #c9a95c;
    color: #2a2118;
    border-radius: 3px;
    padding: 0 5px;
    font-weight: bold;
  }
  .staff {
    font-style: italic;
    color: #ffd76a;
  }
  .link {
    opacity: 0.7;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
