import { describe, expect, it, afterEach, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import { EnvConfigError } from '../src/infrastructure/config/env-config'
import type { McpToolLoader } from '../src/infrastructure/mcp/mcp-tool-loader'
import type { BoardRepository } from '../src/use-cases/ports/board-repository'

const REQUIRED_ENV = {
  OPENAI_BASE_URL: 'http://localhost:11434/v1',
  OPENAI_API_KEY: 'dummy-key',
  AI_MODEL: 'test-model',
  TODOIST_API_TOKEN: 'todoist-token',
  TODOIST_PROJECT_ID: 'project-123',
  LOG_LEVEL: 'silent',
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

function stubRequiredEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    vi.stubEnv(key, value)
  }
}

describe('composeApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should return an app that responds 200 to GET /health when all env vars are set', async () => {
    stubRequiredEnv()

    const { composeApp } = await import('../src/container')
    const { app } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
    })

    const res = await app.request('/health', { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('should return an app that responds 202 to POST /heartbeat when all env vars are set', async () => {
    stubRequiredEnv()

    const { composeApp } = await import('../src/container')
    const { app } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
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
      })
    ).rejects.toThrow(EnvConfigError)
  })

  it('should succeed when .mcp.json is absent (tolerates missing file)', async () => {
    stubRequiredEnv()

    const { composeApp } = await import('../src/container')

    await expect(
      composeApp({
        languageModel: makeFakeLanguageModel(),
        boardRepository: makeFakeBoardRepository(),
        mcpToolLoader: makeFakeMcpToolLoader(),
      })
    ).resolves.toBeDefined()
  })

  it('should return an mcpToolLoader whose close() can be called without throwing', async () => {
    stubRequiredEnv()

    const fakeMcpToolLoader = makeFakeMcpToolLoader()
    const { composeApp } = await import('../src/container')
    const { mcpToolLoader } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: fakeMcpToolLoader,
    })

    await expect(mcpToolLoader.close()).resolves.toBeUndefined()
  })

  it('should emit the composition startup log through the injected destination', async () => {
    vi.stubEnv('LOG_LEVEL', 'info')
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      if (key !== 'LOG_LEVEL') vi.stubEnv(key, value)
    }

    const messages: string[] = []
    const destination = {
      write: (msg: string) => {
        messages.push(msg)
      },
    }

    const { composeApp } = await import('../src/container')
    const { logger } = await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      mcpToolLoader: makeFakeMcpToolLoader(),
      logDestination: destination,
    })

    expect(logger).toBeDefined()
    const envLog = messages.find((m) => m.includes('env config loaded'))
    expect(envLog).toBeDefined()
    const parsed = JSON.parse(envLog!)
    expect(parsed.msg).toBe('env config loaded')
    expect(parsed.logLevel).toBe('info')
    expect(parsed.port).toBeDefined()
    expect(parsed.aiMaxSteps).toBeDefined()
  })

  it('should log "mcp config loaded" with server count when .mcp.json is absent', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug')
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      if (key !== 'LOG_LEVEL') vi.stubEnv(key, value)
    }

    const messages: string[] = []
    const destination = {
      write: (msg: string) => {
        messages.push(msg)
      },
    }

    const { composeApp } = await import('../src/container')
    // Without mcpToolLoader override, composeApp attempts to read .mcp.json.
    // The real file does not exist in test CWD, so the ENOENT branch fires.
    await composeApp({
      languageModel: makeFakeLanguageModel(),
      boardRepository: makeFakeBoardRepository(),
      logDestination: destination,
    })

    const debugLog = messages.find((m) => m.includes('no .mcp.json found'))
    expect(debugLog).toBeDefined()
  })
})
