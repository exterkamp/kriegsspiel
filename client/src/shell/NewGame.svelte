<script lang="ts">
  import { onMount } from 'svelte';
  import {
    OPPONENT_LABEL,
    allowedSides,
    chooseScenario,
    initialForm,
    lengthLine,
    rateExplanation,
    rateOf,
    toRequest,
    validate,
    type Form,
    type ScenarioOptions,
  } from './newGame.js';

  interface Props {
    load: () => Promise<ScenarioOptions>;
    /** Makes the game; resolves to its id, or throws an Error whose message is shown. */
    create: (req: ReturnType<typeof toRequest>) => Promise<string>;
    onStarted: (id: string) => void;
    onBack: () => void;
  }
  let { load, create, onStarted, onBack }: Props = $props();

  let options = $state<ScenarioOptions | undefined>();
  let form = $state<Form | undefined>();
  let loadError = $state<string | undefined>();
  let error = $state<string | undefined>();
  let busy = false;
  let starting = $state(false);

  const scenario = $derived(options?.scenarios.find((s) => s.id === form?.scenario));
  const rate = $derived(form ? rateOf(form) : undefined);

  onMount(() => {
    load().then(
      (o) => {
        options = o;
        form = initialForm(o);
        if (!form) loadError = 'This server has no scenarios.';
      },
      (e: unknown) => (loadError = e instanceof Error ? e.message : String(e)),
    );
  });

  async function start(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy || !options || !form) return;
    const problem = validate(form, options);
    if (problem) {
      error = problem;
      return;
    }
    busy = true;
    starting = true;
    error = undefined;
    try {
      onStarted(await create(toRequest(form, options)));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
      starting = false;
    }
  }
</script>

<div class="page">
  <main class="new">
    <h1>New game</h1>
    {#if loadError}
      <p role="alert" class="err">{loadError}</p>
    {:else if !options || !form || !scenario}
      <p role="status" class="muted">Loading scenarios…</p>
    {:else}
      <form onsubmit={start} aria-label="New game">
        <fieldset>
          <legend>Scenario</legend>
          {#each options.scenarios as s (s.id)}
            <label class="choice">
              <input
                type="radio"
                name="scenario"
                value={s.id}
                checked={form.scenario === s.id}
                onchange={() => (form = chooseScenario(options!, s.id) ?? form)}
              />
              <b>{s.name}</b>
            </label>
          {/each}
          <p>{scenario.briefing}</p>
          <p class="muted">
            Sides: {scenario.sides.map((s) => s.name).join(' and ')}.
            {lengthLine(scenario.lengthMinutes, rate)}
          </p>
        </fieldset>

        <fieldset>
          <legend>Your side</legend>
          {#each allowedSides(scenario, options.opponent) as s (s.id)}
            <label class="choice">
              <input type="radio" name="side" value={s.id} bind:group={form.side} />
              {s.name}
            </label>
          {/each}
          {#if options.opponent}
            <p class="muted">{OPPONENT_LABEL[options.opponent]}</p>
          {/if}
        </fieldset>

        <fieldset>
          <legend>Clock rate</legend>
          {#each ['1', '4', '12'] as r (r)}
            <label class="choice">
              <input type="radio" name="rate" value={r} bind:group={form.rate} />
              {r}:1
            </label>
          {/each}
          <label class="choice">
            <input type="radio" name="rate" value="custom" bind:group={form.rate} />
            Custom
          </label>
          {#if form.rate === 'custom'}
            <label>
              Battle hours per real hour
              <input
                type="text"
                inputmode="decimal"
                aria-label="Custom clock rate"
                bind:value={form.customRate}
              />
            </label>
          {/if}
          <p class="muted" role="status">
            {rate !== undefined ? rateExplanation(rate) : 'Enter a ratio such as 6 or 6:1.'}
          </p>
        </fieldset>

        {#if error}<p role="alert" class="err">{error}</p>{/if}
        {#if starting}<p class="muted" role="status">Starting the game…</p>{/if}

        <div class="actions">
          <button type="submit" class="primary" aria-disabled={starting}>
            {starting ? 'Starting…' : 'Start'}
          </button>
          <button type="button" onclick={onBack}>Back</button>
        </div>
      </form>
    {/if}
    {#if loadError}
      <div class="actions"><button type="button" onclick={onBack}>Back</button></div>
    {/if}
  </main>
</div>

<style>
  .new {
    box-sizing: border-box;
    min-height: 100%;
    padding: 32px 16px;
    max-width: 560px;
    margin: 0 auto;
    color: #2a2118;
    font-family: Georgia, 'Times New Roman', serif;
  }
  .page {
    min-height: 100%;
    overflow: auto;
    background: #e9dcb8 radial-gradient(circle at 30% 20%, #f3e9c9, #d9c795);
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 16px;
  }
  fieldset {
    border: 1px solid #8a7a52;
    margin: 0 0 16px;
    padding: 8px 12px 12px;
  }
  legend {
    font-weight: bold;
  }
  .choice {
    display: block;
    padding: 6px 0;
  }
  input[type='text'] {
    display: block;
    font: inherit;
    padding: 6px;
    margin-top: 4px;
    width: 8em;
  }
  .muted {
    color: #5a4c33;
  }
  .err {
    color: #8a1c10;
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  button {
    font: inherit;
    cursor: pointer;
    padding: 8px 14px;
    border: 1px solid #5a4c33;
    border-radius: 3px;
    background: #f6edd0;
    color: #2a2118;
  }
  .primary {
    background: #2a2118;
    color: #efe6c8;
    font-size: 1.15rem;
    padding: 10px 24px;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid #1f5fbf;
    outline-offset: 2px;
  }
</style>
