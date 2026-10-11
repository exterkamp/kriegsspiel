# Mock umpire fixtures

`MockUmpireClient` (`server/src/umpire/mockUmpireClient.ts`) is the `UmpireClient` for every test that is not about the LLM itself. It has no transport, so the suite runs with no network access and no API key. It is for hand-written canned answers; `PlaybackUmpireClient` is for replaying recorded games.

## Using it

```ts
import { MockUmpireClient, loadFixtures } from '../umpire/index.js';

const umpire = new MockUmpireClient(loadFixtures('server/src/umpire/fixtures'), {
  recorder, // optional CallRecorder
  sleep, // optional; inject to control latency in tests
});
```

Fixtures can also be passed inline as objects. `umpire.calls` lists every request received.

## Adding a fixture

Add a `*.json` file to `server/src/umpire/fixtures/` (or append to one). Each file is `{"fixtures": [...]}`. A fixture has:

| Field           | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `stage`         | Required: `parse`, `judge`, `narrate` or `staff`.                                                  |
| `promptVersion` | Optional. Match only this prompt version.                                                    |
| `input`         | Optional. Match only this exact input (object key order ignored). Omit to match any input.   |
| `output`        | The structured output to return. It is validated against the request's schema.               |
| `latencyMs`     | Optional. Delay before answering, for LLM-barrier tests.                                     |
| `failure`       | Optional `{kind, message?, times?}`. Throws `UmpireError` of `kind` for the first `times` matching calls (every call if `times` is omitted), then returns `output`. |
| `name`          | Optional label used in error messages.                                                       |

The first fixture that matches a call wins, so put specific fixtures (with `input`) before general ones. This also holds across the files of a fixtures directory, which load in file-name order: a catch-all (no `promptVersion` or `input`) in an earlier file shadows later, more specific ones, so pin shared fixtures to a `promptVersion`. Fixtures are checked when the client is built, whether they come from a file or are passed inline. Fixtures are reusable. A call that matches nothing throws `UmpireError` with kind `missing-recording`.

## Judge placement fixtures

`fixtures/judge-placement.json` answers the `judge` placement task (prompt `judge-placement-v1`, see `server/src/umpire/judgePlacement.ts`) for the `hold-the-bridge` scenario. Its output lists `placements` with metres for `x`, `y` and `shape`, and degrees for `facingDeg`. Pin new placement fixtures to the prompt version so they do not shadow other judge fixtures.
