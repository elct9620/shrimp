import { describe, expect, it } from "vitest";
import { selectTask } from "../../src/entities/task-selector";
import { Task } from "../../src/entities/task";
import { Section } from "../../src/entities/section";
import { Priority } from "../../src/entities/priority";

const makeTask = (id: string, priority: Priority, section: Section): Task => ({
  id,
  title: `Task ${id}`,
  priority,
  section,
});

describe("selectTask", () => {
  describe("when both sections are empty", () => {
    it("returns null", () => {
      expect(selectTask([], [])).toBeNull();
    });
  });

  describe("when only InProgress tasks exist", () => {
    it("returns the single InProgress task", () => {
      const inProgress = [makeTask("ip-1", Priority.p2, Section.InProgress)];

      expect(selectTask(inProgress, [])).toBe(inProgress[0]);
    });

    it("selects highest priority among InProgress tasks", () => {
      const inProgress = [
        makeTask("ip-low", Priority.p3, Section.InProgress),
        makeTask("ip-high", Priority.p1, Section.InProgress),
        makeTask("ip-mid", Priority.p2, Section.InProgress),
      ];

      expect(selectTask(inProgress, [])).toBe(inProgress[1]);
    });

    it("preserves API response order when InProgress priorities are equal", () => {
      const inProgress = [
        makeTask("ip-first", Priority.p2, Section.InProgress),
        makeTask("ip-second", Priority.p2, Section.InProgress),
      ];

      expect(selectTask(inProgress, [])).toBe(inProgress[0]);
    });
  });

  describe("when only Backlog tasks exist", () => {
    it("returns the single Backlog task", () => {
      const backlog = [makeTask("bl-1", Priority.p2, Section.Backlog)];

      expect(selectTask([], backlog)).toBe(backlog[0]);
    });

    it("selects highest priority among Backlog tasks", () => {
      const backlog = [
        makeTask("bl-low", Priority.p4, Section.Backlog),
        makeTask("bl-high", Priority.p1, Section.Backlog),
        makeTask("bl-mid", Priority.p2, Section.Backlog),
      ];

      expect(selectTask([], backlog)).toBe(backlog[1]);
    });

    it("preserves API response order when Backlog priorities are equal", () => {
      const backlog = [
        makeTask("bl-first", Priority.p3, Section.Backlog),
        makeTask("bl-second", Priority.p3, Section.Backlog),
      ];

      expect(selectTask([], backlog)).toBe(backlog[0]);
    });
  });

  describe("when both sections have tasks", () => {
    it("prefers InProgress over Backlog regardless of priority", () => {
      const inProgress = [makeTask("ip-1", Priority.p4, Section.InProgress)];
      const backlog = [makeTask("bl-1", Priority.p1, Section.Backlog)];

      expect(selectTask(inProgress, backlog)).toBe(inProgress[0]);
    });

    it("selects highest-priority InProgress task when Backlog also has tasks", () => {
      const inProgress = [
        makeTask("ip-low", Priority.p3, Section.InProgress),
        makeTask("ip-high", Priority.p1, Section.InProgress),
      ];
      const backlog = [makeTask("bl-1", Priority.p1, Section.Backlog)];

      expect(selectTask(inProgress, backlog)).toBe(inProgress[1]);
    });
  });
});
