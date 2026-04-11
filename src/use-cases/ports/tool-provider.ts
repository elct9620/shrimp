import type { ToolDescription } from './tool-description'
import type { ToolSet } from './tool-set'

export interface ToolProvider {
  getTools(): ToolSet
  getToolDescriptions(): ToolDescription[]
}
