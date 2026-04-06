#!/bin/bash
set -euo pipefail
# Migration: 001-add-evolution-table
# Idempotent: uses IF NOT EXISTS
# Note: The table is also created by initDb() in src/db/index.ts.
# This migration exists as a template for future bot-created migrations.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$SCRIPT_DIR/../data/discordclaw.db"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS evolutions (
  id TEXT PRIMARY KEY,
  triggered_by TEXT,
  trigger_message TEXT,
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT NOT NULL DEFAULT 'idea',
  changes_summary TEXT,
  files_changed TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  proposed_at INTEGER,
  merged_at INTEGER,
  deployed_at INTEGER
);
SQL

echo "Evolution table ready."
