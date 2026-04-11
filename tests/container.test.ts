import { describe, expect, it, afterEach, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import { EnvConfigError } from '../src/infrastructure/config/env-config'
import type { McpToolLoader } from '../src/infrastructure/mcp/mcp-tool-loader'
import type { BoardRepository } from '../src/use-cases/ports/board-repository'
import type { LoggerPort } from '../src/use-cases/ports/logger'

// ---------------------------------------------------------------------------
// Shared test doubles
// ---------------------------------------------------------------------------

const REQUIRED_ENV = {
  OPENAI_BASE_URL: 'http://localhost:11434/v1',
  OPENAI_API_KEY: 'dummy-key',
  AI_MODEL: 'test-model',
  TODOIST_API_TOKEN: 'todoist-token',
  TODOIST_PROJECT_ID: 'project-123',
}

function makeFakeLanguageModel(): LanguageModel {
  return {
    specificationVersion: 'v1',
    provider: 'test',
    modelId: 'test-model',
    defaultObjectGenerationMode: undefined,
    doGenerate: vi.fn().mockResolvedValue({ text: '', usage: {}, finishReason: 'stop', rawResponse: { headers: {} }, warnings: [] }),
    doStream: vi.fn(),
  } as unknown as LanguageModel
}

function makeFakeBoardRepository(): BoardRepository {
  return {
    getTasks: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
  }
}

function makeFakeMcpToolLoader(): McpToolLoader {
  return {
    load: vi.fn().mockResolvedValue({ tools: {}, descriptions: [] }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpToolLoader
}

function makeFakeLogger(): LoggerPort {
  const child = vi.fn()
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: child,
  }
  child.mockReturnValue(logger)
  return logger
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should return an app that responds 200 to GET /health when all env vars are set', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value)
    }

    const { composeApp } = await import('../src/container')
    const { app } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
      logger: makeFakeLogger(),
    })

    const res = await app.request('/health', { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('should return an app that responds 202 to POST /heartbeat when all env vars are set', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value)
    }

    const { composeApp } = await import('../src/container')
    const { app } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
      logger: makeFakeLogger(),
    })

    const res = await app.request('/heartbeat', { method: 'POST' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted' })
  })

  it('should throw EnvConfigError when required env vars are missing', async () => {
    // No env vars stubbed — all missing

    const { composeApp } = await import('../src/container')

    await expect(
      composeApp({
        languageModel: makeFakeLanguageModel(),
        boardRepository: makeFakeBoardRepository(),
        mcpToolLoader: makeFakeMcpToolLoader(),
        logger: makeFakeLogger(),
      })
    ).rejects.toThrow(EnvConfigError)
  })

  it('should succeed when .mcp.json is absent (tolerates missing file)', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value)
    }

    const { composeApp } = await import('../src/container')

    // mcpToolLoader override skips actual file loading — composition must still succeed
    await expect(
      composeApp({
        languageModel: makeFakeLanguageModel(),
        boardRepository: makeFakeBoardRepository(),
        mcpToolLoader: makeFakeMcpToolLoader(),
        logger: makeFakeLogger(),
      })
    ).resolves.toBeDefined()
  })

  it('should return an mcpToolLoader whose close() can be called without throwing', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value)
    }

    const fakeMcpToolLoader = makeFakeMcpToolLoader()
    const { composeApp } = await import('../src/container')
    const { mcpToolLoader } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: fakeMcpToolLoader,
      logger: makeFakeLogger(),
    })

    await expect(mcpToolLoader.close()).resolves.toBeUndefined()
  })

  it('should return the injected logger instance in the composed result', async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value)
    }

    const fakeLogger = makeFakeLogger()
    const { composeApp } = await import('../src/container')
    const { logger } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
      logger: fakeLogger,
    })

    expect(logger).toBe(fakeLogger)
  })
})
