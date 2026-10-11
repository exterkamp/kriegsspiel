<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { activeView } from '../desk/store.js';
  import { isTypingTarget } from '../desk/views.js';

  interface Props {
    onLeave: () => void;
    onSignOut: () => void;
  }
  let { onLeave, onSignOut }: Props = $props();
  let open = $state(false);
  let resume: HTMLButtonElement | undefined = $state();
  let opener: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  async function setOpen(v: boolean): Promise<void> {
    open = v;
    await tick();
    if (v) resume?.focus();
    else opener?.focus();
  }

  /** Keeps Tab inside the open panel, since the page behind it is not usable while it is up. */
  function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !panel) return;
    const items = [...panel.querySelectorAll<HTMLButtonElement>('button')];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !panel.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !panel.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * Esc closes the menu if it is open. Otherwise it opens it, but only from the table: in a desk view Esc
   * belongs to the desk (back to the table), and in a text field to the field. Runs in the capture phase so
   * it sees the view as it was before the desk handles the same key.
   */
  function onKey(e: KeyboardEvent): void {
    if (open) trapTab(e);
    if (e.key !== 'Escape') return;
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      void setOpen(false);
    } else if (get(activeView) === 'table' && !isTypingTarget(e.target)) {
      void setOpen(true);
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<button
  type="button"
  class="open"
  bind:this={opener}
  aria-haspopup="dialog"
  onclick={() => setOpen(true)}>Menu (Esc)</button
>

{#if open}
  <div class="scrim">
    <div class="panel" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="gm-h">
      <h2 id="gm-h">Menu</h2>
      <button type="button" bind:this={resume} onclick={() => setOpen(false)}>Resume</button>
      <button type="button" onclick={onLeave}>Leave to main menu</button>
      <button type="button" onclick={onSignOut}>Sign out</button>
      <p class="note">Leaving does not end the game. It keeps running on the server.</p>
    </div>
  </div>
{/if}

<style>
  .open {
    position: fixed;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
  }
  button {
    font:
      13px/1.2 Georgia,
      serif;
    padding: 6px 12px;
    background: #2a2118;
    color: #efe6c8;
    border: 1px solid #8a7a52;
    border-radius: 3px;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 3px solid #f2c94c;
    outline-offset: 2px;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
  }
  .panel {
    display: grid;
    gap: 8px;
    width: min(320px, calc(100% - 32px));
    padding: 16px;
    background: #f3e9c9;
    color: #2a2118;
    border: 1px solid #5a4c33;
    font-family: Georgia, serif;
  }
  .panel button {
    font-size: 15px;
  }
  h2 {
    margin: 0;
  }
  .note {
    margin: 0;
    font-size: 13px;
    color: #5a4c33;
  }
</style>
