import type { TodoistApi } from '@doist/todoist-sdk'
import type { LoggerPort } from '../../use-cases/ports/logger'

export type TodoistTask = {
  id: string
  content: string
  description: string | null
  project_id: string
  section_id: string | null
  priority: number
}

export type TodoistComment = {
  id: string
  task_id: string
  content: string
  posted_at: string
}

export type TodoistSection = {
  id: string
  project_id: string
  name: string
  order: number
}

export class TodoistApiError extends Error {
  readonly name = 'TodoistApiError'

  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`TodoistApiError: ${status} ${url} — ${body.slice(0, 200)}`)
  }
}

export class TodoistClient {
  constructor(
    private readonly api: TodoistApi,
    private readonly logger: LoggerPort,
  ) {}

  async listTasks(params: { projectId: string; sectionId: string }): Promise<TodoistTask[]> {
    this.logger.debug('todoist request', { method: 'GET', operation: 'getTasks', params })
    const response = await this.api.getTasks({
      projectId: params.projectId,
      sectionId: params.sectionId,
    })
    this.logger.debug('todoist response', {
      method: 'GET',
      operation: 'getTasks',
      count: response.results.length,
    })
    return response.results.map((task) => ({
      id: task.id,
      content: task.content,
      description: task.description || null,
      project_id: task.projectId,
      section_id: task.sectionId,
      priority: task.priority,
    }))
  }

  async listComments(params: { taskId: string }): Promise<TodoistComment[]> {
    this.logger.debug('todoist request', { method: 'GET', operation: 'getComments', params })
    const response = await this.api.getComments({ taskId: params.taskId })
    this.logger.debug('todoist response', {
      method: 'GET',
      operation: 'getComments',
      count: response.results.length,
    })
    return response.results.map((comment) => ({
      id: comment.id,
      task_id: comment.taskId ?? '',
      content: comment.content,
      posted_at: comment.postedAt instanceof Date
        ? comment.postedAt.toISOString()
        : String(comment.postedAt),
    }))
  }

  async postComment(params: { taskId: string; content: string }): Promise<void> {
    this.logger.debug('todoist request', { method: 'POST', operation: 'addComment', params: { taskId: params.taskId } })
    await this.api.addComment({ taskId: params.taskId, content: params.content })
    this.logger.debug('todoist response', { method: 'POST', operation: 'addComment' })
  }

  async moveTask(params: { taskId: string; sectionId: string }): Promise<void> {
    this.logger.debug('todoist request', { method: 'POST', operation: 'moveTask', params: { taskId: params.taskId } })
    await this.api.moveTask(params.taskId, { sectionId: params.sectionId })
    this.logger.debug('todoist response', { method: 'POST', operation: 'moveTask' })
  }

  async listSections(params: { projectId: string }): Promise<TodoistSection[]> {
    this.logger.debug('todoist request', { method: 'GET', operation: 'getSections', params })
    const response = await this.api.getSections({ projectId: params.projectId })
    this.logger.debug('todoist response', {
      method: 'GET',
      operation: 'getSections',
      count: response.results.length,
    })
    return response.results.map((section) => ({
      id: section.id,
      project_id: section.projectId,
      name: section.name,
      order: section.sectionOrder,
    }))
  }
}
