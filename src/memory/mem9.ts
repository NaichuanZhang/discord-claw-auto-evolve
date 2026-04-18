import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../shared/paths.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Mem9Config {
  base_url: string;
  api_key: string;
  agent_id: string;
}

const AUTH_PATH = join(DATA_DIR, "skills", "mem9", "auth.json");
const REQUEST_TIMEOUT_MS = 5000; // 5s — don't block local memory if mem9 is slow

let config: Mem9Config | null = null;
let configLoaded = false;

function getConfig(): Mem9Config | null {
  if (configLoaded) return config;
  configLoaded = true;

  try {
    if (!existsSync(AUTH_PATH)) {
      console.log("[mem9] No auth.json found — mem9 disabled");
      return null;
    }
    const raw = readFileSync(AUTH_PATH, "utf-8");
    config = JSON.parse(raw) as Mem9Config;
    console.log("[mem9] Loaded config — cloud memory enabled");
    return config;
  } catch (err) {
    console.error("[mem9] Failed to load auth.json:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mem9SearchResult {
  id: string;
  memory: string;
  memory_type?: string;
  tags?: string[];
  score?: number;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search mem9 cloud memory. Returns results or empty array on failure.
 * Never throws — gracefully degrades if mem9 is unavailable.
 */
export async function searchMem9(
  query: string,
  maxResults: number = 5,
): Promise<Mem9SearchResult[]> {
  const cfg = getConfig();
  if (!cfg) return [];

  try {
    const url = `${cfg.base_url}/v1alpha1/mem9s/${cfg.api_key}/memories?query=${encodeURIComponent(query)}&page_size=${maxResults}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": cfg.api_key,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[mem9] Search failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as { memories?: Mem9SearchResult[] };
    const memories = data.memories ?? [];

    console.log(`[mem9] Search "${query}" returned ${memories.length} results`);
    return memories;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error("[mem9] Search timed out");
    } else {
      console.error("[mem9] Search error:", err);
    }
    return [];
  }
}

/**
 * Check if mem9 is configured and available.
 */
export function isMem9Enabled(): boolean {
  return getConfig() !== null;
}
