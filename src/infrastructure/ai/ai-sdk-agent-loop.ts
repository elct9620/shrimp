import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet as AiToolSet } from 'ai'
import type { AgentLoop, AgentLoopInput, AgentLoopResult, AgentLoopTerminationReason } from '../../use-cases/ports/agent-loop'

export class AiSdkAgentLoop implements AgentLoop {
  constructor(private readonly model: LanguageModel) {}

  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const agent = new ToolLoopAgent({
      model: this.model,
      tools: input.tools as AiToolSet,
      instructions: input.systemPrompt,
      stopWhen: stepCountIs(input.maxSteps),
    })

    const result = await agent.generate({ prompt: input.userPrompt })

    return {
      reason: mapFinishReason(result.finishReason),
    }
  }
}

function mapFinishReason(reason: string): AgentLoopTerminationReason {
  switch (reason) {
    case 'stop':
    case 'tool-calls':
      return 'finished'
    case 'length':
      return 'maxStepsReached'
    default:
      return 'error'
  }
}
