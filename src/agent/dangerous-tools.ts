// ---------------------------------------------------------------------------
// Dangerous tools — bash execution, file I/O
// Enabled by default. These give the agent full system access.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const BASH_TIMEOUT = 30_000; // 30s
const MAX_OUTPUT = 8192; // 8KB output cap
const MAX_FILE_SIZE = 256 * 1024; // 256KB read limit

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const dangerousTools = [
  {
    name: "bash",
    description:
      "Execute a shell command and return stdout/stderr. Use for system tasks, running scripts, installing packages, checking processes, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 30000, max 60000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file from the filesystem. Returns the file content as text.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleDangerousTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "bash": {
        const command = input.command as string;
        const timeout = Math.min(
          (input.timeout as number) || BASH_TIMEOUT,
          60_000,
        );

        console.log(`[agent] bash: ${command.slice(0, 200)}`);

        try {
          const { stdout, stderr } = await execFileAsync(
            "/bin/bash",
            ["-c", command],
            { timeout, maxBuffer: 1024 * 1024 },
          );

          const out = stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stdout;
          const err = stderr.length > MAX_OUTPUT
            ? stderr.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stderr;

          return JSON.stringify({
            exit_code: 0,
            stdout: out,
            stderr: err || undefined,
          });
        } catch (execErr: any) {
          return JSON.stringify({
            exit_code: execErr.code ?? 1,
            stdout: (execErr.stdout || "").slice(0, MAX_OUTPUT),
            stderr: (execErr.stderr || execErr.message || "").slice(
              0,
              MAX_OUTPUT,
            ),
          });
        }
      }

      case "read_file": {
        const filePath = input.path as string;
        const resolved = path.resolve(filePath);

        if (!fs.existsSync(resolved)) {
          return JSON.stringify({ error: `File not found: ${filePath}` });
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          return JSON.stringify({ error: `"${filePath}" is a directory` });
        }
        if (stat.size > MAX_FILE_SIZE) {
          return JSON.stringify({
            error: `File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})`,
          });
        }

        const content = fs.readFileSync(resolved, "utf-8");
        return JSON.stringify({ path: resolved, content });
      }

      case "write_file": {
        const filePath = input.path as string;
        const content = input.content as string;
        const resolved = path.resolve(filePath);

        // Create parent directories
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(resolved, content, "utf-8");
        return JSON.stringify({ success: true, path: resolved });
      }

      default:
        return JSON.stringify({ error: `Unknown dangerous tool: ${name}` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[agent] Dangerous tool "${name}" failed:`, msg);
    return JSON.stringify({ error: msg });
  }
}
