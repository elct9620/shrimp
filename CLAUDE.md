# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Shrimp

## Commands

| Command           | Purpose                                |
| ----------------- | -------------------------------------- |
| `pnpm test`       | Run vitest once                        |
| `pnpm test:watch` | Run vitest in watch mode               |
| `pnpm typecheck`  | Run `tsc --noEmit`                     |
| `pnpm build`      | Bundle to `dist/server.mjs` via tsdown |
| `pnpm start`      | Run the bundled server                 |
| `pnpm dev`        | Rebuild and restart on file changes    |
| `pnpm format`     | Format all files with Prettier         |

Run a single test file: `pnpm test tests/container.test.ts` (pass any path under `tests/`).

No ESLint is configured — `pnpm typecheck` plus `pnpm format` (Prettier) are the only static checks.

### Docker

All Docker workflows are exposed as `pnpm docker:*` scripts:

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `pnpm docker:build`    | Build production image                                       |
| `pnpm docker:up`       | Start production stack (reads `.env`, publishes `HOST_PORT`) |
| `pnpm docker:down`     | Stop production stack                                        |
| `pnpm docker:logs`     | Tail production logs                                         |
| `pnpm docker:shell`    | Open a shell in the running container                        |
| `pnpm docker:dev`      | Rebuild image and start dev stack with compose watch         |
| `pnpm docker:dev:down` | Stop dev stack                                               |

`docker:dev` always rebuilds the image (Docker layer cache keeps it cheap), so the freshly baked `dist/` is what the container starts with. Compose watch then syncs `./dist` into the container on subsequent rebuilds — pair with `pnpm dev` in another terminal, or rely on the Claude Stop hook (see below).

Session state is persisted in the `/var/lib/shrimp` VOLUME; Compose mounts `${SHRIMP_DATA_DIR:-./data/shrimp}` from the host so it survives container rebuilds. `docker-compose.yml` uses `env_file: .env` for local runs with the prebuilt GHCR image; `docker-compose.coolify.yml` is the Coolify-only variant that builds from source and declares the full `environment:` block with `${VAR:?}` / `${VAR:-default}` interpolation so Coolify's UI can detect and expose each variable. `pnpm dev` reads `.env` directly through `dotenv`.

## Architecture

Two documents are authoritative:

- `SPEC.md` — behavior, contracts, and success criteria. Consult before changing any endpoint, failure mode, or configuration contract.
- `docs/architecture.md` — code structure: four-layer Clean Architecture (`entities/`, `use-cases/`, `adapters/`, `infrastructure/`), dependency rules, key ports, and SPEC-component-to-module mapping.

Four facts worth internalizing before touching Job or Shrimp Agent code:

- **Shrimp is NOT the Supervisor.** The Supervisor is an internal component of Shrimp that receives heartbeats, owns the Job Queue, and dispatches Job Workers. The Shrimp process contains the Supervisor; it is not the Supervisor.
- **The Shrimp Agent is a black-box executor.** A `Job` (the Job Worker, in code) invokes the `ShrimpAgent` port exactly once per Heartbeat; iterations inside the loop cannot be driven from outside. `AiSdkShrimpAgent` implements this port via AI SDK's `ToolLoopAgent`.
- **Built-in Todoist tools are inbound adapters**, not use cases. They live in `adapters/tools/built-in/` and call `BoardRepository` directly. Do not create per-operation use-case classes for them.
- **Channels are optional inbound adapters parallel to the Todoist Board**, gated by `CHANNELS_ENABLED`. When enabled, Shrimp accepts webhooks (e.g. Telegram), persists conversation state via `JsonlSessionRepository` under `SHRIMP_STATE_DIR` (default `~/.shrimp`; `/var/lib/shrimp` in the Docker image), and processes messages as `ChannelJob`s on the same Supervisor queue.

Layer layout at a glance:

- `adapters/http/` — inbound HTTP routes (Hono handlers).
- `adapters/tools/` — agent tools; `built-in/` are inbound adapters over `BoardRepository`, MCP tools are loaded dynamically.
- `infrastructure/` — one subfolder per external concern (`ai/`, `logger/`, `mcp/`, `queue/`, `todoist/`, `config/`); each contains the concrete implementation of the port its name implies.

## Tech Stack

| Library                      | Role                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| Hono                         | HTTP framework; defines routes and response contracts                       |
| tsyringe                     | Dependency injection container; wires all components at startup             |
| AI SDK                       | Abstraction over AI provider APIs; drives the AI Agent execution loop       |
| MCP (Model Context Protocol) | Extension mechanism; supplementary agent tools are provided via MCP servers |
| pino / pino-http             | Structured logging exposed through `LoggerPort`; injected per-component     |
| zod                          | Runtime schema validation for tool I/O and config                           |
| dotenv                       | Loads environment variables from `.env` in development                      |
| tsdown                       | Bundles the application for production deployment                           |

## Rules

- `.env` (runtime env vars) and `.mcp.json` (supplementary MCP servers) are gitignored; never commit them.
- `*.local.md` files in the repo root (e.g. `LOGGER.local.md`, `SPEC-IMPL.local.md`, `SPEC-WRITE.local.md`) are personal scratchpads — gitignored and non-authoritative. Do not treat them as spec or design sources; consult `SPEC.md` and `docs/architecture.md` instead.
- Tests mirror the `src/` layout under `tests/`, must not hit live external services (Todoist API, AI provider), and mock the Todoist API with MSW at the HTTP boundary — not at the repository level.
- Class and port names follow SPEC terminology (`Job`, `ShrimpAgent`, `Board`), not implementation-derived names.
- DI uses Symbol-based tokens defined in `infrastructure/container/tokens.ts`, not decorator-based injection. All wiring happens in `container.ts` via `useFactory` / `useClass`.
- Prompt templates are `.md` files imported as raw strings via `unplugin-raw` (`import tpl from "./prompts/system.md?raw"`). These live alongside their use-case files.
- A Claude Code Stop hook (`.claude/settings.json`) runs `pnpm build` asynchronously after each session so `dist/` stays in sync with `docker compose --watch`. Do not hand-maintain `dist/`.
- Adding a new runtime env var means updating three places together: `infrastructure/config/env-config.ts` (parsing + validation), `.env.example` (documentation + local default), and the `environment:` block in `docker-compose.coolify.yml` (Coolify UI exposure).
