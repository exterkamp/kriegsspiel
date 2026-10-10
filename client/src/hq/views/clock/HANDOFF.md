# Bounded #56 clock handoff

Only `client/src/hq/views/clock/**` was written. The journal remains unchanged by
this packet. No shared edits, configurations, commits, installs, game commands,
external APIs or development servers. Story #56 remains open: live clock
projection and browser acceptance are pending.

## Entry point and coordinator integration

`index.ts` exports `Clock` from `Clock.svelte` with these props:

```ts
state: SourceState;
kind: 'fixture' | 'live';
gameMs: number | null;
compact?: boolean; // defaults false
```

Coordinator imports it into the Shell header clock snippet, passes the accepted
source state/kind and the same `gameMs` shared with roster, and sets `compact` for
table presentation. The parent owns the monotonic sample, display projection,
ticker and source subscription. This component has no timer, subscription,
wall-clock read, storage or commands. It only responds to props.

## Behavior and limits

- Game time is an elapsed `HH:MM:SS.mmm` value plus exact game milliseconds; hours
  can exceed 24. Absent/invalid time is unavailable, never invented zero. A
  supplied zero is valid.
- The frozen fallback calls the existing
  `projectGameTime(state, kind, clock.receivedMonotonicMs)`. Both the original
  authoritative anchor and result must be nonnegative safe integers. This local
  guard avoids displaying a fractional anchor that the shared helper floors.
- Parent `gameMs` is used only for fixture / ready / fresh / fixture-atomic /
  running / realtime / clear-barrier observations. Projection additionally
  requires matching valid snapshot/clock anchors, finite receipt time, positive
  finite rate, and a valid parent time at least equal to the current anchor.
- Ineligible observations and invalid/absent/old parent time use the frozen
  authoritative fallback. Manual and fast-forward move only with supplied
  snapshots; pause, stopped, unknown mode/barrier, stale, disconnected,
  unverified and live observations never use interpolated parent time.
- Shows supplied rate/status/mode, connection, stale flag and fixture/live label.
  A retained offline observation is labelled as such. “Not marked stale” only
  reports the supplied flag and does not promise server freshness.
- Staff-working and clear/unknown barrier states remain distinct. Working
  barriers show an optional supplied need time; absent, invalid or pre-anchor
  need times are unavailable. No missing need time defaults to zero. Barrier
  language says the **display** is held, without inventing server pause events.
- Compact mode keeps time, rate, status, mode, connection/freshness, barrier and
  projection provenance. Live mode explicitly states projection is unavailable,
  including when passed a fixture-shaped clock.
- Period serif text inherits Shell `--paper`/`--ink`; current-color borders and
  text inherit high contrast. Metadata wraps instead of being clipped. Barrier
  changes use a polite status region; the ticking time is not a live region.

The parent/data source still owns scope, accepted epoch/ordinal ordering and the
association of a projected time with its snapshot. The numeric prop alone cannot
prove that association for every stale parent value. Runtime source validation
remains upstream; this view adds time/projection guards without replacing it.
Actual browser visual, mobile, high-contrast and assistive-technology review is
outstanding. No real server clock or voting/control transport is supplied.

## Exact files

- `Clock.svelte`: view and compact styling.
- `presentation.ts`: projection eligibility, frozen fallback and time formatting.
- `index.ts`: component export.
- `Clock.test.ts`: behavioral DOM coverage.
- `TestHarness.svelte`: test-only reactive packet updates.
- `HANDOFF.md`: this coordinator handoff.

## Verification

50 behavioral DOM cases cover rates 1/4/12/1000, all modes/statuses, barrier
working/clear/unknown with optional/invalid need time, absent snapshots,
connection states and stale snapshots, invalid/absent/old parent times, invalid
authoritative anchors/rates/receipt times, live compact freezing, legitimate zero,
hours/milliseconds, reactive disconnect/barrier/resume/reanchor, manual and
fast-forward received progress, and absence of component timers/automatic advance.

Focused Vitest, directory ESLint/Prettier, client Svelte diagnostics and client
TypeScript checks pass. No full monorepo build or browser checks were run.

Elapsed: approximately four minutes including guidance/contract reads and focused
implementation/verification, measured from the first UTC sample in this packet.
