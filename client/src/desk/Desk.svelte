<script lang="ts">
  import { activeView, gameId, gameState, trayMarks, windowOpen } from './store.js';
  import UmpireWindow from './UmpireWindow.svelte';
  import { unreadCount } from './tray.js';
  import InTray from './InTray.svelte';
  import OrdersDesk from './OrdersDesk.svelte';
  import Roster from './Roster.svelte';
  import { deliveryStatus } from './orders.js';
  import DeskClock from './DeskClock.svelte';
  import PausePanel from './PausePanel.svelte';
  import { VIEWS, isDeskView, isTypingTarget, viewForKey, type ViewId } from './views.js';
  import { formatGameTime, gameNowMs } from '../net/state.js';

  /** What to focus when a view opens, so keyboard users land inside it. */
  const FOCUS: Record<string, string> = {
    inTray: '#tray',
    orders: '#desk-order-text',
    roster: '#view-roster',
    journal: '#view-journal',
    conference: '#view-conference',
  };

  function go(v: ViewId): void {
    activeView.set(v);
  }

  function onKey(e: KeyboardEvent): void {
    if (isTypingTarget(e.target) && e.key !== 'Escape') return;
    const v = viewForKey(e);
    if (v === undefined) return;
    e.preventDefault();
    go(v);
    const sel = FOCUS[v];
    if (sel) queueMicrotask(() => document.querySelector<HTMLElement>(sel)?.focus());
  }

  // Delivery status is read against game time, so the journal re-reads it now and then.
  let wall = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (wall = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const nowGame = $derived($gameState.clock ? gameNowMs($gameState.clock, wall) : 0);
  const journal = $derived(
    [
      ...$gameState.pending.map((p) => {
        const to = p.toName ? ` to ${p.toName}` : '';
        const how = p.courier
          ? ` by ${p.courier === 'fast' ? 'fast rider' : 'steady courier'}`
          : '';
        const status = deliveryStatus(p, nowGame);
        return {
          at: p.sentAtGame,
          text: `Order sent${to}${how}: ${p.text}`,
          progress: p.etaGame === undefined ? undefined : status.fraction,
          status: status.label,
        };
      }),
      ...$gameState.dispatches.map((d) => ({
        at: d.receivedAtGame,
        text: `${d.from}: ${d.text}`,
        progress: undefined as number | undefined,
        status: '',
      })),
    ].sort((a, b) => b.at - a.at),
  );
  const unread = $derived(unreadCount($gameState.dispatches, $trayMarks));
</script>

<svelte:window onkeydown={onKey} />

<div class="dock">
  <PausePanel />
  <DeskClock />
  <nav class="desk-bar" aria-label="Desk">
    {#each VIEWS as v (v.id)}
      <button
        type="button"
        aria-pressed={$activeView === v.id}
        aria-keyshortcuts={v.key.toUpperCase()}
        onclick={() => go(v.id)}
      >
        {v.label}
        <kbd>{v.key.toUpperCase()}</kbd>
        {#if v.id === 'inTray' && unread > 0}<span class="badge" aria-label="{unread} unread"
            >{unread}</span
          >{/if}
      </button>
    {/each}
    {#if $gameState.gameOver && $gameId}
      <button type="button" aria-pressed={$windowOpen} onclick={() => windowOpen.update((o) => !o)}>
        Umpire's window
      </button>
    {/if}
  </nav>
</div>

{#if $windowOpen && $gameState.gameOver}
  <UmpireWindow />
{/if}

<div class="fade" class:on={isDeskView($activeView)} aria-hidden="true"></div>

{#if $activeView === 'inTray'}
  <section id="tray" class="paper wide" tabindex="-1" aria-label="In-tray">
    <InTray />
  </section>
{:else if $activeView === 'orders'}
  <section id="view-orders" class="paper" tabindex="-1" aria-label="Orders desk">
    <OrdersDesk />
  </section>
{:else if $activeView === 'roster'}
  <section id="view-roster" class="paper" tabindex="-1" aria-label="Order of battle">
    <Roster />
  </section>
{:else if $activeView === 'journal'}
  <section id="view-journal" class="paper" tabindex="-1" aria-label="Journal">
    <h2>Journal</h2>
    {#if journal.length === 0}
      <p>Nothing recorded yet.</p>
    {:else}
      <ul>
        {#each journal as j, i (i)}
          <li>
            <small>{formatGameTime(j.at)}</small>
            {j.text}
            {#if j.status}
              <div class="delivery">
                {#if j.progress !== undefined}<progress
                    max="1"
                    value={j.progress}
                    aria-label="Delivery progress"
                  ></progress>{/if}
                <small>{j.status}</small>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if $activeView === 'conference'}
  <section id="view-conference" class="paper" tabindex="-1" aria-label="Staff conference">
    <h2>Staff conference</h2>
    <p>The staff are not yet assembled.</p>
  </section>
{/if}

<style>
  .dock {
    position: fixed;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: max-content;
    max-width: calc(100% - 16px);
    z-index: 5;
  }
  .desk-bar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #c9a95c;
    font-weight: bold;
  }
  button:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  kbd {
    font-size: 10px;
    opacity: 0.65;
    margin-left: 4px;
  }
  .badge {
    background: #a83232;
    color: #fff;
    border-radius: 8px;
    padding: 0 5px;
    margin-left: 4px;
    font-size: 11px;
  }
  .fade {
    position: fixed;
    inset: 0;
    background: #2a2118;
    opacity: 0;
    pointer-events: none;
    transition: opacity 600ms ease-in-out;
  }
  .fade.on {
    opacity: 0.72;
  }
  .paper {
    position: fixed;
    left: 50%;
    top: 8%;
    transform: translateX(-50%);
    width: min(560px, calc(100% - 16px));
    max-height: 70%;
    overflow: auto;
    box-sizing: border-box;
    padding: 16px 20px;
    background: #f4eedb;
    color: #2a2014;
    border-radius: 2px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    z-index: 3;
    animation: slide-in 450ms ease-out;
  }
  .paper.wide {
    width: min(760px, calc(100% - 16px));
  }
  .paper:focus-visible {
    outline: 3px solid #ffd76a;
  }
  .paper h2 {
    margin: 0 0 8px;
  }
  .delivery {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 2px 0 6px;
  }
  .delivery progress {
    width: 8em;
  }
  .paper ul {
    margin: 0;
    padding-left: 18px;
  }
  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translate(-50%, 24px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fade {
      transition: none;
    }
    .paper {
      animation: none;
    }
  }
</style>
