import { searchMemory, getMemoryLines } from "./memory.js";
import { searchMem9, isMem9Enabled } from "./mem9.js";

// ---------------------------------------------------------------------------
// Tool definitions (passed to the Claude agent as available tools)
// ---------------------------------------------------------------------------

export const memoryTools = [
  {
    name: "memory_search",
    description:
      "Search across all memory files for relevant context. Use this before answering questions about prior conversations, decisions, preferences, people, or facts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get",
    description:
      "Read specific lines from a memory file. Use after memory_search to get full context around a result.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the memory file (relative to data/)",
        },
        from: { type: "number", description: "Starting line number (1-based)" },
        lines: {
          type: "number",
          description: "Number of lines to read (default: 50)",
        },
      },
      required: ["path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool call handler (async — queries both local FTS5 and mem9 cloud)
// ---------------------------------------------------------------------------

export async function handleMemoryTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "memory_search": {
      const query = input.query as string;
      const maxResults = (input.max_results as number | undefined) ?? 5;
      console.log(`[memory] search: "${query}" (max ${maxResults})`);

      // Run local and cloud searches in parallel
      const [localResults, cloudResults] = await Promise.all([
        Promise.resolve(searchMemory(query, maxResults)),
        searchMem9(query, maxResults),
      ]);

      // Format local results
      const local = localResults.map((r) => ({
        source: "local" as const,
        path: r.path,
        chunkText: r.chunkText,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.score,
      }));

      // Format cloud results
      const cloud = cloudResults.map((r) => ({
        source: "mem9" as const,
        id: r.id,
        memory: r.memory,
        memory_type: r.memory_type,
        tags: r.tags,
      }));

      const hasLocal = local.length > 0;
      const hasCloud = cloud.length > 0;

      if (!hasLocal && !hasCloud) {
        return JSON.stringify({ results: [], message: "No matches found." });
      }

      const response: Record<string, unknown> = {};
      if (hasLocal) response.local = local;
      if (hasCloud) response.mem9 = cloud;

      return JSON.stringify(response);
    }

    case "memory_get": {
      const path = input.path as string;
      const from = input.from as number | undefined;
      const lines = input.lines as number | undefined;
      console.log(`[memory] get: ${path} from=${from ?? 1} lines=${lines ?? 50}`);

      return getMemoryLines(path, from, lines);
    }

    default:
      return JSON.stringify({ error: `Unknown memory tool: ${name}` });
  }
}
