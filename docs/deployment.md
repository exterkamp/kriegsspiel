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

Inside the container the server uses `HOST`, `PORT`, `DB_PATH` (`/data/games.db`) and `STATIC_DIR` (the built client); see `server/src/main.ts`. Without `DB_PATH` the server keeps games in memory. `GET /healthz` returns `{"ok":true}` and backs the container health check.

## Data and logs

The volume `data` holds one SQLite file in WAL mode. The input log, snapshots and clock history for every game are in it, so it is the whole game record and replays with no model calls. Server logs go to stdout (`docker compose logs kriegsspiel`), rotated at 5 × 10 MB.

## Backups

The `backup` service runs `server/dist/ops/backup.js` at start and then once a night. It uses `VACUUM INTO`, which writes a consistent copy while the game is running, as `$BACKUP_DIR/kriegsspiel-<UTC stamp>.db`, and deletes all but the newest `BACKUP_KEEP`. Copy `BACKUP_DIR` off the host to survive losing the machine. Take one by hand with:

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

The server does not yet reload stored games or side tokens when it restarts (tokens are in memory), so a restart or restore keeps the data for replay and inspection but players need a new game. That belongs with accounts in Epic #5.
