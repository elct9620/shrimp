import type { ToolProvider } from './tool-provider'

export interface ToolProviderFactory {
  create(): ToolProvider
}
