import type { LanguageModel } from 'ai'
import type { BoardRepository } from '../../use-cases/ports/board-repository'
import type { LoggerPort } from '../../use-cases/ports/logger'
import type { MainAgent } from '../../use-cases/ports/main-agent'
import type { TaskQueue } from '../../use-cases/ports/task-queue'
import type { ToolProvider } from '../../use-cases/ports/tool-provider'
import type { EnvConfig } from '../config/env-config'
import type { McpConfig } from '../config/mcp-config'

export const TOKENS = {
  Logger: Symbol.for('shrimp.LoggerPort'),
  BoardRepository: Symbol.for('shrimp.BoardRepository'),
  MainAgent: Symbol.for('shrimp.MainAgent'),
  TaskQueue: Symbol.for('shrimp.TaskQueue'),
  ToolProvider: Symbol.for('shrimp.ToolProvider'),
  LanguageModel: Symbol.for('shrimp.LanguageModel'),
  EnvConfig: Symbol.for('shrimp.EnvConfig'),
  McpConfig: Symbol.for('shrimp.McpConfig'),
} as const

export type TokenRegistry = {
  [TOKENS.Logger]: LoggerPort
  [TOKENS.BoardRepository]: BoardRepository
  [TOKENS.MainAgent]: MainAgent
  [TOKENS.TaskQueue]: TaskQueue
  [TOKENS.ToolProvider]: ToolProvider
  [TOKENS.LanguageModel]: LanguageModel
  [TOKENS.EnvConfig]: EnvConfig
  [TOKENS.McpConfig]: McpConfig
}
