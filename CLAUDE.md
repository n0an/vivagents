# CLAUDE.md

## Project Overview

VivAgents is a standalone HTTP server that wraps CLI AI tools (Claude Code, Codex CLI, Gemini CLI) behind a simple REST API. It's extracted from VivaDicta macOS app's embedded CLI server to run independently on any machine — Mac, Linux VPS, or Docker.

**Primary use case:** VivaDicta iOS/macOS apps connect to VivAgents over the network for AI text processing, instead of requiring a Mac running VivaDicta.

## Build & Run

```bash
npm install
npm run build        # tsc → dist/
npm start            # node dist/index.js (starts server)
node dist/index.js check   # Check which CLIs are available
node dist/index.js token   # Show auth token
```

## Architecture

- **Runtime:** Node.js + TypeScript (ESM)
- **HTTP:** Raw `node:http` (no Express — only 3 routes)
- **CLI spawning:** `node:child_process.spawn` with timeout
- **Config:** `~/.vivagents/config.json` + env vars + CLI args (cascading priority)
- **Auth:** Bearer token stored in `~/.vivagents/token`

### Key files
- `src/index.ts` — Entry point, CLI arg parsing, commands
- `src/server.ts` — HTTP server, routing, auth
- `src/config.ts` — Config loading cascade
- `src/providers/` — Claude, Codex, Gemini CLI providers
- `src/providers/discovery.ts` — Binary discovery (PATH, nvm, known locations)
- `src/routes/` — `/health`, `/models`, `/enhance` handlers
- `src/utils/` — Process spawning, error detection

### API
- `GET /health` — Server status + provider availability
- `GET /models` — Available models per provider
- `POST /enhance` — Process text through a CLI provider

All endpoints require `Authorization: Bearer <token>` header.

## Conventions
- Copyright © 2026 Anton Novoselov
- API is 100% backward-compatible with VivaDicta macOS `ClaudeCLIServer` and iOS `ClaudeCLIServerClient`
- No external dependencies beyond TypeScript + @types/node
