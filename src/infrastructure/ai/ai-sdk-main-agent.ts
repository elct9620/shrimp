import { injectable, inject } from 'tsyringe'
import { ToolLoopAgent, stepCountIs, type LanguageModel, type ToolSet as AiToolSet } from 'ai'
import type { MainAgent, MainAgentInput, MainAgentResult, MainAgentTerminationReason } from '../../use-cases/ports/main-agent'
import type { LoggerPort } from '../../use-cases/ports/logger'
import { TOKENS } from '../container/tokens'

@injectable()
export class AiSdkMainAgent implements MainAgent {
  constructor(
    @inject(TOKENS.LanguageModel) private readonly model: LanguageModel,
    @inject(TOKENS.Logger) private readonly logger: LoggerPort,
  ) {}

  async run(input: MainAgentInput): Promise<MainAgentResult> {
    const toolCount = Object.keys(input.tools).length
    this.logger.debug('main agent run started', {
      maxSteps: input.maxSteps,
      toolCount,
    })

    const agent = new ToolLoopAgent({
      model: this.model,
      tools: input.tools as AiToolSet,
      instructions: input.systemPrompt,
      stopWhen: stepCountIs(input.maxSteps),
    })

    let result
    try {
      result = await agent.generate({ prompt: input.userPrompt })
    } catch (err) {
      this.logger.error('main agent run failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    const reason = mapFinishReason(result.finishReason)
    this.logger.info('main agent run finished', {
      finishReason: result.finishReason,
      reason,
    })

    return { reason }
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
