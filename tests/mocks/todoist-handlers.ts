import { http, HttpResponse } from 'msw'

const BASE = 'https://api.todoist.com/api/v1'

// Default snake_case HTTP responses for the Todoist API endpoints.
// The SDK converts these to camelCase and validates with Zod before returning.
const DEFAULT_TASK_ID = 'default-task'
const DEFAULT_COMMENT_ID = 'default-comment'
const DEFAULT_PROJECT_ID = 'proj-1'
const DEFAULT_DATE = '2024-01-01T00:00:00Z'

function makeDefaultTask(id = DEFAULT_TASK_ID) {
  return {
    id,
    user_id: 'user-1',
    project_id: DEFAULT_PROJECT_ID,
    section_id: null,
    parent_id: null,
    added_by_uid: 'user-1',
    assigned_by_uid: null,
    responsible_uid: null,
    labels: [],
    deadline: null,
    duration: null,
    checked: false,
    is_deleted: false,
    added_at: DEFAULT_DATE,
    completed_at: null,
    updated_at: DEFAULT_DATE,
    due: null,
    priority: 1,
    child_order: 1,
    content: 'Default Task',
    description: '',
    day_order: 1,
    is_collapsed: false,
  }
}

function makeDefaultComment(id = DEFAULT_COMMENT_ID) {
  return {
    id,
    item_id: DEFAULT_TASK_ID,
    posted_uid: 'user-1',
    content: '',
    posted_at: DEFAULT_DATE,
    file_attachment: null,
    uids_to_notify: null,
    is_deleted: false,
    reactions: null,
  }
}

export const todoistHandlers = [
  // GET /sections?project_id=*
  http.get(`${BASE}/sections`, () => {
    return HttpResponse.json({ results: [], next_cursor: null })
  }),

  // GET /tasks?*
  http.get(`${BASE}/tasks`, () => {
    return HttpResponse.json({ results: [], next_cursor: null })
  }),

  // GET /comments?*
  http.get(`${BASE}/comments`, () => {
    return HttpResponse.json({ results: [], next_cursor: null })
  }),

  // POST /comments
  http.post(`${BASE}/comments`, () => {
    return HttpResponse.json(makeDefaultComment())
  }),

  // POST /tasks/:taskId/move
  http.post(`${BASE}/tasks/:taskId/move`, ({ params }) => {
    return HttpResponse.json(makeDefaultTask(params.taskId as string))
  }),
]
