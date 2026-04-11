import { describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import { AiSdkAgentLoop } from '../../../src/infrastructure/ai/ai-sdk-agent-loop'
import type { AgentLoopInput } from '../../../src/use-cases/ports/agent-loop'

type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'

// Minimal LanguageModelV2 stub — fulfills the v2 interface without calling any live API.
// LanguageModel = LanguageModelV3 | LanguageModelV2 | GlobalProviderModelId; the v2 shape
// is identified by specificationVersion: 'v2'.
function makeModel(finishReason: FinishReason = 'stop') {
  const doGenerate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'done' }],
    finishReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  })

  const model = {
    specificationVersion: 'v2' as const,
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    doGenerate,
    doStream: async () => { throw new Error('streaming not needed') },
  } satisfies LanguageModel

  return { model, doGenerate }
}

const baseInput: AgentLoopInput = {
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Complete the task.',
  tools: { my_tool: {} },
  maxSteps: 3,
}

describe('AiSdkAgentLoop.run', () => {
  describe('termination reason mapping', () => {
    it('should return finished when model returns stop', async () => {
      const { model } = makeModel('stop')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('finished')
    })

    it('should return finished when model returns tool-calls', async () => {
      const { model } = makeModel('tool-calls')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('finished')
    })

    it('should return maxStepsReached when model returns length', async () => {
      const { model } = makeModel('length')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('maxStepsReached')
    })

    it('should return error when model returns error', async () => {
      const { model } = makeModel('error')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('error')
    })

    it('should return error when model returns content-filter', async () => {
      const { model } = makeModel('content-filter')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('error')
    })

    it('should return error when model returns other', async () => {
      const { model } = makeModel('other')
      const loop = new AiSdkAgentLoop(model)

      const result = await loop.run(baseInput)

      expect(result.reason).toBe('error')
    })
  })

  describe('input passthrough', () => {
    it('should pass systemPrompt as instructions to ToolLoopAgent', async () => {
      const { model, doGenerate } = makeModel('stop')
      const loop = new AiSdkAgentLoop(model)

      await loop.run({ ...baseInput, systemPrompt: 'System instruction here.' })

      const callOptions = doGenerate.mock.calls[0][0]
      // AI SDK v6 encodes instructions as a system-role message in the prompt array
      const systemMessage = callOptions.prompt.find((m: { role: string }) => m.role === 'system')
      expect(systemMessage?.content).toBe('System instruction here.')
    })

    it('should pass userPrompt as the user message to ToolLoopAgent', async () => {
      const { model, doGenerate } = makeModel('stop')
      const loop = new AiSdkAgentLoop(model)

      await loop.run({ ...baseInput, userPrompt: 'Do the thing now.' })

      const callOptions = doGenerate.mock.calls[0][0]
      const userMessages = callOptions.prompt.filter((m: { role: string }) => m.role === 'user')
      expect(userMessages.length).toBeGreaterThan(0)
      const firstUser = userMessages[0]
      const textPart = firstUser.content.find((p: { type: string }) => p.type === 'text') as { type: 'text'; text: string } | undefined
      expect(textPart?.text).toBe('Do the thing now.')
    })

    it('should pass tools from input to ToolLoopAgent', async () => {
      const { model, doGenerate } = makeModel('stop')
      const loop = new AiSdkAgentLoop(model)
      const tools = { special_tool: { description: 'does special things', parameters: {} } }

      await loop.run({ ...baseInput, tools })

      const callOptions = doGenerate.mock.calls[0][0]
      expect(callOptions.tools).toBeDefined()
      expect(callOptions.tools!.some((t: { name: string }) => t.name === 'special_tool')).toBe(true)
    })
  })

  describe('independence across calls', () => {
    it('should work correctly when called multiple times', async () => {
      const { model } = makeModel('stop')
      const loop = new AiSdkAgentLoop(model)

      const result1 = await loop.run(baseInput)
      const result2 = await loop.run({ ...baseInput, userPrompt: 'Second call.' })

      expect(result1.reason).toBe('finished')
      expect(result2.reason).toBe('finished')
    })
  })
})
