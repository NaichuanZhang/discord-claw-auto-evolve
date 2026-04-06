# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start bot + gateway (tsx src/index.ts)
npm run build        # TypeScript compile + Vite build dashboard
npm run build:ui     # Build dashboard SPA only
npm run typecheck    # tsc --noEmit (no test suite exists)
```

The dashboard SPA lives at `src/gateway/ui/` and builds to `dist/ui/`. Vite dev server proxies `/api` and `/ws` to localhost:3000.

## Architecture

This is a Discord bot that uses Claude as its AI backend. The system has six major subsystems that initialize sequentially in `src/index.ts`:

**Bot → Agent → Claude API pipeline**: Discord messages flow through `bot/messages.ts` (filter, session resolve, context build) → `agent/agent.ts` (system prompt assembly, tool loop with max 10 turns) → Anthropic SDK. The agent has tools for memory search, Discord actions, skill reading, and dangerous ops (bash, file I/O).

**Session management**: Sessions are keyed by thread/channel/user/DM combination. `agent/sessions.ts` resolves the correct session and loads history from SQLite. Sessions auto-expire based on `SESSION_TTL_HOURS`.

**Soul system**: Bot personality loaded from `data/SOUL.md` with filesystem watcher for hot-reload. Injected into every system prompt.

**Memory system**: Markdown files in `data/` and `data/memory/` are chunked and indexed into SQLite FTS5. The agent searches memory via BM25-ranked full-text search before answering context-dependent questions.

**Skills system**: SKILL.md files with YAML frontmatter in `data/skills/`. Uses progressive loading — only metadata goes into the system prompt; full content is read on demand via `read_skill` tool. Installable from GitHub URLs.

**Cron service**: Scheduled tasks stored as JSON in `data/cron/`. Three schedule types: one-shot (`at`), interval (`every`), cron expression. Jobs can run agent turns and deliver results to Discord channels. Auto-disables after 3 consecutive failures.

**Gateway**: Express server + WebSocket at `/ws/logs` for real-time log streaming. REST API at `/api/*` exposes all subsystem CRUD. React SPA dashboard served from `dist/ui/`.

## Key Patterns

- **ESM throughout**: `"type": "module"` in package.json. All internal imports use `.js` extensions (NodeNext module resolution). Use `import.meta.url` / `fileURLToPath` for `__dirname`.
- **Singleton services**: `getDb()`, `getSoul()`, `getSkillService()` are module-level singletons. The Discord client reference is passed via setter functions (`setDiscordClient`, `setMessageClient`) to avoid circular deps.
- **Shared restart trigger**: `src/restart.ts` holds a callback set by `index.ts` and called by `commands.ts` / `api.ts` — avoids circular dependency between entry point and command handlers.
- **DM dedup**: `bot/client.ts` uses both `messageCreate` and a raw gateway event fallback for DMs, with a Set-based dedup mechanism (discord.js v14 sometimes misses DM events for uncached channels).
- **All runtime data** lives in `data/` (gitignored): SQLite DB, SOUL.md, memory files, cron store, skills.

## Environment

Requires either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (for proxy). `DISCORD_BOT_TOKEN` is always required. See `.env.example`.
