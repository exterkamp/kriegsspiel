<script lang="ts">
  import { conferenceClient, conferenceLog, conferenceSender, gameState } from './store.js';
  import {
    CONFERENCE_ROLES,
    MAX_QUESTION_LENGTH,
    busy,
    formatCost,
    isPending,
    newExchange,
    questionProblem,
    staffFor,
    type ConferenceRole,
  } from './conference.js';
  import { formatGameTime, gameNowMs } from '../net/state.js';

  let role = $state<ConferenceRole>('chiefOfStaff');
  let question = $state('');
  let error = $state<string | undefined>(undefined);
  let nextId = 1;

  // Answers arrive in game time, so the log re-reads the clock now and then.
  const opened = Date.now();
  let wall = $state(opened);
  $effect(() => {
    const t = setInterval(() => (wall = Date.now()), 1000);
    return () => clearInterval(t);
  });
  // With no server clock (the offline fixture) game time runs 1:1 from the view's time.
  const nowGame = $derived(
    $gameState.clock
      ? gameNowMs($gameState.clock, wall)
      : ($gameState.view?.atGame ?? 0) + (wall - opened),
  );
  const officer = $derived(staffFor(role));
  const log = $derived($conferenceLog.filter((e) => e.role === role));

  // Take the cost from the server's reply: it decides when the officer answers, not this page.
  $effect(() => {
    const charges = $gameState.staffCharges;
    const waiting = $conferenceLog.filter((e) => e.answerAtGame === Infinity && !e.failed);
    if (waiting.length === 0) return;
    conferenceLog.update((l) =>
      l.map((e) => {
        if (e.answerAtGame !== Infinity || e.failed) return e;
        const c = charges[`q-${opened}-${e.id}`];
        if (c === undefined) return e;
        return c === 'refused'
          ? { ...e, failed: true }
          : { ...e, askedAtGame: c.askedAtGame, answerAtGame: c.answerAtGame };
      }),
    );
  });

  function ask(e: SubmitEvent): void {
    e.preventDefault();
    error = questionProblem(question, role, $conferenceLog, nowGame);
    if (error) return;
    const req = { role, question: question.trim(), askedAtGame: nowGame };
    const sender = $conferenceSender;
    const ex = newExchange(nextId++, req);
    if (sender) {
      // The server charges the cost; the exchange waits for its reply (see the reconcile effect).
      if (!sender(`q-${opened}-${ex.id}`, role, req.question)) {
        error = 'Not connected. Try again when the link is back.';
        return;
      }
      ex.answerAtGame = Infinity;
    }
    conferenceLog.update((l) => [...l, ex]);
    question = '';
    $conferenceClient.ask(req, $gameState.view).then(
      (answer) =>
        conferenceLog.update((l) => l.map((x) => (x.id === ex.id ? { ...x, answer } : x))),
      () =>
        conferenceLog.update((l) => l.map((x) => (x.id === ex.id ? { ...x, failed: true } : x))),
    );
  }
</script>

<h2>Staff conference</h2>
<div class="tabs" role="group" aria-label="Staff officer">
  {#each CONFERENCE_ROLES as r (r)}
    <button
      type="button"
      aria-pressed={role === r}
      onclick={() => ((role = r), (error = undefined))}
    >
      {staffFor(r).title}
      {#if busy($conferenceLog, r, nowGame)}<span class="busy" aria-label="busy">…</span>{/if}
    </button>
  {/each}
</div>

<p class="who">
  <strong>{officer.name}</strong>, {officer.title.toLowerCase()}.
  <span class="traits">Traits: {officer.traits.join(', ')}.</span>
  <small>Each question takes about {formatCost(officer.costMs)} of game time to answer.</small>
</p>

{#if log.length === 0}
  <p><em>No questions yet.</em></p>
{:else}
  <ul class="log">
    {#each log as e (e.id)}
      <li>
        <small>{formatGameTime(e.askedAtGame)}</small>
        <p class="q">You: {e.question}</p>
        {#if e.failed}
          <p class="a failed">{officer.name} could not be reached. Ask again.</p>
        {:else if isPending(e, nowGame)}
          <p class="a pending">
            {officer.name} is consulting the papers… answer due {formatGameTime(e.answerAtGame)}.
          </p>
        {:else if e.answer}
          <p class="a">{e.answer.text}</p>
          <small>Based on reports as of {formatGameTime(e.answer.basedOnGame)}.</small>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<form onsubmit={ask}>
  <label for="conference-question">Ask {officer.name}</label>
  <textarea id="conference-question" rows="2" maxlength={MAX_QUESTION_LENGTH} bind:value={question}
  ></textarea>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button type="submit">Ask (costs {formatCost(officer.costMs)})</button>
</form>

<style>
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 4px 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: #c9a95c;
    font-weight: bold;
  }
  button:focus-visible,
  textarea:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .who {
    margin: 4px 0 8px;
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
  }
  .log li {
    border-bottom: 1px solid #c9bb94;
    padding: 4px 0;
  }
  .q {
    margin: 2px 0;
    font-style: italic;
  }
  .a {
    margin: 2px 0;
  }
  .pending {
    opacity: 0.7;
  }
  .error {
    color: #a83232;
    margin: 4px 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  textarea {
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  form button {
    align-self: flex-start;
  }
</style>
