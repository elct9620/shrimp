import { http, HttpResponse } from 'msw'

const BASE = 'https://api.todoist.com/rest/v2'

export const todoistHandlers = [
  // GET /sections?project_id=*
  http.get(`${BASE}/sections`, () => {
    return HttpResponse.json([])
  }),

  // GET /tasks?*
  http.get(`${BASE}/tasks`, () => {
    return HttpResponse.json([])
  }),

  // GET /comments?*
  http.get(`${BASE}/comments`, () => {
    return HttpResponse.json([])
  }),

  // POST /comments
  http.post(`${BASE}/comments`, () => {
    return HttpResponse.json({ id: 'comment-1' }, { status: 200 })
  }),

  // POST /tasks/:taskId/move
  http.post(`${BASE}/tasks/:taskId/move`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
