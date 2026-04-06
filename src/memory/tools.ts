import { searchMemory, getMemoryLines } from "./memory.js";

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
// Tool call handler
// ---------------------------------------------------------------------------

export function handleMemoryTool(
  name: string,
  input: Record<string, unknown>
): string {
  switch (name) {
    case "memory_search": {
      const query = input.query as string;
      const maxResults = (input.max_results as number | undefined) ?? 5;
      console.log(`[memory] search: "${query}" (max ${maxResults})`);

      const results = searchMemory(query, maxResults);

      if (results.length === 0) {
        return JSON.stringify({ results: [], message: "No matches found." });
      }

      return JSON.stringify({ results });
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
