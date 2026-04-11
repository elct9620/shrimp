import { describe, expect, it, vi } from 'vitest'
import {
  TodoistClient,
  TodoistApiError,
  type FetchLike,
  type TodoistTask,
  type TodoistComment,
  type TodoistSection,
} from '../../../src/infrastructure/todoist/todoist-client'

const BASE_URL = 'https://api.todoist.com/rest/v2'
const TOKEN = 'test-token-abc123'

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeNoContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function makeErrorResponse(status: number, body = 'Bad Request'): Response {
  return new Response(body, { status })
}

function stubFetch(response: Response): FetchLike {
  return vi.fn().mockResolvedValue(response)
}

function getCallArgs(fetchFn: FetchLike): [string, RequestInit] {
  return (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
}

// ─── listTasks ────────────────────────────────────────────────────────────────

describe('TodoistClient.listTasks', () => {
  const tasks: TodoistTask[] = [
    {
      id: '1',
      content: 'Fix the bug',
      description: 'Some details',
      project_id: 'proj-1',
      section_id: 'sec-1',
      priority: 4,
    },
  ]

  it('should call correct URL with project_id and section_id query params', async () => {
    const fetchFn = stubFetch(makeOkResponse(tasks))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listTasks({ projectId: 'proj-1', sectionId: 'sec-1' })

    const [url] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/tasks?project_id=proj-1&section_id=sec-1`)
  })

  it('should set Authorization header with Bearer token', async () => {
    const fetchFn = stubFetch(makeOkResponse(tasks))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listTasks({ projectId: 'proj-1', sectionId: 'sec-1' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('should return parsed JSON array of tasks', async () => {
    const fetchFn = stubFetch(makeOkResponse(tasks))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    const result = await client.listTasks({ projectId: 'proj-1', sectionId: 'sec-1' })

    expect(result).toEqual(tasks)
  })

  it('should use GET method', async () => {
    const fetchFn = stubFetch(makeOkResponse(tasks))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listTasks({ projectId: 'proj-1', sectionId: 'sec-1' })

    const [, init] = getCallArgs(fetchFn)
    expect(init?.method).toBe('GET')
  })
})

// ─── listComments ─────────────────────────────────────────────────────────────

describe('TodoistClient.listComments', () => {
  const comments: TodoistComment[] = [
    { id: 'c1', task_id: 't1', content: 'First comment', posted_at: '2024-01-01T00:00:00Z' },
  ]

  it('should call correct URL with task_id query param', async () => {
    const fetchFn = stubFetch(makeOkResponse(comments))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listComments({ taskId: 't1' })

    const [url] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/comments?task_id=t1`)
  })

  it('should return parsed JSON array of comments', async () => {
    const fetchFn = stubFetch(makeOkResponse(comments))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    const result = await client.listComments({ taskId: 't1' })

    expect(result).toEqual(comments)
  })

  it('should set Authorization header', async () => {
    const fetchFn = stubFetch(makeOkResponse(comments))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listComments({ taskId: 't1' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${TOKEN}`)
  })
})

// ─── postComment ──────────────────────────────────────────────────────────────

describe('TodoistClient.postComment', () => {
  it('should POST to /comments with correct JSON body', async () => {
    const fetchFn = stubFetch(makeOkResponse({ id: 'c2', task_id: 't1', content: 'Done', posted_at: '2024-01-01T00:00:00Z' }))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.postComment({ taskId: 't1', content: 'Done' })

    const [url, init] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/comments`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ task_id: 't1', content: 'Done' })
  })

  it('should return void on success', async () => {
    const fetchFn = stubFetch(makeNoContentResponse())
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    const result = await client.postComment({ taskId: 't1', content: 'Done' })

    expect(result).toBeUndefined()
  })

  it('should set Authorization header', async () => {
    const fetchFn = stubFetch(makeNoContentResponse())
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.postComment({ taskId: 't1', content: 'Done' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('should set Content-Type to application/json', async () => {
    const fetchFn = stubFetch(makeNoContentResponse())
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.postComment({ taskId: 't1', content: 'Done' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json')
  })
})

// ─── moveTask ─────────────────────────────────────────────────────────────────

describe('TodoistClient.moveTask', () => {
  it('should POST to /tasks/{taskId}/move with section_id body', async () => {
    const fetchFn = stubFetch(makeOkResponse({}))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.moveTask({ taskId: 'task-42', sectionId: 'sec-done' })

    const [url, init] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/tasks/task-42/move`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ section_id: 'sec-done' })
  })

  it('should return void on success', async () => {
    const fetchFn = stubFetch(makeOkResponse({}))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    const result = await client.moveTask({ taskId: 'task-42', sectionId: 'sec-done' })

    expect(result).toBeUndefined()
  })

  it('should set Authorization header', async () => {
    const fetchFn = stubFetch(makeOkResponse({}))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.moveTask({ taskId: 'task-42', sectionId: 'sec-done' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${TOKEN}`)
  })
})

// ─── listSections ─────────────────────────────────────────────────────────────

describe('TodoistClient.listSections', () => {
  const sections: TodoistSection[] = [
    { id: 's1', project_id: 'proj-1', name: 'Backlog', order: 1 },
    { id: 's2', project_id: 'proj-1', name: 'In Progress', order: 2 },
    { id: 's3', project_id: 'proj-1', name: 'Done', order: 3 },
  ]

  it('should call correct URL with project_id query param', async () => {
    const fetchFn = stubFetch(makeOkResponse(sections))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listSections({ projectId: 'proj-1' })

    const [url] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/sections?project_id=proj-1`)
  })

  it('should return parsed array of sections', async () => {
    const fetchFn = stubFetch(makeOkResponse(sections))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    const result = await client.listSections({ projectId: 'proj-1' })

    expect(result).toEqual(sections)
  })

  it('should set Authorization header', async () => {
    const fetchFn = stubFetch(makeOkResponse(sections))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listSections({ projectId: 'proj-1' })

    const [, init] = getCallArgs(fetchFn)
    expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('should use GET method', async () => {
    const fetchFn = stubFetch(makeOkResponse(sections))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.listSections({ projectId: 'proj-1' })

    const [, init] = getCallArgs(fetchFn)
    expect(init?.method).toBe('GET')
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('TodoistClient error handling', () => {
  it('should throw TodoistApiError when response is 4xx', async () => {
    const fetchFn = stubFetch(makeErrorResponse(404, 'Not Found'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await expect(client.listTasks({ projectId: 'p', sectionId: 's' })).rejects.toThrow(TodoistApiError)
  })

  it('should throw TodoistApiError when response is 5xx', async () => {
    const fetchFn = stubFetch(makeErrorResponse(500, 'Internal Server Error'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await expect(client.listComments({ taskId: 't1' })).rejects.toThrow(TodoistApiError)
  })

  it('should include status and URL in TodoistApiError', async () => {
    const fetchFn = stubFetch(makeErrorResponse(401, 'Unauthorized'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    let caught: TodoistApiError | undefined
    try {
      await client.listTasks({ projectId: 'p', sectionId: 's' })
    } catch (e) {
      caught = e as TodoistApiError
    }

    expect(caught).toBeInstanceOf(TodoistApiError)
    expect(caught?.status).toBe(401)
    expect(caught?.url).toContain('/tasks')
    expect(caught?.message).toContain('401')
    expect(caught?.message).toContain('/tasks')
  })

  it('should have name "TodoistApiError"', async () => {
    const fetchFn = stubFetch(makeErrorResponse(403, 'Forbidden'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    let caught: TodoistApiError | undefined
    try {
      await client.listSections({ projectId: 'p' })
    } catch (e) {
      caught = e as TodoistApiError
    }

    expect(caught?.name).toBe('TodoistApiError')
  })

  it('should throw TodoistApiError for moveTask on non-2xx', async () => {
    const fetchFn = stubFetch(makeErrorResponse(400, 'Bad Request'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await expect(client.moveTask({ taskId: 't1', sectionId: 's1' })).rejects.toThrow(TodoistApiError)
  })

  it('should throw TodoistApiError for postComment on non-2xx', async () => {
    const fetchFn = stubFetch(makeErrorResponse(422, 'Unprocessable Entity'))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await expect(client.postComment({ taskId: 't1', content: 'x' })).rejects.toThrow(TodoistApiError)
  })
})

// ─── URL composition ──────────────────────────────────────────────────────────

describe('TodoistClient URL composition', () => {
  it('should not produce double slashes when baseUrl has no trailing slash', async () => {
    const fetchFn = stubFetch(makeOkResponse([]))
    const client = new TodoistClient('https://api.todoist.com/rest/v2', TOKEN, fetchFn)

    await client.listSections({ projectId: 'p' })

    const [url] = getCallArgs(fetchFn)
    // Only path-level double slashes matter; the HTTPS scheme double-slash is acceptable
    expect(url.replace('https://', '')).not.toContain('//')
  })

  it('should construct moveTask URL with taskId embedded in path', async () => {
    const fetchFn = stubFetch(makeOkResponse({}))
    const client = new TodoistClient(BASE_URL, TOKEN, fetchFn)

    await client.moveTask({ taskId: 'abc-123', sectionId: 'sec-x' })

    const [url] = getCallArgs(fetchFn)
    expect(url).toBe(`${BASE_URL}/tasks/abc-123/move`)
  })
})
