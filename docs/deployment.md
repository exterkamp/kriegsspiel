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
| `ANTHROPIC_API_KEY` | empty | Passed to the server for the Anthropic provider (see [llm-providers.md](llm-providers.md)) |
| `BACKUP_DIR` | `./backups` | Host directory that receives backups |
| `BACKUP_KEEP` | `14` | Number of newest backups kept |
| `BACKUP_HOUR_UTC` | `3` | Hour of the nightly backup |

Login needs two more settings (see D17 in [decisions.md](decisions.md)); add them to the `environment:` of the `kriegsspiel` service or pass them through `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:$PORT` | Origin that login links point at. Set it to the https address players use; an https value also marks the session cookie `Secure` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so the login rate limits use the caller's `X-Forwarded-For` address. Without it every request shares the proxy's address and the per-address limits become global (20 login mails an hour for everyone). Leave it off when the port is reachable directly, because the header can then be forged to dodge the limits |
| `MAIL_WEBHOOK_URL` | unset | The server POSTs `{to, subject, text}` JSON here to send the login link. Unset, the link is written to the server log (development only: anyone who can read the log can sign in) |
| `MAIL_WEBHOOK_TOKEN` | unset | Optional bearer token sent to the webhook |

Inside the container the server uses `HOST`, `PORT`, `DB_PATH` (`/data/games.db`) and `STATIC_DIR` (the built client); see `server/src/main.ts`. Without `DB_PATH` the server keeps games in memory. `GET /healthz` returns `{"ok":true}` and backs the container health check.

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
