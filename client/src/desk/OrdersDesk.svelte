<script lang="ts">
  import { gameState, orderDraft, orderSender } from './store.js';
  import {
    COURIERS,
    arrowMarks,
    annexLine,
    estimateRideMs,
    formatEstimate,
    withAnnex,
    emptyDraft,
    type Courier,
    type OrderDraft,
  } from './orders.js';
  import { buildOrderText } from '../hud/hud.js';
  import { gameNowMs } from '../net/state.js';

  const view = $derived($gameState.view);
  const units = $derived(view?.ownUnits ?? []);
  const addressee = $derived(units.find((u) => u.id === $orderDraft.to));
  const arrows = $derived(arrowMarks($gameState.marks));
  const over = $derived($gameState.gameOver !== undefined);
  /** Word from the staff about orders it could not carry out, such as a clarification or a refusal. */
  const notices = $derived($gameState.notices.slice(-3));

  /** The staff estimate for each courier to the chosen addressee, or undefined when it cannot be made. */
  function estimateFor(c: Courier): number | undefined {
    if (!addressee || !view?.hq) return undefined;
    return estimateRideMs(view.hq, addressee.position, c);
  }

  let error = $state('');
  let stamping = $state(false);
  let stampTimer: ReturnType<typeof setTimeout> | undefined;

  function patch(p: Partial<OrderDraft>): void {
    orderDraft.update((d) => ({ ...d, ...p }));
  }
  function toggleArrow(id: string, on: boolean): void {
    orderDraft.update((d) => ({
      ...d,
      annex: on ? [...new Set([...d.annex, id])] : d.annex.filter((x) => x !== id),
    }));
  }

  function sign(): void {
    const d = $orderDraft;
    error = '';
    if (over) return;
    if (!addressee) {
      error = 'Address the order to one of your commanders.';
      return;
    }
    if (d.text.trim() === '') {
      error = 'Write the order first.';
      return;
    }
    const sender = $orderSender;
    if (!sender) {
      error = 'Not connected to a game (open with ?new=1 or ?game=…).';
      return;
    }
    // Annex arrows made since the draft was saved may be gone; only the ones still on the table go.
    const chosen = d.annex.filter((id) => arrows.some((a) => a.id === id));
    const text = withAnnex(buildOrderText(view, addressee.id, d.text.trim()), $gameState.marks, chosen);
    const eta = estimateFor(d.courier);
    const sentAt = $gameState.clock ? gameNowMs($gameState.clock, Date.now()) : (view?.atGame ?? 0);
    const err = sender.send({
      text,
      toName: addressee.name,
      courier: d.courier,
      eta: eta === undefined ? undefined : sentAt + eta,
    });
    if (err) {
      error = err;
      return;
    }
    stamping = true;
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => (stamping = false), 1400);
    orderDraft.set({ ...emptyDraft(), courier: d.courier });
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sign();
  }
</script>

<div class="form" class:stamping>
  <h2>Orders</h2>
  <div class="field">
    <label for="order-to">To</label>
    <select
      id="order-to"
      value={$orderDraft.to}
      onchange={(e) => patch({ to: e.currentTarget.value })}
      disabled={over}
    >
      <option value="">(choose a commander)</option>
      {#each units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
    </select>
  </div>

  <div class="field">
    <label for="order-text">Order</label>
    <textarea
      id="order-text"
      rows="5"
      maxlength="2000"
      placeholder="Write the order…"
      value={$orderDraft.text}
      oninput={(e) => patch({ text: e.currentTarget.value })}
      onkeydown={onKey}
      disabled={over}
    ></textarea>
  </div>

  <fieldset class="annex">
    <legend>Marked-map annex</legend>
    {#if arrows.length === 0}
      <p class="hint">Draw arrows on the map table to attach them to the order.</p>
    {:else}
      {#each arrows as a (a.id)}
        <label class="check">
          <input
            type="checkbox"
            checked={$orderDraft.annex.includes(a.id)}
            onchange={(e) => toggleArrow(a.id, e.currentTarget.checked)}
            disabled={over}
          />
          {annexLine(a)}
        </label>
      {/each}
    {/if}
  </fieldset>

  <fieldset class="couriers">
    <legend>Courier</legend>
    {#each Object.entries(COURIERS) as [id, c] (id)}
      {@const est = estimateFor(id as Courier)}
      <label class="courier">
        <input
          type="radio"
          name="courier"
          value={id}
          checked={$orderDraft.courier === id}
          onchange={() => patch({ courier: id as Courier })}
          disabled={over}
        />
        <span>
          <b>{c.label}</b>
          <span class="est">{est === undefined ? 'no estimate yet' : formatEstimate(est)}</span>
          <small>{c.blurb}</small>
        </span>
      </label>
    {/each}
    <p class="hint">
      The staff reckon the ride on the straight line; a road shortens it and rough ground lengthens it.
    </p>
  </fieldset>

  <div class="sign">
    <span class="signature" aria-hidden="true">{stamping ? 'Signed, the Commander' : ''}</span>
    <button type="button" id="order-sign" onclick={sign} disabled={over}>Sign and send</button>
  </div>
  <div class="err" role="alert">{error}</div>
  {#if notices.length > 0}
    <ul class="notices">
      {#each notices as n, i (i)}<li>{n.message}</li>{/each}
    </ul>
  {/if}

  {#if stamping}<div class="stamp" aria-hidden="true">SENT</div>{/if}
  <div class="sr" aria-live="polite">{stamping ? 'Order signed and sent.' : ''}</div>
</div>

<style>
  .form {
    position: relative;
  }
  .field {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin-bottom: 8px;
  }
  .field label {
    width: 3.5em;
    padding-top: 4px;
    font-variant: small-caps;
  }
  select,
  textarea {
    flex: 1;
    font: inherit;
    background: #fbf7e8;
    border: 1px solid #8a7a5c;
    padding: 4px 6px;
    box-sizing: border-box;
  }
  textarea {
    resize: vertical;
    min-height: 6em;
  }
  fieldset {
    border: 1px solid #b9a97f;
    margin: 0 0 8px;
    padding: 6px 10px;
  }
  legend {
    font-variant: small-caps;
    padding: 0 4px;
  }
  .check,
  .courier {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 4px 0;
  }
  .courier span {
    display: flex;
    flex-direction: column;
  }
  .est {
    font-style: italic;
  }
  small,
  .hint {
    font-size: 12px;
    opacity: 0.8;
    margin: 2px 0;
  }
  .sign {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 2.4em;
  }
  .signature {
    font-family: 'Brush Script MT', cursive;
    font-size: 22px;
    border-bottom: 1px solid #5a4a36;
    flex: 1;
    min-height: 1.4em;
    animation: write 700ms steps(20, end);
    overflow: hidden;
    white-space: nowrap;
  }
  button {
    background: #efe6c8;
    color: #2a2118;
    border: 1px solid #5a4a36;
    border-radius: 3px;
    padding: 6px 12px;
    font: inherit;
    cursor: pointer;
  }
  button:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  input:focus-visible {
    outline: 3px solid #ffd76a;
    outline-offset: 2px;
  }
  .err {
    color: #a83232;
    min-height: 1.2em;
    margin-top: 4px;
  }
  .notices {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    font-size: 13px;
  }
  .stamp {
    position: absolute;
    right: 8%;
    bottom: 18%;
    border: 4px solid #a83232;
    color: #a83232;
    padding: 2px 14px;
    font: bold 36px/1.2 'Courier New', monospace;
    letter-spacing: 4px;
    border-radius: 4px;
    transform: rotate(-12deg);
    opacity: 0.85;
    pointer-events: none;
    animation: stamp 1400ms ease-out forwards;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @keyframes stamp {
    0% {
      transform: rotate(-12deg) scale(2.6);
      opacity: 0;
    }
    25% {
      transform: rotate(-12deg) scale(1);
      opacity: 0.9;
    }
    32% {
      transform: rotate(-12deg) scale(1.06);
    }
    40%,
    80% {
      transform: rotate(-12deg) scale(1);
      opacity: 0.85;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes write {
    from {
      width: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stamp,
    .signature {
      animation: none;
    }
    .stamp {
      opacity: 0.85;
    }
  }
</style>
