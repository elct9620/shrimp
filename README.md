# Shrimp

A tiny background agent that works through your [Todoist](https://todoist.com/)
tasks for you. Whenever you nudge it with a heartbeat, Shrimp picks the
top-priority task on a designated board and lets an AI agent work on it,
posting progress back as task comments.

Optionally, you can also chat with it through a Telegram bot.

## What you need

- Node.js 20+ and [pnpm](https://pnpm.io/) 10+ (or just Docker)
- A Todoist project set up as a Kanban board with three sections:
  `Backlog`, `In Progress`, `Done`
- An OpenAI-compatible API key (OpenAI, OpenRouter, a self-hosted gateway,
  etc.)

## Get started

```bash
pnpm install
cp .env.example .env
# fill in the required values (see Configuration below)
pnpm dev
```

Then nudge Shrimp to pick up a task:

```bash
curl -X POST http://localhost:3000/heartbeat
```

That is the whole loop — schedule that one call however you like (cron, an
uptime monitor, a GitHub Action) and Shrimp will keep your board moving.

## Run with Docker

A pre-built image is published on every release:

```bash
cp .env.example .env
pnpm docker:up      # start
pnpm docker:logs    # follow logs
pnpm docker:down    # stop
```

The container exposes port `3000` and persists its state under
`./data/shrimp` on the host (override with `SHRIMP_DATA_DIR`).

## Configuration

All settings are environment variables. Copy `.env.example` and edit; the
file is annotated with the same notes as below.

### Required

| Variable             | Description                                   |
| -------------------- | --------------------------------------------- |
| `OPENAI_BASE_URL`    | Base URL of the OpenAI-compatible AI provider |
| `OPENAI_API_KEY`     | API key for the AI provider                   |
| `AI_MODEL`           | Model identifier (e.g. `gpt-4o`)              |
| `TODOIST_API_TOKEN`  | Todoist personal API token                    |
| `TODOIST_PROJECT_ID` | ID of the Todoist project used as the Board   |

### General (optional)

| Variable       | Default | Description                                                         |
| -------------- | ------- | ------------------------------------------------------------------- |
| `AI_MAX_STEPS` | `50`    | Max tool-loop steps the agent may take per heartbeat                |
| `PORT`         | `3000`  | HTTP port the server listens on                                     |
| `LOG_LEVEL`    | `info`  | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |

### Telemetry (optional, off by default)

Set `TELEMETRY_ENABLED=true` to emit OpenTelemetry traces for each job.
When enabled, `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` become
required.

| Variable                      | Default                           | Description                                                         |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `TELEMETRY_ENABLED`           | `false`                           | Master toggle for tracing                                           |
| `OTEL_SERVICE_NAME`           | `shrimp`                          | Service name attached to every span                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP collector URL                                                  |
| `OTEL_EXPORTER_OTLP_HEADERS`  | —                                 | Comma-separated `key=value` headers (e.g. `Authorization=Bearer …`) |
| `TELEMETRY_RECORD_INPUTS`     | `true`                            | Set `false` to omit prompts from spans                              |
| `TELEMETRY_RECORD_OUTPUTS`    | `true`                            | Set `false` to omit model output from spans                         |
| `OTEL_LOG_LEVEL`              | `warn`                            | Set `debug` to investigate exporter problems                        |

### Telegram channel (optional, off by default)

Set `CHANNELS_ENABLED=true` to mount the Telegram webhook and let users chat
with Shrimp. When enabled, `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_WEBHOOK_SECRET` become required. Point your bot's webhook at
`https://<your-host>/channels/telegram` and send `/new` to start a fresh
conversation.

| Variable                  | Default         | Description                                                         |
| ------------------------- | --------------- | ------------------------------------------------------------------- |
| `CHANNELS_ENABLED`        | `false`         | Master toggle for inbound Channels                                  |
| `TELEGRAM_BOT_TOKEN`      | —               | Bot token from BotFather                                            |
| `TELEGRAM_WEBHOOK_SECRET` | —               | Shared secret Telegram must present on each webhook call            |
| `SHRIMP_STATE_DIR`        | `~/.shrimp`     | Where session state is stored (auto-created at startup)             |
| `SHRIMP_DATA_DIR`         | `./data/shrimp` | Docker only: host path mounted into the container's state directory |

### Extra tools via MCP (optional)

Drop a `.mcp.json` file in the project root to give the agent extra tools
through [MCP](https://modelcontextprotocol.io/) servers — web search, file
access, code execution, anything you can wire up. The file follows the
standard MCP format (`{"mcpServers": { ... }}`); no code changes needed.

When running with Docker, `.mcp.json` is not baked into the image. To
persist it across rebuilds, uncomment the `.mcp.json` bind-mount line in
`docker-compose.yml` and make sure the host file exists before
`pnpm docker:up` (Docker will silently create a directory in its place
otherwise). Override the host path with `SHRIMP_MCP_CONFIG` if you keep
the file elsewhere.

## Learn more

- [`SPEC.md`](./SPEC.md) — full behavior contract and edge cases
- [`docs/architecture.md`](./docs/architecture.md) — how the code is laid out
- [`CLAUDE.md`](./CLAUDE.md) — commands and project conventions

## License

[Apache-2.0](./LICENSE)
