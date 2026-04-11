import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet as AiToolSet } from 'ai'
import type { MainAgent, MainAgentInput, MainAgentResult, MainAgentTerminationReason } from '../../use-cases/ports/main-agent'

export class AiSdkMainAgent implements MainAgent {
  constructor(private readonly model: LanguageModel) {}

  async run(input: MainAgentInput): Promise<MainAgentResult> {
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

function mapFinishReason(reason: string): MainAgentTerminationReason {
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
