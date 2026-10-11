<script lang="ts">
  import type { ContinueRow } from './continueList.js';

  interface Props {
    email: string;
    /** Unfinished games to continue; undefined while loading. The section is hidden when empty. */
    games?: ContinueRow[];
    loadError?: string;
    onNewGame: () => void;
    onContinue: (id: string) => void;
    onSignOut: () => void;
  }
  let { email, games, loadError, onNewGame, onContinue, onSignOut }: Props = $props();
</script>

<main class="menu">
  <h1>Kriegsspiel</h1>
  <p class="tag">An umpired war game, played in real time or slower.</p>

  <nav aria-label="Main menu">
    <button type="button" class="primary" onclick={onNewGame}>New game</button>
  </nav>

  {#if games === undefined && !loadError}
    <p role="status" class="muted">Looking for your games…</p>
  {:else if loadError}
    <p role="alert" class="err">{loadError}</p>
  {:else if games && games.length > 0}
    <section aria-labelledby="continue-h">
      <h2 id="continue-h">Continue</h2>
      <ul>
        {#each games as g (g.id)}
          <li>
            <button
              type="button"
              class="game"
              aria-label={`Continue: ${g.label}`}
              onclick={() => onContinue(g.id)}
            >
              <b>{g.scenario}</b>
              <span>{g.side}</span>
              <span>{g.gameTime}</span>
              <span class="muted">played {g.lastPlayed}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="account-h" class="account">
    <h2 id="account-h">Account</h2>
    <p>Signed in as <b>{email}</b></p>
    <button type="button" onclick={onSignOut}>Sign out</button>
  </section>

  <section aria-labelledby="about-h">
    <h2 id="about-h">About</h2>
    <p>
      You command one side of a battle from a desk. Orders are written in plain words and carried by
      couriers, reports arrive late and incomplete, and an umpire rules on what happens. The game
      keeps running on the server while you are away.
      <a href="https://github.com/exterkamp/kriegsspiel/blob/main/docs/gameplay.md"
        >Read how it plays</a
      >.
    </p>
  </section>
</main>

<style>
  .menu {
    box-sizing: border-box;
    min-height: 100%;
    padding: 32px 16px;
    max-width: 560px;
    margin: 0 auto;
    color: #2a2118;
    font-family: Georgia, 'Times New Roman', serif;
  }
  :global(body:has(.menu)) {
    background: #e9dcb8 radial-gradient(circle at 30% 20%, #f3e9c9, #d9c795);
  }
  h1 {
    font-size: 2.4rem;
    margin: 0;
    letter-spacing: 0.04em;
  }
  h2 {
    font-size: 1.1rem;
    margin: 24px 0 8px;
    border-bottom: 1px solid #8a7a52;
  }
  .tag,
  .muted {
    color: #5a4c33;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  button,
  .game {
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
  .game {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    text-align: left;
  }
  button:focus-visible,
  a:focus-visible {
    outline: 3px solid #1f5fbf;
    outline-offset: 2px;
  }
  a {
    color: #6b1d12;
  }
  .err {
    color: #8a1c10;
  }
</style>
