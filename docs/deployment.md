# Deployment

One image holds the game server and the built client. Compose runs it with a volume for the SQLite database and a nightly backup service, like the other self-hosted services.

```bash
cp .env.example .env     # optional; see below
docker compose up -d     # http://localhost:3000, or $KRIEGSSPIEL_PORT
docker compose ps        # "healthy" once /healthz answers
```

## Configuration

Compose reads the shell environment and a git-ignored `.env` next to `docker-compose.yml`. Never commit `.env` or any key.

| Variable | Default | Meaning |
|---|---|---|
| `KRIEGSSPIEL_PORT` | `3000` | Host port for the web UI and API |
| `ANTHROPIC_API_KEY` | empty | Passed to the server for the Anthropic provider (see [llm-providers.md](llm-providers.md)). Empty: the umpire runs on the test provider (below) |
| `UMPIRE_KEYLESS_PROVIDER` | `ollama` in the compose file, `test` in the bare image | The provider used by any stage that would use Anthropic with no key. `ollama` is the small local model with `test` as its fallback; `test` is the canned-response umpire (below). For the rule-based order parser alone, set `ORDER_PARSER=stub` |
| `ORDER_PARSER` | unset | With a provider (a key, or the test provider) the umpire parses orders; `stub` forces the rule-based parser |
| `BACKUP_DIR` | `./backups` | Host directory that receives backups |
| `BACKUP_KEEP` | `14` | Number of newest backups kept |
| `BACKUP_HOUR_UTC` | `3` | Hour of the nightly backup |

Login needs two more settings (see D17 in [decisions.md](decisions.md)); add them to the `environment:` of the `kriegsspiel` service or pass them through `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | none | Extra origins (comma-separated) allowed to open a game WebSocket besides `PUBLIC_URL` and the request's own `Host`; `*` turns the check off |
| `PUBLIC_URL` | `http://localhost:$PORT` | Origin that login links point at. Set it to the https address players use; an https value also marks the session cookie `Secure` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so the login rate limits use the caller's `X-Forwarded-For` address. Without it every request shares the proxy's address and the per-address limits become global (20 login mails an hour for everyone). Leave it off when the port is reachable directly, because the header can then be forged to dodge the limits |
| `GUEST_PLAY` | on outside production, off when `NODE_ENV=production`; the compose file sets `1` | `1` lets a visitor press "Play as guest" and play with no email (D17c). A guest is a throwaway account tied to one browser cookie: clearing the cookie loses the games. Turn it off (`0`) on a public deployment that should require login, since anyone can then create games (limited to `GUEST_PER_HOUR` guests per address per hour, default 60, so `TRUST_PROXY` matters here too; behind a proxy that hides client addresses, set `TRUST_PROXY=1` or raise the limit) |
| `GUEST_IDLE_HOURS` | `168` | A guest unused for this long is deleted with their games |
| `DEV_TOOLS` | on outside production, off when `NODE_ENV=production`; the compose file sets `1` | `0` hides the main menu's **Developer tools** section (map editor, map and table benchmarks, admin view). It only hides the buttons: the routes (`/map-authoring`, `/map-benchmark`, `/table-benchmark`, `/admin/`) still work by URL, and the admin view is gated by the `ADMIN_*` settings below. The client reads the setting from `GET /auth/features` |
| `ADMIN_ENABLED` | off; the compose file sets `1` | Mounts the admin API (reads, plus the clock controls: pause, resume, step and rate, #128, logged as `admin` inputs) at `/admin/api` and its page at `/admin/`. Off, every `/admin/api` path is a 404 |
| `ADMIN_TOKEN` | unset | Lets non-loopback callers in with `Authorization: Bearer` or `?token=` when open mode is off. Unset: loopback only (a proxied request never counts as loopback) |
| `ADMIN_OPEN` | off; the compose file sets `1` | With `ADMIN_ENABLED`, any caller can use the admin API and page with no token, no loopback check and no sign-in (#387). The server logs a startup warning, the admin page shows a banner, and the menu's link reads "Admin view (open)". **The demo stack only: anyone who can reach the port can read all hidden game state and LLM prompts, so never expose that port publicly.** Secrets (API keys, login tokens, session cookies, other users' emails) stay redacted, and the clock controls work for anyone who can reach the port. With `NODE_ENV=production` (the image's default) the server refuses to start unless `ADMIN_OPEN_FORCE=1`; the compose file sets both |
| `ADMIN_OPEN_FORCE` | off; the compose file sets `1` | Acknowledges that open mode runs under `NODE_ENV=production` |
| `MAIL_WEBHOOK_URL` | unset | The server POSTs `{to, subject, text}` JSON here to send the login link. Unset, the link is written to the server log (development only: anyone who can read the log can sign in) |
| `MAIL_WEBHOOK_TOKEN` | unset | Optional bearer token sent to the webhook |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | unset | Enable web push. Generate a pair with `npx web-push generate-vapid-keys`. Unset, notifications go by WebSocket and email only |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | A `mailto:` or `https:` contact sent to push services |

Inside the container the server uses `HOST`, `PORT`, `DB_PATH` (`/data/games.db`) and `STATIC_DIR` (the built client); see `server/src/main.ts`. Without `DB_PATH` the server keeps games in memory. `GET /healthz` returns `{"ok":true}` and backs the container health check.

### The keyless demo: a small local model

`docker compose up` starts an `ollama` service beside the game (the official `ollama/ollama` image, CPU only) and the server sets `UMPIRE_KEYLESS_PROVIDER=ollama`. With no `ANTHROPIC_API_KEY`, the **narrate** and **staff** stages are answered by one very small instruct model, `qwen2.5:0.5b` by default; order parsing, judging and the AI commander stay on the `test` umpire below (see [llm-providers.md](llm-providers.md#local-model-in-the-docker-demo) for why parse is left out and how to turn it on). The service pulls the model in the background on first start (it retries until the download succeeds and resumes a partial one), so the game server is never held back. Until the model is there, and whenever Ollama is down, slow (`OLLAMA_TIMEOUT_MS`) or answers with something that fails the checks, the stage answers from the `test` umpire instead and the game carries on. The admin LLM panel marks those calls `fallback` and says why, and the server logs `umpire fallback to test provider`. A key switches everything back to Anthropic.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_MODEL` | `qwen2.5:0.5b` | The model tag. The `ollama` service pulls it; the server asks for it |
| `OLLAMA_STAGES` | `narrate,staff` | Stages the model serves; any of `parse`, `narrate`, `staff` |
| `OLLAMA_URL` | `http://ollama:11434` | Where the server reaches Ollama |
| `OLLAMA_NUM_CTX` | `4096` | Context window sent to Ollama |
| `OLLAMA_TIMEOUT_MS` | `60000` | Per-attempt timeout (two attempts, so a hung model costs up to about 2 minutes plus backoff before the call falls back; later calls skip the model for 30 s). Slower than this and the call falls back |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long Ollama keeps the model in memory |
| `OLLAMA_PORT`, `OLLAMA_BIND` | `11434`, `127.0.0.1` | The published port of the `ollama` service |

**Cost.** The `ollama/ollama` image is 5.6 GB on disk (it bundles GPU libraries this stack does not use). `qwen2.5:0.5b` is 397 MB on disk in the `ollama` volume and about 0.8 GB of memory once loaded; `llama3.2:1b` would be 1.3 GB and 2.4 GB. A call takes seconds to tens of seconds on 4 CPU cores. Narration is only asked for at a clock rate where a window (5 wall minutes) closes before the battle ends, so at 12:1 the 50-minute battle ends first and nothing is narrated by the model; use 4:1 or 1:1 to see it. Calls are made one at a time (`UMPIRE_MAX_CONCURRENT=1`).

**Hosts that cannot create a compose network** (for example `network_mode: bridge` in a local override because the Docker address pool is exhausted): the service name `ollama` does not resolve there. Put the `ollama` service on the same network mode and point the server at the published port, for example in the override:

```yaml
services:
  ollama:
    network_mode: bridge
environment: # on kriegsspiel; 172.17.0.1 is the docker0 gateway, which the published port must be bound to
  OLLAMA_URL: http://172.17.0.1:11434
```

with `OLLAMA_BIND=172.17.0.1` in `.env` so the model server is not published on every interface. Ollama has no authentication, so never publish it beyond the host.

### Canned umpire: the `test` provider

With no `ANTHROPIC_API_KEY` the bare image (or `UMPIRE_KEYLESS_PROVIDER=test` in compose) runs every umpire stage on the `test` provider, and it is also the fallback and the parse, judge and commander umpire of the Ollama mode above, so a demo is fully playable with no key and no local model. It answers from rules and templates, never calls a network, costs nothing and gives the same answer to the same input. Free-text orders ("Move the 1st Battalion to the bridge and hold it.") are understood, dispatches are written in period prose from the reports, and the staff give short advice. It is not clever: it knows the verbs move, hold, screen, withdraw and attack, and places by name or kind, and it ignores conditions and times. The game shows a "Test umpire (canned responses)" badge, and the admin LLM panel marks its calls as `test`. Setting `ANTHROPIC_API_KEY` switches every stage back to the real model, and `ORDER_PARSER=stub` still forces the rule-based parser. See [llm-providers.md](llm-providers.md#test-provider).

### Client build

The image serves the Angular client (`client/dist/browser`, since the Svelte client was removed in #279). `SPA_FALLBACK` is on by default whenever `STATIC_DIR` is set: the server answers `/admin`, `/map-authoring`, `/map-benchmark`, `/table-benchmark`, `/map-table` and anything below them (except `/admin/api`) with `index.html`, and redirects the old `/map-authoring.html`, `/map-benchmark.html`, `/table-benchmark.html`, `/admin/index.html` and `/map-table.html` to the new routes, keeping the query. Set `SPA_FALLBACK=0` to turn it off. `/games`, `/scenarios`, `/auth` and `/admin/api` stay API routes.

## Data and logs

The volume `data` holds one SQLite file in WAL mode. The input log, snapshots and clock history for every game are in it, so it is the whole game record and replays with no model calls. Server logs go to stdout (`docker compose logs kriegsspiel`), rotated at 5 × 10 MB.

## Backups

The `backup` service runs `server/dist/ops/backup.js` at start and then once a night. It uses `VACUUM INTO`, which writes a consistent copy while the game is running, as `$BACKUP_DIR/kriegsspiel-<UTC stamp>.db`, and deletes all but the newest `BACKUP_KEEP`. The service runs as root so it can write to a host `BACKUP_DIR`; after each run it hands any `-wal`/`-shm` files it may have created back to the `node` user. `BACKUP_KEEP` must be a positive integer (a bad value makes the backup fail loudly). Copy `BACKUP_DIR` off the host to survive losing the machine. Take one by hand with:

```bash
docker compose exec backup node /app/server/dist/ops/backup.js backup /data/games.db /backups
```

## Restore

Stop the server first so nothing writes to the file. `restore` checks the backup with `PRAGMA integrity_check`, removes the old `-wal`/`-shm` files and copies the backup into place.

```bash
docker compose stop kriegsspiel backup
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backups" --entrypoint sh backup -c \
  'node /app/server/dist/ops/backup.js restore /backups/kriegsspiel-<stamp>.db /data/games.db && chown node:node /data/games.db'
docker compose up -d
```

Verified once on 2026-10-10: a game was created, backed up, the database file deleted, restored from the backup, and the server restarted healthy on the restored file with the same game row.

## Known limits

Accounts and seats are stored in the same database file, so they survive a restart and are included in backups. The server does not yet reload stored games when it restarts, so a restart or restore keeps the data for replay and inspection but players need a new game.
## Map distribution gate

The container build bootstraps the pinned map source before installing the root dependencies. This makes the source-review recipe reproducible; publishing or distributing a combined browser build remains gated by the owner's licensing decision (D23). No container publication or deployment is part of Epic #132's review PR.

## Game limits (#161)

`POST /games` answers 429 `too_many_games` when the account already has 20 unfinished games (3 for a guest); a game counts while it is in the lobby or open in memory and not over. A sweep every minute closes, in memory only, finished games nobody has been connected to for 30 seconds and games with no connection for 24 hours. Their data stays in the store, so the games list and the umpire's window still work, and the next visit reopens the game paused. The limits are `AppOptions.limits` (`perUser`, `perGuest`, `idleMs`, `sweepEveryMs`, `finishedGraceMs`). `GET /games` replays a stored game once per log length instead of on every call, keeping only the outcome and end time. The cap is a soft bound: it counts games open in memory, so two simultaneous creates can both pass at one below the cap, reopening an evicted game does not check it, and after a restart a user's started games count as zero until revisited.
