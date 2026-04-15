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

| Command                | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `pnpm docker:build`    | Build production image                                                |
| `pnpm docker:up`       | Start production stack (reads `.env`, publishes `HOST_PORT`)          |
| `pnpm docker:down`     | Stop production stack                                                 |
| `pnpm docker:logs`     | Tail production logs                                                  |
| `pnpm docker:shell`    | Open a shell in the running container                                 |
| `pnpm docker:dev`      | Start dev stack with compose watch; syncs `./dist` into the container |
| `pnpm docker:dev:down` | Stop dev stack                                                        |

`docker:dev` only runs compose watch — keep `dist/` fresh via `pnpm dev` in another terminal, or rely on the Claude Stop hook (see below).

## Architecture

Two documents are authoritative:

- `SPEC.md` — behavior, contracts, and success criteria. Consult before changing any endpoint, failure mode, or configuration contract.
- `docs/architecture.md` — code structure: four-layer Clean Architecture (`entities/`, `use-cases/`, `adapters/`, `infrastructure/`), dependency rules, key ports, and SPEC-component-to-module mapping.

Three facts worth internalizing before touching Processing Cycle or Main Agent code:

- **Shrimp (the process) IS the Supervisor.** No class named `Supervisor` exists; Shrimp itself receives heartbeats and runs Processing Cycles.
- **The Main Agent is a black box executor.** `ProcessingCycle` invokes the `MainAgent` port exactly once per heartbeat; iterations inside the loop cannot be driven from outside. `AiSdkMainAgent` implements this port via AI SDK's `ToolLoopAgent`.
- **Built-in Todoist tools are inbound adapters**, not use cases. They live in `adapters/tools/built-in/` and call `BoardRepository` directly. Do not create per-operation use-case classes for them.

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

## Development

| Tool     | Role                                                                        |
| -------- | --------------------------------------------------------------------------- |
| `.env`   | Supplies all environment variables locally; not committed to source control |
| `dotenv` | Loads `.env` at process startup in non-production environments              |
| `vitest` | Test runner for unit and integration tests                                  |
| `tsdown` | Bundles the application for production                                      |

### Rules

- `.env` supplies environment variables locally; `.mcp.json` configures supplementary MCP servers. Both files are not committed to source control.
- `*.local.md` files in the repo root (e.g. `LOGGER.local.md`, `SPEC-IMPL.local.md`, `SPEC-WRITE.local.md`) are personal scratchpads — gitignored and non-authoritative. Do not treat them as spec or design sources; consult `SPEC.md` and `docs/architecture.md` instead.
- Tests must not depend on live external services (Todoist API, AI provider); use mocks or stubs.
- Class and port names follow SPEC terminology (`ProcessingCycle`, `MainAgent`, `Board`), not implementation-derived names.
- Test files mirror the `src/` directory structure under `tests/`. Tests use MSW to mock the Todoist API at the HTTP boundary, not at the repository level.
- DI uses Symbol-based tokens defined in `infrastructure/container/tokens.ts`, not decorator-based injection. All wiring happens in `container.ts` via `useFactory` / `useClass`.
- Prompt templates are `.md` files imported as raw strings via `unplugin-raw` (`import tpl from "./prompts/system.md?raw"`). These live alongside their use-case files.
- A Claude Code Stop hook (`.claude/settings.json`) runs `pnpm build` asynchronously after each session so `dist/` stays in sync with `docker compose --watch`. Do not hand-maintain `dist/`.
