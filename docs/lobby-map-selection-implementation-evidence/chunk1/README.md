# Chunk1 native-browser evidence

Source H `7716cc8a60f4603f43708037a8e45a97ebe93b09`, tree `a69d2634313980dc125e56f4278091dfbf1bf836`; parent `6081bb550d444d8d2d0c3439c7b57f7cf471ee72`. Coordinator captured Chrome evidence from the existing isolated snapshot/devrun web41564 and API41590 on 14 October 2026 (15 October UTC). All12 client source SHA-256s matched the frozen external manifest before final report creation. Canonical HEAD/client bytes remain1d6fcb4; no protected process was restarted.

This report is recorded after its source commit exists. The evidence/artifact commit does not change product source. The actual initial bridge terrain is4×3km, with the two woods, road, river and bridge. No generated/canonical geography is substituted.

## Observed behavior

- Desktop1456×902:960px paper dialog with280px/622px list/preview columns; summary directly after Scenario, actual public geometry and token styling. Shift+Tab from initial heading lands on Use map within dialog.
- Choose→Use closes and announces selection, returns exact BUTTON Choose map, and creates no game. Direct Add→Back to maps→Use returns exact BUTTON Add map. The retained4:1 setting remains checked.
- Choose→Add→browser Back returns chooser; Cancel returns Choose map with4:1 retained. Browser Back from chooser closes only the overlay, preserves New game and restores Choose map.
- View→Zoom in shows2×. Escape from SVG fits to1× while keeping dialog open; second Escape closes and restores View map. Keyboard/mouse interactions are actual browser actions; synthetic unresolved-create ordering is covered separately by actual-child Angular tests.
- At390×844: pagewidth390, dialogwidth390, dialogscrollWidth388, footerbottom843. Long chooser internal scroller726px with908px content. Short Add footer stays at bottom.
- At320×720: pagewidth320, dialogwidth320, dialogscrollWidth318, footerbottom719. Long chooser internal scroller602px with906px content. Short Add footer stays at bottom. Use from the direct Add route returns Add map.
- Add states contain truthful capability explanation and Back to maps, with no active Generate/Save/Use promise. Map operations leave Your games at No games yet. Task API structured request log independently contains **zero POST /games requests** through the attempted Start check.

## Boundaries and outstanding check

The final Start game pointer action was blocked by automatic approval review **before execution**, because it treated the original design-only prohibition on creating games as still applicable. The coordinator requested explicit approval for one disposable turn-based game on this isolated server; no indirect/API workaround was attempted. Actual browser create→live is therefore **not established** by this report. Existing exact scenario-only API/request tests, actual-child pending/recovery tests and shell route tests pass, but do not replace that missing browser check.

Desktop/narrow viewport emulation in Chrome does not establish a physical touch-device or software-keyboard test. Native modal/history/focus behavior was exercised; workers used explicitly shimmed native primitives in jsdom. The initial cookie-isolation incident is retained in the execution log: early127.0.0.1 task-guest sign-in may have replaced an existing local sign-in cookie. Subsequent task checks use a unique *.localhost host. Original preview authentication must not be claimed preserved; protected server data/processes remained unchanged. Temporary viewport override was reset to desktop1456×902.

## Checks tied to source

Final child/parent/shell integration:91tests/3files passed. W1 focus suite40 passed; four red regression cases were observed against preceding source before repair, with assertions retained. Final client typecheck and production build passed; child ESLint/Prettier passed. Broader unchanged-source lint/build/typecheck and workspace suites are carried only as recorded in the execution log, including original failures/qualifications. Independent final-review report is separate from coordinator observations.

## Captures

| Artifact | SHA-256 |
| --- | --- |
| [desktop-entry-full.jpg](desktop-entry-full.jpg) | `176eab8fa9c80fcfcb1af182012d582238759ad27e7d0c46bb60602124fe18af` |
| [desktop-chooser.jpg](desktop-chooser.jpg) | `ce2e8e266ef77ae146846d84c84f73a932046ab26fb6d4fb9d39a468ff7c4ff3` |
| [desktop-confirmed.jpg](desktop-confirmed.jpg) | `01e2f5df3997e91de7e13b24fba5b532447e029976a27cadfbf49d6764e2fc68` |
| [390-entry.jpg](390-entry.jpg) | `d467cfbd08b3b3e75be26645bbc829dc0dc39b0830781eaa2a30011e58645d71` |
| [390-chooser.jpg](390-chooser.jpg) | `b883df61b66860a6b864a088322778226ba005afc9af75c251ccbe5b7666bdd6` |
| [390-add.jpg](390-add.jpg) | `6655a41ec1eab5f96be332be1109c487a331f69088a7795b6b7680733d5a16c2` |
| [320-entry.jpg](320-entry.jpg) | `12277ee050f9262b90ee3a5ae409fcdffead94ff5e3a970c12b2de04b7593011` |
| [320-chooser.jpg](320-chooser.jpg) | `2bb451359d9af7259ea80eeee9b6e30adcada4068deef1efaf110c6e96903eb3` |
| [320-add.jpg](320-add.jpg) | `a8a55a72d5898639c714a3f5baea4d6e4336e08bb3ae7b064f1d5b472971361c` |
