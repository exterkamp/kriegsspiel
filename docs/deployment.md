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
| `UMPIRE_KEYLESS_PROVIDER` | `test` in the image and compose file | The provider used by any stage that would use Anthropic with no key. `test` is the canned-response umpire (below). For the rule-based order parser alone, set `ORDER_PARSER=stub` |
| `ORDER_PARSER` | unset | With a provider (a key, or the test provider) the umpire parses orders; `stub` forces the rule-based parser |
| `BACKUP_DIR` | `./backups` | Host directory that receives backups |
| `BACKUP_KEEP` | `14` | Number of newest backups kept |
| `BACKUP_HOUR_UTC` | `3` | Hour of the nightly backup |

Login needs two more settings (see D17 in [decisions.md](decisions.md)); add them to the `environment:` of the `kriegsspiel` service or pass them through `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:$PORT` | Origin that login links point at. Set it to the https address players use; an https value also marks the session cookie `Secure` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so the login rate limits use the caller's `X-Forwarded-For` address. Without it every request shares the proxy's address and the per-address limits become global (20 login mails an hour for everyone). Leave it off when the port is reachable directly, because the header can then be forged to dodge the limits |
| `GUEST_PLAY` | on outside production, off when `NODE_ENV=production`; the compose file sets `1` | `1` lets a visitor press "Play as guest" and play with no email (D17c). A guest is a throwaway account tied to one browser cookie: clearing the cookie loses the games. Turn it off (`0`) on a public deployment that should require login, since anyone can then create games (limited to `GUEST_PER_HOUR` guests per address per hour, default 60, so `TRUST_PROXY` matters here too; behind a proxy that hides client addresses, set `TRUST_PROXY=1` or raise the limit) |
| `GUEST_IDLE_HOURS` | `168` | A guest unused for this long is deleted with their games |
| `DEV_TOOLS` | on outside production, off when `NODE_ENV=production`; the compose file sets `1` | `0` hides the main menu's **Developer tools** section (map editor, map and table benchmarks, admin view). It only hides the buttons: the routes (`/map-authoring`, `/map-benchmark`, `/table-benchmark`, `/admin/`) still work by URL, and the admin view still asks for the admin token. The client reads the setting from `GET /auth/features` |
| `MAIL_WEBHOOK_URL` | unset | The server POSTs `{to, subject, text}` JSON here to send the login link. Unset, the link is written to the server log (development only: anyone who can read the log can sign in) |
| `MAIL_WEBHOOK_TOKEN` | unset | Optional bearer token sent to the webhook |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | unset | Enable web push. Generate a pair with `npx web-push generate-vapid-keys`. Unset, notifications go by WebSocket and email only |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | A `mailto:` or `https:` contact sent to push services |

Inside the container the server uses `HOST`, `PORT`, `DB_PATH` (`/data/games.db`) and `STATIC_DIR` (the built client); see `server/src/main.ts`. Without `DB_PATH` the server keeps games in memory. `GET /healthz` returns `{"ok":true}` and backs the container health check.

### The keyless demo: test umpire

With no `ANTHROPIC_API_KEY` the image and compose file run every umpire stage on the `test` provider (`UMPIRE_KEYLESS_PROVIDER=test`), so a demo is fully playable with no key and no local model. It answers from rules and templates, never calls a network, costs nothing and gives the same answer to the same input. Free-text orders ("Move the 1st Battalion to the bridge and hold it.") are understood, dispatches are written in period prose from the reports, and the staff give short advice. It is not clever: it knows the verbs move, hold, screen, withdraw and attack, and places by name or kind, and it ignores conditions and times. The game shows a "Test umpire (canned responses)" badge, and the admin LLM panel marks its calls as `test`. Setting `ANTHROPIC_API_KEY` switches every stage back to the real model, and `ORDER_PARSER=stub` still forces the rule-based parser. See [llm-providers.md](llm-providers.md#test-provider).

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
