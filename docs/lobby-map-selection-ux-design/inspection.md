# Inspection evidence

13 October 2026. Design-only task. This directory belongs to the lobby-map UX recommendation.

## Browser observation

Opened `http://127.0.0.1:41930/?lobby=1` in a separate task-owned Chrome tab. Read the accessibility tree and visually inspected a screenshot at the existing approximately 1456 × 902 viewport. No fields were changed; no buttons submitted; no games created. Existing user tabs and inputs were not used. The research tab is ephemeral.

Observed: centered paper page, serif New game heading, Scenario fieldset with Hold the Bridge selected, Blue side and computer opponent explanation, Real time selected, 12:1 clock rate, Standard rules, Dry staff officer manner, sticky Start/Back, Your games and No games yet. No map entry point was present. The screenshot was inspected in the tool result; no raw screenshot file was exported. Narrow-screen **current-product** behavior was not exercised; the narrow artifact is a proposed layout, not responsive runtime evidence.

## Source and ownership

- Landing checkout: branch `main`, HEAD/local main/origin main `0405581a8e9e55208ff6401978ff1451f284e934`; clean before task writes.
- #362 merge `adc137b0f914584f329b3103d5cf0eba76b660b1` verified as an ancestor. Relevant shell/lobby/local-board/registry path comparison is unchanged since that merge; server API differs and was inspected at current HEAD.
- Attempted read-only `git ls-remote origin refs/heads/main`: GitHub DNS unavailable. Web commit endpoint fallback also unavailable. No fetch, branch switch or merge performed; latest remote HEAD is unverified.
- Preview HTML matched the observed Angular flow, but exact preview build revision was not established. No preview restart or process changes.
- Protected map-table checkout read-only status retains four modified files and its untracked historical landing plan. No writes there.
- Requested design Markdown did not exist; created without overwriting another owner's document. Existing decision log and guides remain unchanged because this is a recommendation awaiting adoption.

## Artifact validation

`desktop.svg` and `narrow.svg` are generated from the task-owned `render_wireframes.py`; `rsvg-convert` produces their PNG counterparts. All thumbnail geometry is schematic and contains no game/private state. Visual inspection of both rendered PNGs checks text containment, paper/control hierarchy and the three flow states. These images establish reviewable design intent only. No implementation tests were run for this documentation-only task.
