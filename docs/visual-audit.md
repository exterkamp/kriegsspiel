# Visual consistency audit (#327)

Taken before the design system, at 1280x800 and 390x844, with `devrun` and headless Chromium. The screenshots are on the `pr-screenshots` branch (commit `80bf138406a3c9c438cfb9f19a120d7bf60b2461`) under `327/before-*-d.png` and `-m.png` (desktop, mobile); the same pages after the change are `327/after-*`. The `06-styleguide` before shot is the menu, since the route did not exist. Pages: sign-in, main menu (with Developer tools), New game, Your games, game table, in-tray, orders desk, order of battle, journal, staff conference, admin. The map tools (#308) are excluded.

## Findings

1. **Tokens.** `client/src/styles.css` only set the page background. Every component repeated its own hex values: about 60 distinct colours across 57 files. The same ink was written `#2a2118`, `#2a2014`, `#302e26`; the same paper `#f6edd0`, `#f4eedb`, `#f4eedf`, `#efe9d9`, `#fffaf0`, `#fffdf7`; the same wax red `#8a1c10`, `#842219`, `#9b302a`, `#a83232`, `#6b1d12`.
2. **Fonts.** Five font stacks: `Georgia, serif`, `Georgia, 'Times New Roman', serif`, bare `serif`, `system-ui, sans-serif` (the HUD and clock) and `'Brush Script MT', cursive`. Many controls use `font: inherit`, so they follow whichever parent they sit in. The admin view is monospace on a GitHub-dark palette and looks like another app.
3. **Buttons.** Shell pages use a 3px-radius cream button with a dark primary; the desk bar uses brass pills; the table HUD uses white-on-dark small buttons; the pause panel, game over and journal each define their own. There is no danger or quiet variant, so "sign out" and "back" look like the main action.
4. **Form fields.** Inputs in sign-in, New game, the orders desk and the HUD note field differ in border colour, radius, padding and label style (fieldset legends in New game, small caps in orders, bare labels in sign-in). Only the shell pages set a focus ring (`#1f5fbf`); desk and HUD controls fall back to the browser default or show none.
5. **Panels.** The in-tray, orders, roster, journal and conference papers share a look but copy it; the game over modal, pause panel and New game boxes use a different border, shadow and radius (2, 3, 4, 8px). Radii in use: 0, 2, 3, 4, 0.2rem, 8px.
6. **Tabs.** The in-tray filter tabs, the desk bar and the staff conference tabs are three separate implementations with different active colours (`#ffd76a`, `#c9a95c`, `#2a2118`).
7. **Status messages.** Errors are `#8a1c10`, `#a83232` or `#f85149` depending on the page; "Opening the game…" and "Loading…" are plain light text on the dark body. Success and warning colours (`#3fb950`, `#d29922`) appear only in the admin view and the pause panel.
8. **Page frame.** Sign-in, menu and New game each carry their own `main` and `h1`; the way back to the main menu is a "Back" button on New game, "Main menu" floating over the game, and nothing on the admin view or Developer tools pages.
9. **Narrow width.** The desk papers and the orders form fit at 390px, but the HUD and marks toolbar overlap the table top-left, and the desk bar wraps. Tap targets in the HUD are under 32px.
10. **Contrast and high contrast.** There is no high-contrast mode. Muted text (`#767466`, `#8a7a52` on paper) is below 4.5:1 in places.
11. **Style guide.** None.

## Plan

Tokens in `client/src/styles/tokens.css` (light/aged paper, plus a high-contrast variant on `[data-contrast="high"]` and `prefers-contrast: more`), shared classes and small standalone components in `client/src/app/ui`, every in-scope component switched to them, a guard test that greps component styles for hex colours and `font-family`, and a style guide at `/style-guide`.
