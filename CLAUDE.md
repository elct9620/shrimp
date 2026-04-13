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

Run a single test file: `pnpm test tests/container.test.ts` (pass any path under `tests/`).

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
