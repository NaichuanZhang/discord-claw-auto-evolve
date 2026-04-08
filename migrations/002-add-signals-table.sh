#!/bin/bash
set -euo pipefail
# Migration: 002-add-signals-table
# Adds the signals table for self-evolution reflection system

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$SCRIPT_DIR/../data/discordclaw.db"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,          -- 'error', 'tool_failure', 'user_sentiment', 'pattern', 'unknown_request'
  source TEXT,                 -- where the signal came from (e.g. 'messages', 'agent', 'cron')
  detail TEXT NOT NULL,        -- human-readable description
  metadata TEXT,               -- JSON blob for structured data
  session_id TEXT,             -- optional link to session
  user_id TEXT,                -- optional link to user
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);

-- Track reflection runs separately
CREATE TABLE IF NOT EXISTS reflection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  signals_analyzed INTEGER DEFAULT 0,
  outcome TEXT,                -- 'no_action', 'idea_recorded', 'proposal_sent'
  proposal TEXT,               -- the proposal text if any
  evolution_id TEXT,           -- link to evolution if idea was recorded
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
SQL

echo "Signals and reflection_runs tables ready."
