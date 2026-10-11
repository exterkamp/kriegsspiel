/** The paper look shared by the shell's full-page screens (sign-in, menu, new game, lobby). */
export const PAGE_CSS = `
  :host { display: block; height: 100%; }
  .page {
    min-height: 100%;
    overflow: auto;
    background: #e9dcb8 radial-gradient(circle at 30% 20%, #f3e9c9, #d9c795);
  }
  main {
    box-sizing: border-box;
    min-height: 100%;
    padding: 32px 16px;
    max-width: 560px;
    margin: 0 auto;
    color: #2a2118;
    font-family: Georgia, 'Times New Roman', serif;
  }
  h1 { font-size: 2.4rem; margin: 0 0 16px; letter-spacing: 0.04em; }
  h2 { font-size: 1.1rem; margin: 24px 0 8px; border-bottom: 1px solid #8a7a52; }
  .muted { color: #5a4c33; }
  .err { color: #8a1c10; }
  button {
    font: inherit;
    cursor: pointer;
    padding: 8px 14px;
    border: 1px solid #5a4c33;
    border-radius: 3px;
    background: #f6edd0;
    color: #2a2118;
  }
  .primary { background: #2a2118; color: #efe6c8; font-size: 1.15rem; padding: 10px 24px; }
  button:focus-visible, input:focus-visible, a:focus-visible, select:focus-visible {
    outline: 3px solid #1f5fbf;
    outline-offset: 2px;
  }
  a { color: #6b1d12; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
`;
