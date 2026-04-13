import { Task } from '../entities/task'
import { Comment } from '../entities/comment'
import type { ToolDescription } from './ports/tool-description'
import systemTemplate from './prompts/system.md?raw'
import userTemplate from './prompts/user.md?raw'

export type { ToolDescription }

export type AssembleInput = {
  task: Task
  comments: Comment[]
  tools: ToolDescription[]
}

export type AssembleOutput = {
  systemPrompt: string
  userPrompt: string
}

export function assemble({ task, comments, tools }: AssembleInput): AssembleOutput {
  const systemPrompt = buildSystemPrompt(tools)
  const userPrompt = buildUserPrompt(task, comments)
  return { systemPrompt, userPrompt }
}

function buildSystemPrompt(tools: ToolDescription[]): string {
  const toolList =
    tools.length > 0
      ? tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
      : '(none)'

  return systemTemplate.replace('{{toolList}}', toolList)
}

function buildUserPrompt(task: Task, comments: Comment[]): string {
  const descriptionSection =
    task.description !== undefined
      ? `\nDescription: ${task.description}`
      : ''

  const commentSection =
    comments.length > 0
      ? `\n## Comment History\n\n${comments.map((c) => `[${c.author === 'bot' ? 'Bot' : 'User'}] ${c.text}`).join('\n\n')}`
      : ''

  return userTemplate
    .replace('{{id}}', task.id)
    .replace('{{title}}', task.title)
    .replace('{{description}}', descriptionSection)
    .replace('{{section}}', task.section)
    .replace('{{comments}}', commentSection)
}
