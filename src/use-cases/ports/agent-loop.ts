import type { ToolSet } from './tool-set'

export type AgentLoopTerminationReason = 'finished' | 'maxStepsReached' | 'error'

export type AgentLoopInput = {
  systemPrompt: string
  userPrompt: string
  tools: ToolSet
  maxSteps: number
}

export type AgentLoopResult = {
  reason: AgentLoopTerminationReason
}

export interface AgentLoop {
  run(input: AgentLoopInput): Promise<AgentLoopResult>
}
