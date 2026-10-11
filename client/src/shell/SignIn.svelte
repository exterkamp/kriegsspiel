<script lang="ts">
  interface Props {
    /** Asks for a login link; resolves to an error message, or undefined once it was sent. */
    onRequest: (email: string) => Promise<string | undefined>;
  }
  let { onRequest }: Props = $props();
  let email = $state('');
  let message = $state('');
  let failed = $state(false);
  let busy = $state(false);

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    const err = await onRequest(email.trim());
    busy = false;
    failed = err !== undefined;
    message = err ?? `Check ${email.trim()} for your login link, then open it in this browser.`;
  }
</script>

<main class="signin">
  <h1>Kriegsspiel</h1>
  <form onsubmit={submit} aria-labelledby="signin-h">
    <h2 id="signin-h">Sign in</h2>
    <label>Email <input type="email" required autocomplete="email" bind:value={email} /></label>
    <button type="submit" disabled={busy}>Send me a login link</button>
    <p role="status" class:err={failed}>{message}</p>
  </form>
</main>

<style>
  .signin {
    box-sizing: border-box;
    padding: 32px 16px;
    max-width: 420px;
    margin: 0 auto;
    color: #2a2118;
    font-family: Georgia, 'Times New Roman', serif;
  }
  :global(body:has(.signin)) {
    background: #e9dcb8 radial-gradient(circle at 30% 20%, #f3e9c9, #d9c795);
  }
  h1 {
    font-size: 2.4rem;
    margin: 0 0 16px;
  }
  h2 {
    font-size: 1.1rem;
  }
  label {
    display: block;
    margin-bottom: 12px;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 6px;
    margin-top: 4px;
  }
  button {
    font: inherit;
    padding: 8px 14px;
    border: 1px solid #5a4c33;
    border-radius: 3px;
    background: #f6edd0;
    color: #2a2118;
    cursor: pointer;
  }
  input:focus-visible,
  button:focus-visible {
    outline: 3px solid #1f5fbf;
    outline-offset: 2px;
  }
  .err {
    color: #8a1c10;
  }
</style>
