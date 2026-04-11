import type { ToolProvider } from '../../use-cases/ports/tool-provider'
import type { ToolSet } from '../../use-cases/ports/tool-set'
import type { ToolDescription } from '../../use-cases/ports/tool-description'

export type ToolRegistryInput = {
  builtInTools: ToolSet
  builtInDescriptions: ToolDescription[]
  mcpTools: ToolSet
  mcpDescriptions: ToolDescription[]
}

export class ToolRegistry implements ToolProvider {
  constructor(private readonly input: ToolRegistryInput) {}

  getTools(): ToolSet {
    return { ...this.input.mcpTools, ...this.input.builtInTools }
  }

  getToolDescriptions(): ToolDescription[] {
    const builtInNames = new Set(this.input.builtInDescriptions.map((d) => d.name))
    const filteredMcp = this.input.mcpDescriptions.filter((d) => !builtInNames.has(d.name))
    return [...this.input.builtInDescriptions, ...filteredMcp]
  }
}
