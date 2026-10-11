<script lang="ts">
  import { onMount } from 'svelte';
  import { gameState, pauseActions } from './store.js';
  import { pageTitle, pausePanel } from './pause.js';

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  const view = $derived(pausePanel($gameState, now));
  let asking = $state(false);
  let reason = $state('');
  let problem = $state('');

  const baseTitle = typeof document === 'undefined' ? '' : document.title.replace(/^\(vote\) /, '');
  $effect(() => {
    document.title = pageTitle(baseTitle, $gameState);
  });

  function send(ok: boolean | undefined): boolean {
    problem = ok ? '' : 'Not connected. Try again when the link is back.';
    return !!ok;
  }

  function propose(): void {
    if (view.kind !== 'idle') return;
    const a = $pauseActions;
    const ok =
      view.action === 'pause' ? a?.proposePause(reason.trim() || undefined) : a?.proposeResume();
    if (send(ok)) {
      asking = false;
      reason = '';
    }
  }

  function cast(id: string, yes: boolean): void {
    send($pauseActions?.vote(id, yes));
  }
</script>

{#if view.kind === 'idle'}
  <section class="pause idle" aria-label="Pause">
    {#if view.action === 'resume'}
      <button type="button" data-testid="propose-resume" onclick={propose}>Ask to resume</button>
    {:else if asking}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          propose();
        }}
      >
        <label>
          Reason (optional)
          <input
            data-testid="pause-reason"
            bind:value={reason}
            maxlength="200"
            placeholder="someone at the door"
          />
        </label>
        <button type="submit" data-testid="propose-pause">Ask to pause</button>
        <button type="button" onclick={() => (asking = false)}>Cancel</button>
      </form>
    {:else}
      <button type="button" data-testid="open-pause" onclick={() => (asking = true)}
        >Pause…</button
      >
    {/if}
    {#if problem}<span class="problem" role="alert">{problem}</span>{/if}
  </section>
{:else if view.kind === 'vote'}
  <section class="pause vote" aria-label="Pause vote" data-testid="pause-vote">
    <p class="headline" role="status">
      <b>{view.headline}</b>
      {#if view.reason}<span class="reason">“{view.reason}”</span>{/if}
    </p>
    <p class="meta">
      <span data-testid="pause-tally">{view.tally}</span>
      · <span data-testid="pause-countdown">{view.secondsLeft}s left</span>
    </p>
    {#if view.needsVote}
      <div class="buttons">
        <button type="button" data-testid="vote-yes" onclick={() => cast(view.id, true)}
          >Yes, {view.action}</button
        >
        <button type="button" data-testid="vote-no" onclick={() => cast(view.id, false)}
          >No</button
        >
      </div>
    {:else}
      <p class="meta" data-testid="pause-voted">
        You voted {view.myVote ? 'yes' : 'no'}.
        {#if view.waitingOn > 0}Waiting on {view.waitingOn} more.{/if}
      </p>
    {/if}
    {#if problem}<span class="problem" role="alert">{problem}</span>{/if}
  </section>
{/if}

<style>
  .pause {
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 4px;
    background: rgba(42, 33, 24, 0.92);
    color: #efe6c8;
    font-size: 13px;
    max-width: 100%;
  }
  .vote {
    border: 2px solid #ffd76a;
  }
  p {
    margin: 0 0 4px;
  }
  .reason {
    font-style: italic;
  }
  .meta {
    opacity: 0.85;
  }
  .buttons,
  form {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: end;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  input {
    font: inherit;
    padding: 4px;
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
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .problem {
    color: #ff9a8a;
    margin-left: 6px;
  }
</style>
