# Shrimp

## Tech Stack

| Library | Role |
|---------|------|
| Hono | HTTP framework; defines routes and response contracts |
| tsyringe | Dependency injection container; wires all components at startup |
| AI SDK | Abstraction over AI provider APIs; drives the AI Agent execution loop |
| MCP (Model Context Protocol) | Extension mechanism; supplementary agent tools are provided via MCP servers |
| dotenv | Loads environment variables from `.env` in development |
| tsdown | Bundles the application for production deployment |

## Development

| Tool | Role |
|------|------|
| `.env` | Supplies all environment variables locally; not committed to source control |
| `dotenv` | Loads `.env` at process startup in non-production environments |
| `vitest` | Test runner for unit and integration tests |
| `tsdown` | Bundles the application for production |

### Rules

- `.env` supplies environment variables locally; `.mcp.json` configures supplementary MCP servers. Both files are not committed to source control.
- Tests must not depend on live external services (Todoist API, AI provider); use mocks or stubs.
