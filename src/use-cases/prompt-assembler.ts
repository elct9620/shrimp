import { Task } from '../entities/task'
import { Comment } from '../entities/comment'
import type { ToolDescription } from './ports/tool-description'

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

  return `You are an autonomous task execution agent. Your goal is to complete the assigned task and report progress when done.

## Available Tools

${toolList}`
}

function buildUserPrompt(task: Task, comments: Comment[]): string {
  const descriptionSection =
    task.description !== undefined
      ? `\nDescription: ${task.description}`
      : ''

  const commentSection =
    comments.length > 0
      ? `\n## Comment History\n\n${comments.map((c) => c.text).join('\n\n')}`
      : ''

  return `## Task

ID: ${task.id}
Title: ${task.title}${descriptionSection}
Section: ${task.section}${commentSection}`
}
