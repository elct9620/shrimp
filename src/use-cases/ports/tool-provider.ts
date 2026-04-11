import type { ToolSet } from './tool-set'

export interface ToolProvider {
  getTools(): ToolSet
}
