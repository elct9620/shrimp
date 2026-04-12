import { http, HttpResponse } from 'msw'

const BASE = 'https://api.todoist.com/api/v1'

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
    return HttpResponse.json({ id: 'comment-1', task_id: '', content: '', posted_at: '' }, { status: 200 })
  }),

  // POST /tasks/:taskId/move
  http.post(`${BASE}/tasks/:taskId/move`, () => {
    return HttpResponse.json({ id: '' }, { status: 200 })
  }),
]
