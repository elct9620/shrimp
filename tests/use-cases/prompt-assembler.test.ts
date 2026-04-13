import { describe, expect, it } from "vitest";
import { assemble } from "../../src/use-cases/prompt-assembler";
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

describe("assemble", () => {
  describe("system prompt", () => {
    it("opens with objective language, not role-based framing", () => {
      const { systemPrompt } = assemble({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).not.toMatch(/^You are/);
      expect(systemPrompt.toLowerCase()).toContain("complete");
    });

    it("includes workflow section with progress reporting step", () => {
      const { systemPrompt } = assemble({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Workflow");
      expect(systemPrompt.toLowerCase()).toContain("progress comment");
    });

    it("includes domain knowledge about board sections", () => {
      const { systemPrompt } = assemble({
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
      const { systemPrompt } = assemble({
        task: makeTask(),
        comments: [],
        tools: [],
      });

      expect(systemPrompt).toContain("## Error Handling");
    });

    it("lists each tool name in the system prompt", () => {
      const tools = makeTools(
        ["get_tasks", "Retrieve tasks from the board"],
        ["post_comment", "Post a comment on a task"],
      );

      const { systemPrompt } = assemble({
        task: makeTask(),
        comments: [],
        tools,
      });

      expect(systemPrompt).toContain("get_tasks");
      expect(systemPrompt).toContain("post_comment");
    });

    it("lists each tool description in the system prompt", () => {
      const tools = makeTools(
        ["get_tasks", "Retrieve tasks from the board"],
        ["post_comment", "Post a comment on a task"],
      );

      const { systemPrompt } = assemble({
        task: makeTask(),
        comments: [],
        tools,
      });

      expect(systemPrompt).toContain("Retrieve tasks from the board");
      expect(systemPrompt).toContain("Post a comment on a task");
    });

    it("preserves tool description input order in the system prompt", () => {
      const tools = makeTools(
        ["alpha_tool", "Alpha description"],
        ["beta_tool", "Beta description"],
      );

      const { systemPrompt } = assemble({
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

      expect(assemble(input)).toEqual(assemble(input));
    });
  });

  describe("user prompt", () => {
    it("contains the task id", () => {
      const { userPrompt } = assemble({
        task: makeTask({ id: "task-abc-123" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("task-abc-123");
    });

    it("contains the task title", () => {
      const { userPrompt } = assemble({
        task: makeTask({ title: "Deploy to production" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Deploy to production");
    });

    it("contains the task description when present", () => {
      const { userPrompt } = assemble({
        task: makeTask({ description: "Steps: 1, 2, 3" }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Steps: 1, 2, 3");
    });

    it("contains the SPEC-facing section label for InProgress", () => {
      const { userPrompt } = assemble({
        task: makeTask({ section: Section.InProgress }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("In Progress");
    });

    it("contains the SPEC-facing section label for Backlog", () => {
      const { userPrompt } = assemble({
        task: makeTask({ section: Section.Backlog }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Backlog");
    });

    it("contains the SPEC-facing section label for Done", () => {
      const { userPrompt } = assemble({
        task: makeTask({ section: Section.Done }),
        comments: [],
        tools: [],
      });

      expect(userPrompt).toContain("Done");
    });

    it("contains comment text from history", () => {
      const comments = [makeComment("First execution: created files")];

      const { userPrompt } = assemble({
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

      const { userPrompt } = assemble({
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

      const { userPrompt } = assemble({
        task: makeTask(),
        comments,
        tools: [],
      });

      expect(userPrompt).toContain("[Bot] Progress update");
    });

    it("labels user-authored comments with [User]", () => {
      const comments = [makeComment("Please check this", "user")];

      const { userPrompt } = assemble({
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

      const { userPrompt } = assemble({
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
        assemble({ task: makeTask(), comments: [], tools: [] }),
      ).not.toThrow();
    });

    it("does not include description section when description is absent", () => {
      const task = makeTask({ description: undefined });

      const { userPrompt } = assemble({ task, comments: [], tools: [] });

      // Should still contain the title but no undefined/null artefacts
      expect(userPrompt).toContain(task.title);
      expect(userPrompt).not.toContain("undefined");
      expect(userPrompt).not.toContain("null");
    });
  });
});
