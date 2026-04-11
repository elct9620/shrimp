import { describe, expect, it, vi } from 'vitest'
import { Section } from '../../../src/entities/section'
import { Priority } from '../../../src/entities/priority'
import { BoardSectionMissingError } from '../../../src/use-cases/ports/board-repository'
import {
  TodoistBoardRepository,
} from '../../../src/infrastructure/todoist/todoist-board-repository'
import type {
  TodoistTask,
  TodoistComment,
  TodoistSection,
} from '../../../src/infrastructure/todoist/todoist-client'
import type { LoggerPort } from '../../../src/use-cases/ports/logger'

function makeFakeLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  }
  return logger
}

// ─── Fake Client ─────────────────────────────────────────────────────────────

interface FakeTodoistClient {
  listTasks: ReturnType<typeof vi.fn>
  listComments: ReturnType<typeof vi.fn>
  postComment: ReturnType<typeof vi.fn>
  moveTask: ReturnType<typeof vi.fn>
  listSections: ReturnType<typeof vi.fn>
}

function makeFakeClient(overrides?: Partial<FakeTodoistClient>): FakeTodoistClient {
  return {
    listTasks: vi.fn().mockResolvedValue([]),
    listComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
    listSections: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

const ALL_SECTIONS: TodoistSection[] = [
  { id: 'sec-backlog', project_id: 'proj-1', name: 'Backlog', order: 1 },
  { id: 'sec-inprogress', project_id: 'proj-1', name: 'In Progress', order: 2 },
  { id: 'sec-done', project_id: 'proj-1', name: 'Done', order: 3 },
]

const PROJECT_ID = 'proj-1'

// ─── getTasks ─────────────────────────────────────────────────────────────────

describe('TodoistBoardRepository.getTasks', () => {
  it('should return mapped tasks with correct field mapping when section present', async () => {
    const rawTasks: TodoistTask[] = [
      {
        id: 'task-1',
        content: 'Fix the bug',
        description: 'Some details',
        project_id: PROJECT_ID,
        section_id: 'sec-inprogress',
        priority: 2,
      },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue(rawTasks),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const tasks = await repo.getTasks(Section.InProgress)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual({
      id: 'task-1',
      title: 'Fix the bug',
      description: 'Some details',
      priority: Priority.p3, // Todoist 2 → domain p3 (5-2=3)
      section: Section.InProgress,
    })
  })

  it('should map Todoist priority 4 to domain p1 (highest)', async () => {
    const rawTasks: TodoistTask[] = [
      {
        id: 'task-p1',
        content: 'Urgent task',
        description: null,
        project_id: PROJECT_ID,
        section_id: 'sec-inprogress',
        priority: 4,
      },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue(rawTasks),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const tasks = await repo.getTasks(Section.InProgress)

    expect(tasks[0].priority).toBe(Priority.p1) // domain value 1
  })

  it('should map Todoist priority 1 to domain p4 (lowest)', async () => {
    const rawTasks: TodoistTask[] = [
      {
        id: 'task-p4',
        content: 'Low priority task',
        description: null,
        project_id: PROJECT_ID,
        section_id: 'sec-inprogress',
        priority: 1,
      },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue(rawTasks),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const tasks = await repo.getTasks(Section.InProgress)

    expect(tasks[0].priority).toBe(Priority.p4) // domain value 4
  })

  it('should map Todoist task with description null to undefined', async () => {
    const rawTasks: TodoistTask[] = [
      {
        id: 'task-nodesc',
        content: 'No description task',
        description: null,
        project_id: PROJECT_ID,
        section_id: 'sec-backlog',
        priority: 3,
      },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue(rawTasks),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const tasks = await repo.getTasks(Section.Backlog)

    expect(tasks[0].description).toBeUndefined()
  })

  it('should return empty array when no tasks in section', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue([]),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const tasks = await repo.getTasks(Section.InProgress)

    expect(tasks).toEqual([])
  })

  it('should call listSections with correct projectId', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.getTasks(Section.Backlog)

    expect(client.listSections).toHaveBeenCalledWith({ projectId: PROJECT_ID })
  })

  it('should call listTasks with the resolved sectionId for Backlog', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.getTasks(Section.Backlog)

    expect(client.listTasks).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sectionId: 'sec-backlog',
    })
  })

  it('should call listTasks with the resolved sectionId for In Progress using exact name match', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.getTasks(Section.InProgress)

    expect(client.listTasks).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sectionId: 'sec-inprogress',
    })
  })

  it('should throw BoardSectionMissingError when Backlog section is missing', async () => {
    const sectionsWithoutBacklog = ALL_SECTIONS.filter((s) => s.name !== 'Backlog')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutBacklog),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await expect(repo.getTasks(Section.Backlog)).rejects.toThrow(BoardSectionMissingError)
  })

  it('should throw BoardSectionMissingError when In Progress section is missing', async () => {
    const sectionsWithoutInProgress = ALL_SECTIONS.filter((s) => s.name !== 'In Progress')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutInProgress),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await expect(repo.getTasks(Section.InProgress)).rejects.toThrow(BoardSectionMissingError)
  })

  it('should throw BoardSectionMissingError when Done section is missing', async () => {
    const sectionsWithoutDone = ALL_SECTIONS.filter((s) => s.name !== 'Done')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutDone),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await expect(repo.getTasks(Section.Done)).rejects.toThrow(BoardSectionMissingError)
  })

  it('should not match section by case-insensitive name — exact match only', async () => {
    const sectionsWithWrongCase: TodoistSection[] = [
      { id: 'sec-backlog', project_id: PROJECT_ID, name: 'backlog', order: 1 },
      { id: 'sec-inprogress', project_id: PROJECT_ID, name: 'in progress', order: 2 },
      { id: 'sec-done', project_id: PROJECT_ID, name: 'done', order: 3 },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithWrongCase),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await expect(repo.getTasks(Section.InProgress)).rejects.toThrow(BoardSectionMissingError)
  })
})

// ─── getComments ──────────────────────────────────────────────────────────────

describe('TodoistBoardRepository.getComments', () => {
  it('should return mapped comments with text and timestamp as Date', async () => {
    const rawComments: TodoistComment[] = [
      {
        id: 'c1',
        task_id: 'task-1',
        content: 'This is a comment',
        posted_at: '2024-03-15T10:30:00Z',
      },
    ]
    const client = makeFakeClient({
      listComments: vi.fn().mockResolvedValue(rawComments),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const comments = await repo.getComments('task-1')

    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe('This is a comment')
    expect(comments[0].timestamp).toBeInstanceOf(Date)
    expect(comments[0].timestamp.toISOString()).toBe('2024-03-15T10:30:00.000Z')
  })

  it('should call listComments with the given taskId', async () => {
    const client = makeFakeClient()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.getComments('task-42')

    expect(client.listComments).toHaveBeenCalledWith({ taskId: 'task-42' })
  })

  it('should return empty array when no comments exist', async () => {
    const client = makeFakeClient({
      listComments: vi.fn().mockResolvedValue([]),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const comments = await repo.getComments('task-1')

    expect(comments).toEqual([])
  })
})

// ─── postComment ──────────────────────────────────────────────────────────────

describe('TodoistBoardRepository.postComment', () => {
  it('should delegate to client.postComment with correct params', async () => {
    const client = makeFakeClient()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.postComment('task-1', 'Hello world')

    expect(client.postComment).toHaveBeenCalledWith({
      taskId: 'task-1',
      content: 'Hello world',
    })
  })

  it('should return void on success', async () => {
    const client = makeFakeClient()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const result = await repo.postComment('task-1', 'Done')

    expect(result).toBeUndefined()
  })
})

// ─── moveTask ─────────────────────────────────────────────────────────────────

describe('TodoistBoardRepository.moveTask', () => {
  it('should resolve section ID and delegate to client.moveTask', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.moveTask('task-1', Section.Done)

    expect(client.moveTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      sectionId: 'sec-done',
    })
  })

  it('should resolve In Progress section ID correctly', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await repo.moveTask('task-2', Section.InProgress)

    expect(client.moveTask).toHaveBeenCalledWith({
      taskId: 'task-2',
      sectionId: 'sec-inprogress',
    })
  })

  it('should throw BoardSectionMissingError when destination section is missing', async () => {
    const sectionsWithoutDone = ALL_SECTIONS.filter((s) => s.name !== 'Done')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutDone),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    await expect(repo.moveTask('task-1', Section.Done)).rejects.toThrow(BoardSectionMissingError)
  })

  it('should return void on success', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, makeFakeLogger())

    const result = await repo.moveTask('task-1', Section.Backlog)

    expect(result).toBeUndefined()
  })
})

// ─── Logging ──────────────────────────────────────────────────────────────────

describe('TodoistBoardRepository logging', () => {
  it('should log debug with section and count when tasks are loaded', async () => {
    const rawTasks: TodoistTask[] = [
      { id: 't1', content: 'A', description: null, project_id: PROJECT_ID, section_id: 'sec-backlog', priority: 1 },
      { id: 't2', content: 'B', description: null, project_id: PROJECT_ID, section_id: 'sec-backlog', priority: 2 },
    ]
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
      listTasks: vi.fn().mockResolvedValue(rawTasks),
    })
    const logger = makeFakeLogger()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, logger)

    await repo.getTasks(Section.Backlog)

    expect(logger.debug).toHaveBeenCalledWith(
      'board tasks loaded',
      expect.objectContaining({ section: Section.Backlog, count: 2 }),
    )
  })

  it('should log info with taskId and section after a successful moveTask', async () => {
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(ALL_SECTIONS),
    })
    const logger = makeFakeLogger()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, logger)

    await repo.moveTask('task-42', Section.Done)

    expect(logger.info).toHaveBeenCalledWith(
      'task moved',
      expect.objectContaining({ taskId: 'task-42', section: Section.Done }),
    )
  })

  it('should log error with targetName and available sections when section is missing', async () => {
    const sectionsWithoutDone = ALL_SECTIONS.filter((s) => s.name !== 'Done')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutDone),
    })
    const logger = makeFakeLogger()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, logger)

    await expect(repo.getTasks(Section.Done)).rejects.toThrow(BoardSectionMissingError)

    expect(logger.error).toHaveBeenCalledWith(
      'board section missing',
      expect.objectContaining({
        targetName: 'Done',
        availableSections: ['Backlog', 'In Progress'],
      }),
    )
  })

  it('should not log info when moveTask throws because section is missing', async () => {
    const sectionsWithoutDone = ALL_SECTIONS.filter((s) => s.name !== 'Done')
    const client = makeFakeClient({
      listSections: vi.fn().mockResolvedValue(sectionsWithoutDone),
    })
    const logger = makeFakeLogger()
    const repo = new TodoistBoardRepository(client as never, PROJECT_ID, logger)

    await expect(repo.moveTask('task-1', Section.Done)).rejects.toThrow(BoardSectionMissingError)

    expect(logger.info).not.toHaveBeenCalled()
  })
})
