import type { Comment } from '../../entities/comment'
import { Priority } from '../../entities/priority'
import { Section } from '../../entities/section'
import type { Task } from '../../entities/task'
import { BoardRepository, BoardSectionMissingError } from '../../use-cases/ports/board-repository'
import type { LoggerPort } from '../../use-cases/ports/logger'
import type { TodoistClient, TodoistSection } from './todoist-client'

// SPEC §Prerequisites: exact section names — not configurable
const SECTION_NAME_BACKLOG = 'Backlog'
const SECTION_NAME_IN_PROGRESS = 'In Progress'
const SECTION_NAME_DONE = 'Done'

function domainSectionToName(section: Section): string {
  switch (section) {
    case Section.Backlog:
      return SECTION_NAME_BACKLOG
    case Section.InProgress:
      return SECTION_NAME_IN_PROGRESS
    case Section.Done:
      return SECTION_NAME_DONE
  }
}

// Todoist REST v2 priority is inverted relative to domain Priority:
//   Todoist 4 = p1 (highest) → domain Priority.p1 = 1
//   Todoist 1 = p4 (lowest)  → domain Priority.p4 = 4
function todoistPriorityToDomain(n: number): Priority {
  return (5 - n) as Priority
}

export class TodoistBoardRepository implements BoardRepository {
  constructor(
    private readonly client: TodoistClient,
    private readonly projectId: string,
    private readonly logger: LoggerPort,
  ) {}

  async getTasks(section: Section): Promise<Task[]> {
    const sectionId = await this.resolveSectionId(section)
    const rawTasks = await this.client.listTasks({ projectId: this.projectId, sectionId })
    const tasks = rawTasks.map((raw) => ({
      id: raw.id,
      title: raw.content,
      description: raw.description ?? undefined,
      priority: todoistPriorityToDomain(raw.priority),
      section,
    }))
    this.logger.debug('board tasks loaded', { section, count: tasks.length })
    return tasks
  }

  async getComments(taskId: string): Promise<Comment[]> {
    const rawComments = await this.client.listComments({ taskId })
    return rawComments.map((raw) => ({
      text: raw.content,
      timestamp: new Date(raw.posted_at),
    }))
  }

  async postComment(taskId: string, text: string): Promise<void> {
    await this.client.postComment({ taskId, content: text })
  }

  async moveTask(taskId: string, section: Section): Promise<void> {
    const sectionId = await this.resolveSectionId(section)
    await this.client.moveTask({ taskId, sectionId })
    this.logger.info('task moved', { taskId, section })
  }

  private async resolveSectionId(section: Section): Promise<string> {
    const targetName = domainSectionToName(section)
    const sections: TodoistSection[] = await this.client.listSections({ projectId: this.projectId })
    const found = sections.find((s) => s.name === targetName)
    if (!found) {
      this.logger.error('board section missing', {
        targetName,
        availableSections: sections.map((s) => s.name),
      })
      throw new BoardSectionMissingError(targetName)
    }
    return found.id
  }
}
