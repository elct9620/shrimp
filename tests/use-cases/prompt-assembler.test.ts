import { describe, expect, it } from "vitest";
import {
  assembleHeartbeatPrompts,
  assembleChannelSystemPrompt,
} from "../../src/use-cases/prompt-assembler";
import type { ToolDescription } from "../../src/use-cases/ports/tool-description";
import { Task } from "../../src/entities/task";
import { Comment } from "../../src/entities/comment";
import { Section } from "../../src/entities/section";
import { Priority } from "../../src/entities/priority";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  title: "Fix the bug",
  description: "Detailed description here",
  priority: Priority.p2,
  section: Section.InProgress,
  ...overrides,
});

const makeComment = (
  text: string,
  author: "bot" | "user" = "user",
  timestamp: Date = new Date("2024-01-01T00:00:00Z"),
): Comment => ({
  text,
  timestamp,
  author,
});

const makeTools = (...pairs: [string, string][]): ToolDescription[] =>
  pairs.map(([name, description]) => ({ name, description }));

describe("assembleHeartbeatPrompts", () => {
  describe("system prompt", () => {
    it("opens with goal-oriented language, not role-based framing", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).not.toMatch(/^You are/);
      expect(systemPrompt).not.toMatch(/\nYou are /);
    });

    it("includes shared base operating principles (rigor, no guessing)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Operating Principles");
      expect(systemPrompt.toLowerCase()).toContain("guess");
    });

    it("includes heartbeat workflow with progress reporting step", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Workflow");
      expect(systemPrompt.toLowerCase()).toContain("progress comment");
    });

    it("includes domain knowledge about board sections", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Domain Knowledge");
      expect(systemPrompt).toContain("Backlog");
      expect(systemPrompt).toContain("In Progress");
      expect(systemPrompt).toContain("Done");
    });

    it("includes error handling guidance", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Error Handling");
    });

    it("orders sections from stable to dynamic: base → variant → tools", () => {
      const tools = makeTools(["get_tasks", "Retrieve tasks"]);
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools,
      });

      const principlesIdx = systemPrompt.indexOf("## Operating Principles");
      const workflowIdx = systemPrompt.indexOf("## Workflow");
      const toolsIdx = systemPrompt.indexOf("## Tools");

      expect(principlesIdx).toBeGreaterThan(-1);
      expect(workflowIdx).toBeGreaterThan(principlesIdx);
      expect(toolsIdx).toBeGreaterThan(workflowIdx);
    });

    it("lists each tool name and description in the system prompt", () => {
      const tools = makeTools(
        ["get_tasks", "Retrieve tasks from the board"],
        ["post_comment", "Post a comment on a task"],
      );

      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools,
      });

      expect(systemPrompt).toContain("get_tasks");
      expect(systemPrompt).toContain("Retrieve tasks from the board");
      expect(systemPrompt).toContain("post_comment");
      expect(systemPrompt).toContain("Post a comment on a task");
    });

    it("preserves tool description input order", () => {
      const tools = makeTools(
        ["alpha_tool", "Alpha description"],
        ["beta_tool", "Beta description"],
      );

      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        tools,
      });

      expect(systemPrompt.indexOf("alpha_tool")).toBeLessThan(
        systemPrompt.indexOf("beta_tool"),
      );
    });

    it("produces the same output for the same input (pure function)", () => {
      const input = {
        task: makeTask(),
        comments: [],
        tools: makeTools(["t", "d"]),
      };

      expect(assembleHeartbeatPrompts(input)).toEqual(
        assembleHeartbeatPrompts(input),
      );
    });
  });

  describe("user prompt", () => {
    it("contains the task id", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ id: "task-abc-123" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("task-abc-123");
    });

    it("contains the task title", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ title: "Deploy to production" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Deploy to production");
    });

    it("contains the task description when present", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ description: "Steps: 1, 2, 3" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Steps: 1, 2, 3");
    });

    it("contains the SPEC-facing section label for InProgress", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.InProgress }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("In Progress");
    });

    it("contains the SPEC-facing section label for Backlog", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.Backlog }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Backlog");
    });

    it("contains the SPEC-facing section label for Done", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.Done }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Done");
    });

    it("contains comment text from history", () => {
      const comments = [makeComment("First execution: created files")];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
        tools: [],
      });

      expect(userPrompt).toContain("First execution: created files");
    });

    it("lists comments in input order", () => {
      const comments = [
        makeComment("First comment"),
        makeComment("Second comment"),
        makeComment("Third comment"),
      ];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
        tools: [],
      });

      const firstIdx = userPrompt.indexOf("First comment");
      const secondIdx = userPrompt.indexOf("Second comment");
      const thirdIdx = userPrompt.indexOf("Third comment");

      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it("labels bot-authored comments with [Bot]", () => {
      const comments = [makeComment("Progress update", "bot")];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
        tools: [],
      });

      expect(userPrompt).toContain("[Bot] Progress update");
    });

    it("labels user-authored comments with [User]", () => {
      const comments = [makeComment("Please check this", "user")];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
        tools: [],
      });

      expect(userPrompt).toContain("[User] Please check this");
    });

    it("labels mixed bot and user comments in order", () => {
      const comments = [
        makeComment("User question", "user"),
        makeComment("Bot response", "bot"),
        makeComment("Follow-up", "user"),
      ];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
        tools: [],
      });

      const userIdx = userPrompt.indexOf("[User] User question");
      const botIdx = userPrompt.indexOf("[Bot] Bot response");
      const followIdx = userPrompt.indexOf("[User] Follow-up");

      expect(userIdx).toBeGreaterThan(-1);
      expect(botIdx).toBeGreaterThan(userIdx);
      expect(followIdx).toBeGreaterThan(botIdx);
    });

    it("handles empty comment history without error", () => {
      expect(() =>
        assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          tools: [],
        }),
      ).not.toThrow();
    });

    it("does not include description section when description is absent", () => {
      const task = makeTask({ description: undefined });

      const { userPrompt } = assembleHeartbeatPrompts({
        task,
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain(task.title);
      expect(userPrompt).not.toContain("undefined");
      expect(userPrompt).not.toContain("null");
    });
  });
});

describe("assembleChannelSystemPrompt", () => {
  it("opens with goal-oriented language, not role-based framing", () => {
    const systemPrompt = assembleChannelSystemPrompt({ tools: [] });

    expect(systemPrompt).not.toMatch(/^You are/);
    expect(systemPrompt).not.toMatch(/\nYou are /);
  });

  it("includes the shared base operating principles", () => {
    const systemPrompt = assembleChannelSystemPrompt({ tools: [] });

    expect(systemPrompt).toContain("## Operating Principles");
    expect(systemPrompt.toLowerCase()).toContain("guess");
  });

  it("includes channel-specific conversation guidance (no reply tool, concise)", () => {
    const systemPrompt = assembleChannelSystemPrompt({ tools: [] });

    expect(systemPrompt).toContain("## Conversation Style");
    expect(systemPrompt).toContain("`reply`");
    expect(systemPrompt.toLowerCase()).toContain("concise");
  });

  it("does not include the heartbeat-only board workflow sections", () => {
    const systemPrompt = assembleChannelSystemPrompt({ tools: [] });

    expect(systemPrompt).not.toContain("## Workflow");
    expect(systemPrompt).not.toContain("## Domain Knowledge");
  });

  it("lists each tool name and description", () => {
    const tools = makeTools(
      ["search_web", "Search the web for info"],
      ["create_task", "Create a Todoist task"],
    );

    const systemPrompt = assembleChannelSystemPrompt({ tools });

    expect(systemPrompt).toContain("search_web");
    expect(systemPrompt).toContain("Search the web for info");
    expect(systemPrompt).toContain("create_task");
    expect(systemPrompt).toContain("Create a Todoist task");
  });

  it("orders sections from stable to dynamic: base → variant → tools", () => {
    const tools = makeTools(["search_web", "Search the web"]);
    const systemPrompt = assembleChannelSystemPrompt({ tools });

    const principlesIdx = systemPrompt.indexOf("## Operating Principles");
    const styleIdx = systemPrompt.indexOf("## Conversation Style");
    const toolsIdx = systemPrompt.indexOf("## Tools");

    expect(principlesIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(principlesIdx);
    expect(toolsIdx).toBeGreaterThan(styleIdx);
  });

  it("shares the same base section as the heartbeat variant", () => {
    const heartbeat = assembleHeartbeatPrompts({
      task: makeTask(),
      comments: [],
      tools: [],
    }).systemPrompt;
    const channel = assembleChannelSystemPrompt({ tools: [] });

    // Both should start with the same base content up to the first variant heading.
    const heartbeatBase = heartbeat.slice(0, heartbeat.indexOf("## Objective"));
    const channelBase = channel.slice(0, channel.indexOf("## Objective"));

    expect(heartbeatBase).toBe(channelBase);
    expect(heartbeatBase).toContain("## Operating Principles");
  });
});
