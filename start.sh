#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Discordclaw startup script — idempotent, with auto-rollback
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present (for DISCORD_WEBHOOK_URL)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PREVIOUS_HEAD=$(git rev-parse HEAD)
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

# ---------------------------------------------------------------------------
# Notification helper (best-effort, never blocks)
# ---------------------------------------------------------------------------
notify() {
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"$1\"}" > /dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# 1. Pull latest
# ---------------------------------------------------------------------------
echo "[start] Pulling latest from origin/main..."
if ! git pull origin main; then
  notify "❌ discordclaw: git pull failed on $(hostname)"
  echo "[start] ERROR: git pull failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Install deps if lockfile changed
# ---------------------------------------------------------------------------
if git diff --name-only "$PREVIOUS_HEAD" HEAD 2>/dev/null | grep -q "package-lock.json"; then
  echo "[start] package-lock.json changed, running npm ci..."
  npm ci
fi

# ---------------------------------------------------------------------------
# 3. Run migrations (idempotent — each tracks its own completion)
# ---------------------------------------------------------------------------
MIGRATION_DIR="$SCRIPT_DIR/migrations"
MARKER_DIR="$SCRIPT_DIR/data/.migrations"
mkdir -p "$MARKER_DIR"

if [ -d "$MIGRATION_DIR" ]; then
  for f in "$MIGRATION_DIR"/*.sh; do
    [ -f "$f" ] || continue
    MIGRATION_NAME=$(basename "$f" .sh)
    MARKER="$MARKER_DIR/$MIGRATION_NAME.done"

    if [ ! -f "$MARKER" ]; then
      echo "[start] Running migration: $MIGRATION_NAME..."
      if bash "$f"; then
        date -Iseconds > "$MARKER"
        echo "[start] Migration $MIGRATION_NAME completed"
      else
        notify "❌ discordclaw: migration $MIGRATION_NAME failed. Bot NOT started."
        echo "[start] ERROR: migration $MIGRATION_NAME failed"
        exit 1
      fi
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
echo "[start] Building..."
npm run build

# ---------------------------------------------------------------------------
# 5. Start bot
# ---------------------------------------------------------------------------
echo "[start] Starting bot..."
tsx src/index.ts &
BOT_PID=$!

# ---------------------------------------------------------------------------
# 6. Health check (30s timeout)
# ---------------------------------------------------------------------------
HEALTHY=false
GATEWAY_PORT="${GATEWAY_PORT:-3000}"

echo "[start] Waiting for health check on port $GATEWAY_PORT..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$GATEWAY_PORT/api/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 7. Result
# ---------------------------------------------------------------------------
if [ "$HEALTHY" = true ]; then
  CURRENT_COMMIT=$(git log --oneline -1)
  echo "[start] Bot is healthy! ($CURRENT_COMMIT)"
  notify "✅ discordclaw started: $CURRENT_COMMIT"
  wait $BOT_PID
else
  echo "[start] Health check FAILED — rolling back..."
  kill $BOT_PID 2>/dev/null || true
  wait $BOT_PID 2>/dev/null || true

  FAILED_COMMIT=$(git log --oneline -1)
  notify "⚠️ discordclaw health check failed after $FAILED_COMMIT. Rolling back to ${PREVIOUS_HEAD:0:7}..."

  git reset --hard "$PREVIOUS_HEAD"
  echo "[start] Rolled back to $PREVIOUS_HEAD, re-running start.sh..."
  exec bash "$0"
fi
