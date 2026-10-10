# Bounded #55 fixture journal handoff

Only `client/src/hq/views/journal/**` was written. No shared contracts, preferences,
configuration, docs, commits, installs, external APIs or development servers were
changed/used. Story #55 stays open. Root composition and browser visual acceptance
remain coordinator work.

## Entry point

`index.ts` exports `Journal` from `Journal.svelte`. Required props are
`snapshot: HqSnapshot | null` and `scope: Scope`; optional
`storageFactory: () => NotesStorage` lazily defaults to `window.localStorage`.
`NotesStorage` requires synchronous `getItem`/`setItem`. The factory is first
accessed by the mounted view's load effect, never at import time.

The view consumes only supplied snapshot papers with value-equal scope matching.
Exact repeats collapse by stable ID, conflicting IDs are omitted with a visible
warning, and papers sort by received game milliseconds then ID. Written, received
and unavailable observation times remain distinct. Refresh replaces the displayed
papers; it does not accumulate or invent historical events. Upstream fixture
validation and ordering remain the data source's responsibility.

Search covers ID, sender, category, paper prose and personal note prose. Filters
include each supplied paper category, all papers, notes and all entries. The
accessible export is a labelled, read-only, focus-selectable text area containing
the search/filter result when prepared. Full prose is rendered/exported as text;
no HTML execution, clipboard permission or download API is required. Matching
unsaved notes are explicitly labelled. No order or pause events are fabricated;
the view and export state that these histories are unavailable.

## Independent notes schema — coordinator contract review required

This is a proposed narrow local notebook contract, **not** an extension of
`LocalDocument` or `HqRepository` preferences. `notes.ts` exports its strict Zod
schema and inferred `NotesDocument`:

```json
{
  "schemaVersion": 1,
  "scope": { "gameId": "fixture", "sideId": "blue", "playerId": "one" },
  "text": "Personal memorandum"
}
```

- Unknown root/scope properties are rejected. Scope strings are nonempty and at
  most 128 UTF-16 code units; note text is at most 16,384 code units. Raw records
  over 131,072 code units are rejected before parsing.
- Storage key is `JSON.stringify(['kriegsspiel.hq.journal-notes', gameId, sideId,
playerId])`, an encoded collision-resistant tuple. The stable namespace lets
  future-version records be recognized rather than hidden by a versioned key.
- One editable notebook string per game/side/player, with explicit Save. No
  generated game/wall timestamps, note event IDs, sharing or model calls.
- Missing storage starts an empty notebook without writing. Corrupt, oversized,
  mismatched and future-version records remain untouched and block Save.
  No migration or destructive recovery is attempted. Reload is explicit and
  labelled as discarding edits.
- A synchronous successful `setItem` is the persistence commit. Denial, quota
  and other exceptions give safe visible messages, retain unsaved text, and
  never report success. Quota detection uses the exception's name, including
  DOMException objects from a different realm. No silent memory fallback.
- Before saving, raw stored bytes must still equal the bytes observed at load or
  the last successful save. A detected change blocks writes until reload.
  **This check is not atomic across tabs.** One writer per scoped notebook is
  required; races and ABA changes are not solved, and there is no cross-device
  synchronization or browser durability guarantee beyond successful storage.
- Changing scoped props clears search/export and reloads only that notebook;
  equal-valued scopes preserve edits. Replacing the storage factory reloads it.
  Unmount has no pending timers/listeners/async storage work.

Review this independent schema, namespace and single-writer restriction before
coordinator composition. No shared contract file was edited.

## Exact files

- `Journal.svelte`: view, scoped note lifecycle and inherited paper/ink styling.
- `notes.ts`: strict independent notebook schema and bounded synchronous storage.
- `presentation.ts`: stable deduplication, chronological sorting, search and text.
- `index.ts`: component/type exports.
- `Journal.test.ts`: behavioral DOM/storage tests.
- `TestHarness.svelte`: test-only reactive scoped-prop update harness.
- `HANDOFF.md`: this contract-review and verification record.

## Verification and limitations

19 focused Vitest DOM/storage tests pass. They cover identical/conflicting IDs,
full long literal text, chronological timestamps, search/filter/export, missing
and mismatched snapshots, game/side/player isolation, equal scopes, reactive scope
changes, fixture refresh, browser reload persistence, strict malformed/future
records and limits, factory denial/retry, quota/security/generic save errors,
observed external changes and retention of a previously saved record after quota
failure. `svelte-check` reports zero errors/warnings; directory ESLint and Prettier
checks pass. No full monorepo build or browser rendering/performance claim.

Styling inherits Shell's `--paper` and `--ink`, uses current-color borders/focus
outlines and wraps long prose. High contrast is inherited; actual visual/mobile
and assistive-technology review remains outstanding. Notes require explicit Save,
are local browser data, and are not timestamped journal events. This fixture view
cannot meet live order/pause history or server persistence acceptance criteria.

Elapsed implementation and focused verification: approximately five minutes from
first owned-file creation; preparatory reading time was not separately instrumented.
Model/effort selection is controlled by the enclosing coordinator, not this view;
no model configuration was changed and effective runtime selection was not queried.
