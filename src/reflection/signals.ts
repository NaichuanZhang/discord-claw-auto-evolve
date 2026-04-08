// ---------------------------------------------------------------------------
// Signal collection — captures events that inform self-evolution reflection
// ---------------------------------------------------------------------------

import { getDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalType =
  | "error"           // Uncaught errors, crashes
  | "tool_failure"    // Tool calls that returned errors
  | "user_sentiment"  // Positive/negative user reactions
  | "unknown_request" // User asked for something the agent couldn't do
  | "pattern";        // Repeated patterns worth noting

export interface Signal {
  id: number;
  type: SignalType;
  source: string | null;
  detail: string;
  metadata: Record<string, unknown> | null;
  sessionId: string | null;
  userId: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function recordSignal(opts: {
  type: SignalType;
  source?: string;
  detail: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO signals (type, source, detail, metadata, session_id, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.type,
        opts.source ?? null,
        opts.detail,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
        opts.sessionId ?? null,
        opts.userId ?? null,
        Date.now(),
      );
  } catch (err) {
    // Never let signal recording crash the main flow
    console.error("[signals] Failed to record signal:", err);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function rowToSignal(row: Record<string, unknown>): Signal {
  return {
    id: row.id as number,
    type: row.type as SignalType,
    source: (row.source as string) ?? null,
    detail: row.detail as string,
    metadata: row.metadata
      ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
      : null,
    sessionId: (row.session_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    createdAt: row.created_at as number,
  };
}

/**
 * Get signals since a given timestamp, optionally filtered by type.
 */
export function getSignalsSince(
  since: number,
  opts?: { type?: SignalType; limit?: number },
): Signal[] {
  const params: unknown[] = [since];
  let sql = "SELECT * FROM signals WHERE created_at > ?";

  if (opts?.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }

  sql += " ORDER BY created_at DESC";

  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToSignal);
}

/**
 * Get a summary of signal counts by type since a given timestamp.
 */
export function getSignalSummary(since: number): Record<SignalType, number> {
  const rows = getDb()
    .prepare(
      `SELECT type, COUNT(*) as count FROM signals WHERE created_at > ? GROUP BY type`,
    )
    .all(since) as { type: SignalType; count: number }[];

  const summary: Record<string, number> = {
    error: 0,
    tool_failure: 0,
    user_sentiment: 0,
    unknown_request: 0,
    pattern: 0,
  };

  for (const row of rows) {
    summary[row.type] = row.count;
  }

  return summary as Record<SignalType, number>;
}

/**
 * Get the most common error/failure details since a given timestamp.
 */
export function getTopSignals(
  since: number,
  opts?: { type?: SignalType; limit?: number },
): { detail: string; count: number; type: string }[] {
  const params: unknown[] = [since];
  let sql = `SELECT type, detail, COUNT(*) as count FROM signals WHERE created_at > ?`;

  if (opts?.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }

  sql += " GROUP BY type, detail ORDER BY count DESC";

  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  return getDb().prepare(sql).all(...params) as {
    detail: string;
    count: number;
    type: string;
  }[];
}

/**
 * Prune old signals to prevent unbounded growth.
 */
export function pruneSignals(olderThan: number): number {
  const result = getDb()
    .prepare("DELETE FROM signals WHERE created_at < ?")
    .run(olderThan);
  return result.changes;
}
