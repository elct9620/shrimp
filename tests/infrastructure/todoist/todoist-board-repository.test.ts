import { TodoistApi } from "@doist/todoist-sdk";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Priority } from "../../../src/entities/priority";
import { Section } from "../../../src/entities/section";
import { BoardSectionMissingError } from "../../../src/use-cases/ports/board-repository";
import { TodoistBoardRepository } from "../../../src/infrastructure/todoist/todoist-board-repository";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";
import { todoistHandlers } from "../../mocks/todoist-handlers";

const BASE = "https://api.todoist.com/api/v1";
const PROJECT_ID = "proj-1";

const server = setupServer(...todoistHandlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeFakeLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

// ─── Helpers: full snake_case HTTP payloads (SDK converts to camelCase, then validates) ─

function makeSection(id: string, name: string, order: number) {
  return {
    id,
    user_id: "user-1",
    project_id: PROJECT_ID,
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    archived_at: null,
    name,
    section_order: order,
    is_archived: false,
    is_deleted: false,
    is_collapsed: false,
  };
}

function makeTask(overrides: {
  id: string;
  content: string;
  description: string;
  section_id: string;
  priority: number;
}) {
  return {
    id: overrides.id,
    user_id: "user-1",
    project_id: PROJECT_ID,
    section_id: overrides.section_id,
    parent_id: null,
    added_by_uid: "user-1",
    assigned_by_uid: null,
    responsible_uid: null,
    labels: [],
    deadline: null,
    duration: null,
    checked: false,
    is_deleted: false,
    added_at: "2024-01-01T00:00:00Z",
    completed_at: null,
    updated_at: "2024-01-01T00:00:00Z",
    due: null,
    priority: overrides.priority,
    child_order: 1,
    content: overrides.content,
    description: overrides.description,
    day_order: 1,
    is_collapsed: false,
  };
}

function makeComment(
  id: string,
  taskId: string,
  content: string,
  postedAt: string,
) {
  return {
    id,
    item_id: taskId,
    posted_uid: "user-1",
    content,
    posted_at: postedAt,
    file_attachment: null,
    uids_to_notify: null,
    is_deleted: false,
    reactions: null,
  };
}

/**
 * Returns a full comment HTTP response (snake_case) for POST /comments.
 * The SDK validates the response with Zod after camelCaseKeys.
 */
function makeCommentHttpResponse(
  id: string,
  taskId: string,
  content: string,
  postedAt: string,
) {
  return makeComment(id, taskId, content, postedAt);
}

// ─── Shared section data ───────────────────────────────────────────────────────

const ALL_SECTIONS_HTTP = [
  makeSection("sec-backlog", "Backlog", 1),
  makeSection("sec-inprogress", "In Progress", 2),
  makeSection("sec-done", "Done", 3),
];

function withAllSections() {
  server.use(
    http.get(`${BASE}/sections`, () =>
      HttpResponse.json({ results: ALL_SECTIONS_HTTP, next_cursor: null }),
    ),
  );
}

// ─── validateSections ────────────────────────────────────────────────────────

describe("TodoistBoardRepository.validateSections", () => {
  it("should resolve when all three required sections exist", async () => {
    withAllSections();
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.validateSections()).resolves.toBeUndefined();
  });

  it("should throw BoardSectionMissingError when Backlog is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Backlog"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.validateSections()).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should throw BoardSectionMissingError when Done is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Done"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.validateSections()).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should throw BoardSectionMissingError when In Progress is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "In Progress"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.validateSections()).rejects.toThrow(
      BoardSectionMissingError,
    );
  });
});

// ─── getTasks ─────────────────────────────────────────────────────────────────

describe("TodoistBoardRepository.getTasks", () => {
  it("should return mapped tasks with correct field mapping when section present", async () => {
    withAllSections();
    server.use(
      http.get(`${BASE}/tasks`, () =>
        HttpResponse.json({
          results: [
            makeTask({
              id: "task-1",
              content: "Fix the bug",
              description: "Some details",
              section_id: "sec-inprogress",
              priority: 2,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const tasks = await repo.getTasks(Section.InProgress);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({
      id: "task-1",
      title: "Fix the bug",
      description: "Some details",
      priority: Priority.p3, // Todoist 2 → domain p3 (5-2=3)
      section: Section.InProgress,
    });
  });

  it("should map Todoist priority 4 to domain p1 (highest)", async () => {
    withAllSections();
    server.use(
      http.get(`${BASE}/tasks`, () =>
        HttpResponse.json({
          results: [
            makeTask({
              id: "task-p1",
              content: "Urgent task",
              description: "",
              section_id: "sec-inprogress",
              priority: 4,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const tasks = await repo.getTasks(Section.InProgress);

    expect(tasks[0].priority).toBe(Priority.p1);
  });

  it("should map Todoist priority 1 to domain p4 (lowest)", async () => {
    withAllSections();
    server.use(
      http.get(`${BASE}/tasks`, () =>
        HttpResponse.json({
          results: [
            makeTask({
              id: "task-p4",
              content: "Low priority task",
              description: "",
              section_id: "sec-inprogress",
              priority: 1,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const tasks = await repo.getTasks(Section.InProgress);

    expect(tasks[0].priority).toBe(Priority.p4);
  });

  it("should map Todoist task with empty description to undefined", async () => {
    withAllSections();
    server.use(
      http.get(`${BASE}/tasks`, () =>
        HttpResponse.json({
          results: [
            makeTask({
              id: "task-nodesc",
              content: "No description task",
              description: "",
              section_id: "sec-backlog",
              priority: 3,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const tasks = await repo.getTasks(Section.Backlog);

    expect(tasks[0].description).toBeUndefined();
  });

  it("should return empty array when no tasks in section", async () => {
    withAllSections();
    // default handler already returns { results: [], next_cursor: null }
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const tasks = await repo.getTasks(Section.InProgress);

    expect(tasks).toEqual([]);
  });

  it("should call sections endpoint with correct projectId query param", async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BASE}/sections`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({
          results: ALL_SECTIONS_HTTP,
          next_cursor: null,
        });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.getTasks(Section.Backlog);

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get("project_id")).toBe(PROJECT_ID);
  });

  it("should call tasks endpoint with resolved sectionId for Backlog", async () => {
    withAllSections();
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BASE}/tasks`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ results: [], next_cursor: null });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.getTasks(Section.Backlog);

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get("section_id")).toBe("sec-backlog");
    expect(capturedUrl!.searchParams.get("project_id")).toBe(PROJECT_ID);
  });

  it("should call tasks endpoint with resolved sectionId for In Progress using exact name match", async () => {
    withAllSections();
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BASE}/tasks`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ results: [], next_cursor: null });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.getTasks(Section.InProgress);

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get("section_id")).toBe("sec-inprogress");
  });

  it("should throw BoardSectionMissingError when Backlog section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Backlog"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.getTasks(Section.Backlog)).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should throw BoardSectionMissingError when In Progress section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "In Progress"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.getTasks(Section.InProgress)).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should throw BoardSectionMissingError when Done section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Done"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.getTasks(Section.Done)).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should not match section by case-insensitive name — exact match only", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: [
            makeSection("sec-backlog", "backlog", 1),
            makeSection("sec-inprogress", "in progress", 2),
            makeSection("sec-done", "done", 3),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.getTasks(Section.InProgress)).rejects.toThrow(
      BoardSectionMissingError,
    );
  });
});

// ─── getComments ──────────────────────────────────────────────────────────────

describe("TodoistBoardRepository.getComments", () => {
  it("should return user-authored comment without tag prefix", async () => {
    server.use(
      http.get(`${BASE}/comments`, () =>
        HttpResponse.json({
          results: [
            makeComment(
              "c1",
              "task-1",
              "This is a comment",
              "2024-03-15T10:30:00Z",
            ),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const comments = await repo.getComments("task-1");

    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("This is a comment");
    expect(comments[0].author).toBe("user");
    expect(comments[0].timestamp).toBeInstanceOf(Date);
    expect(comments[0].timestamp.toISOString()).toBe(
      "2024-03-15T10:30:00.000Z",
    );
  });

  it("should return bot-authored comment with tag stripped from text", async () => {
    server.use(
      http.get(`${BASE}/comments`, () =>
        HttpResponse.json({
          results: [
            makeComment(
              "c2",
              "task-1",
              "[Shrimp] Progress update",
              "2024-03-15T11:00:00Z",
            ),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const comments = await repo.getComments("task-1");

    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("Progress update");
    expect(comments[0].author).toBe("bot");
  });

  it("should call comments endpoint with the given taskId", async () => {
    let capturedUrl: URL | null = null;
    server.use(
      http.get(`${BASE}/comments`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ results: [], next_cursor: null });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.getComments("task-42");

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl!.searchParams.get("task_id")).toBe("task-42");
  });

  it("should return empty array when no comments exist", async () => {
    // default handler already returns { results: [], next_cursor: null }
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const comments = await repo.getComments("task-1");

    expect(comments).toEqual([]);
  });
});

// ─── postComment ──────────────────────────────────────────────────────────────

describe("TodoistBoardRepository.postComment", () => {
  it("should POST to comments endpoint with correct taskId and content", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/comments`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeComment("c-new", "task-1", "Hello world", "2024-01-01T00:00:00Z"),
        );
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.postComment("task-1", "Hello world");

    expect(capturedBody).toMatchObject({
      task_id: "task-1",
      content: "Hello world",
    });
  });

  it("should return void on success", async () => {
    server.use(
      http.post(`${BASE}/comments`, () =>
        HttpResponse.json(
          makeCommentHttpResponse(
            "c-done",
            "task-1",
            "Done",
            "2024-01-01T00:00:00Z",
          ),
        ),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const result = await repo.postComment("task-1", "Done");

    expect(result).toBeUndefined();
  });

  it("should log info with taskId after a successful postComment", async () => {
    server.use(
      http.post(`${BASE}/comments`, () =>
        HttpResponse.json(
          makeCommentHttpResponse(
            "c-log",
            "task-42",
            "Progress",
            "2024-01-01T00:00:00Z",
          ),
        ),
      ),
    );
    const api = new TodoistApi("test-token");
    const logger = makeFakeLogger();
    const repo = new TodoistBoardRepository(api, PROJECT_ID, logger);

    await repo.postComment("task-42", "Progress");

    expect(logger.info).toHaveBeenCalledWith(
      "comment posted",
      expect.objectContaining({ taskId: "task-42" }),
    );
  });
});

// ─── moveTask ─────────────────────────────────────────────────────────────────

describe("TodoistBoardRepository.moveTask", () => {
  it("should resolve section ID and call move endpoint for Done", async () => {
    withAllSections();
    let capturedTaskId: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/tasks/:taskId/move`, async ({ params, request }) => {
        capturedTaskId = params.taskId as string;
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...makeTask({
            id: params.taskId as string,
            content: "Task",
            description: "",
            section_id: "sec-done",
            priority: 1,
          }),
        });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.moveTask("task-1", Section.Done);

    expect(capturedTaskId).toBe("task-1");
    expect(capturedBody).toMatchObject({ section_id: "sec-done" });
  });

  it("should resolve In Progress section ID correctly", async () => {
    withAllSections();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/tasks/:taskId/move`, async ({ params, request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...makeTask({
            id: params.taskId as string,
            content: "Task",
            description: "",
            section_id: "sec-inprogress",
            priority: 1,
          }),
        });
      }),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await repo.moveTask("task-2", Section.InProgress);

    expect(capturedBody).toMatchObject({ section_id: "sec-inprogress" });
  });

  it("should throw BoardSectionMissingError when destination section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Done"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    await expect(repo.moveTask("task-1", Section.Done)).rejects.toThrow(
      BoardSectionMissingError,
    );
  });

  it("should return void on success", async () => {
    withAllSections();
    const api = new TodoistApi("test-token");
    const repo = new TodoistBoardRepository(api, PROJECT_ID, makeFakeLogger());

    const result = await repo.moveTask("task-1", Section.Backlog);

    expect(result).toBeUndefined();
  });
});

// ─── Logging ──────────────────────────────────────────────────────────────────

describe("TodoistBoardRepository logging", () => {
  it("should log debug with section and count when tasks are loaded", async () => {
    withAllSections();
    server.use(
      http.get(`${BASE}/tasks`, () =>
        HttpResponse.json({
          results: [
            makeTask({
              id: "t1",
              content: "A",
              description: "",
              section_id: "sec-backlog",
              priority: 1,
            }),
            makeTask({
              id: "t2",
              content: "B",
              description: "",
              section_id: "sec-backlog",
              priority: 2,
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const logger = makeFakeLogger();
    const repo = new TodoistBoardRepository(api, PROJECT_ID, logger);

    await repo.getTasks(Section.Backlog);

    expect(logger.debug).toHaveBeenCalledWith(
      "board tasks loaded",
      expect.objectContaining({ section: Section.Backlog, count: 2 }),
    );
  });

  it("should log info with taskId and section after a successful moveTask", async () => {
    withAllSections();
    const api = new TodoistApi("test-token");
    const logger = makeFakeLogger();
    const repo = new TodoistBoardRepository(api, PROJECT_ID, logger);

    await repo.moveTask("task-42", Section.Done);

    expect(logger.info).toHaveBeenCalledWith(
      "task moved",
      expect.objectContaining({ taskId: "task-42", section: Section.Done }),
    );
  });

  it("should log error with targetName and available sections when section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Done"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const logger = makeFakeLogger();
    const repo = new TodoistBoardRepository(api, PROJECT_ID, logger);

    await expect(repo.getTasks(Section.Done)).rejects.toThrow(
      BoardSectionMissingError,
    );

    expect(logger.error).toHaveBeenCalledWith(
      "board section missing",
      expect.objectContaining({
        targetName: "Done",
        availableSections: ["Backlog", "In Progress"],
      }),
    );
  });

  it("should not log info when moveTask throws because section is missing", async () => {
    server.use(
      http.get(`${BASE}/sections`, () =>
        HttpResponse.json({
          results: ALL_SECTIONS_HTTP.filter((s) => s.name !== "Done"),
          next_cursor: null,
        }),
      ),
    );
    const api = new TodoistApi("test-token");
    const logger = makeFakeLogger();
    const repo = new TodoistBoardRepository(api, PROJECT_ID, logger);

    await expect(repo.moveTask("task-1", Section.Done)).rejects.toThrow(
      BoardSectionMissingError,
    );

    expect(logger.info).not.toHaveBeenCalled();
  });
});
