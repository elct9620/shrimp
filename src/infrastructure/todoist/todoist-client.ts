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

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

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
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  async listTasks(params: { projectId: string; sectionId: string }): Promise<TodoistTask[]> {
    const url = `${this.baseUrl}/tasks?project_id=${params.projectId}&section_id=${params.sectionId}`
    return this.get<TodoistTask[]>(url)
  }

  async listComments(params: { taskId: string }): Promise<TodoistComment[]> {
    const url = `${this.baseUrl}/comments?task_id=${params.taskId}`
    return this.get<TodoistComment[]>(url)
  }

  async postComment(params: { taskId: string; content: string }): Promise<void> {
    const url = `${this.baseUrl}/comments`
    await this.post(url, { task_id: params.taskId, content: params.content })
  }

  async moveTask(params: { taskId: string; sectionId: string }): Promise<void> {
    const url = `${this.baseUrl}/tasks/${params.taskId}/move`
    await this.post(url, { section_id: params.sectionId })
  }

  async listSections(params: { projectId: string }): Promise<TodoistSection[]> {
    const url = `${this.baseUrl}/sections?project_id=${params.projectId}`
    return this.get<TodoistSection[]>(url)
  }

  private async get<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json',
      },
    })
    await this.assertOk(response, url)
    return response.json() as Promise<T>
  }

  private async post(url: string, body: unknown): Promise<void> {
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    })
    await this.assertOk(response, url)
  }

  private async assertOk(response: Response, url: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text()
      throw new TodoistApiError(response.status, url, body)
    }
  }
}
