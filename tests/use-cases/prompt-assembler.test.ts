import { describe, expect, it } from "vitest";
import {
  assembleHeartbeatPrompts,
  assembleChannelSystemPrompt,
  assembleSummarizeSystemPrompt,
} from "../../src/use-cases/prompt-assembler";
import type { SkillCatalogEntry } from "../../src/use-cases/ports/skill-catalog";
import { Task } from "../../src/entities/task";
import { Comment } from "../../src/entities/comment";
import { Section } from "../../src/entities/section";
import { Priority } from "../../src/entities/priority";

const makeSkillEntry = (
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry => ({
  name: "example-skill",
  description: "Does something useful",
  skillFilePath: "/skills/example-skill/SKILL.md",
  ...overrides,
});

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

describe("assembleHeartbeatPrompts", () => {
  describe("system prompt", () => {
    it("opens with goal-oriented language, not role-based framing", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).not.toMatch(/^You are/);
      expect(systemPrompt).not.toMatch(/\nYou are /);
    });

    it("includes shared base operating principles (rigor, no guessing)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).toContain("## Operating Principles");
      expect(systemPrompt.toLowerCase()).toContain("guess");
    });

    it("includes heartbeat objective (goal framing for task execution)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).toContain("## Objective");
    });

    it("does not contain Todoist-specific Domain Knowledge section (moved to todoist skill)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).not.toContain("## Domain Knowledge");
      expect(systemPrompt).not.toContain("Backlog");
      expect(systemPrompt).not.toContain("In Progress");
    });

    it("does not contain Todoist-specific Workflow or Error Handling sections (moved to todoist skill)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).not.toContain("## Workflow");
      expect(systemPrompt).not.toContain("## Error Handling");
    });

    it("does not contain a Tools section (tool definitions are provided via AI SDK tools parameter per SPEC L733)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).not.toContain("## Tools");
    });

    it("orders sections from stable to dynamic: base → variant → Skills → User Agents Appendix", () => {
      const skills = [makeSkillEntry()];
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        skills,
        userAgents: "Operator note",
      });

      const principlesIdx = systemPrompt.indexOf("## Operating Principles");
      const objectiveIdx = systemPrompt.indexOf("## Objective");
      const skillsIdx = systemPrompt.indexOf("## Skills");
      const operatorIdx = systemPrompt.indexOf("Operator note");

      expect(principlesIdx).toBeGreaterThan(-1);
      expect(objectiveIdx).toBeGreaterThan(principlesIdx);
      expect(skillsIdx).toBeGreaterThan(objectiveIdx);
      expect(operatorIdx).toBeGreaterThan(skillsIdx);
    });

    it("appends userAgents content to the system prompt when provided", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents: "Operator override: prefer XYZ",
      });

      expect(systemPrompt).toContain("Operator override: prefer XYZ");
    });

    it("omits userAgents section when null or empty", () => {
      const base = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      }).systemPrompt;

      const withNull = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents: null,
      }).systemPrompt;

      const withEmpty = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents: "   ",
      }).systemPrompt;

      expect(withNull).toBe(base);
      expect(withEmpty).toBe(base);
    });

    it("produces the same output for the same input (pure function)", () => {
      const input = {
        task: makeTask(),
        comments: [],
      };

      expect(assembleHeartbeatPrompts(input)).toEqual(
        assembleHeartbeatPrompts(input),
      );
    });

    describe("Skill Catalog section", () => {
      it("emits the Skills section header even when the catalog is empty", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [],
        });

        expect(systemPrompt).toContain("## Skills");
      });

      it("renders each skill entry with name, description, and absolute path", () => {
        const skills = [
          makeSkillEntry({
            name: "deploy",
            description: "Handles deployment workflows",
            skillFilePath: "/skills/deploy/SKILL.md",
          }),
        ];

        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills,
        });

        expect(systemPrompt).toContain("deploy");
        expect(systemPrompt).toContain("Handles deployment workflows");
        expect(systemPrompt).toContain("/skills/deploy/SKILL.md");
      });

      it("preserves skill entry input order", () => {
        const skills = [
          makeSkillEntry({
            name: "alpha",
            description: "First skill",
            skillFilePath: "/skills/alpha/SKILL.md",
          }),
          makeSkillEntry({
            name: "beta",
            description: "Second skill",
            skillFilePath: "/skills/beta/SKILL.md",
          }),
          makeSkillEntry({
            name: "gamma",
            description: "Third skill",
            skillFilePath: "/skills/gamma/SKILL.md",
          }),
        ];

        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills,
        });

        const alphaIdx = systemPrompt.indexOf("alpha");
        const betaIdx = systemPrompt.indexOf("beta");
        const gammaIdx = systemPrompt.indexOf("gamma");

        expect(alphaIdx).toBeLessThan(betaIdx);
        expect(betaIdx).toBeLessThan(gammaIdx);
      });

      it("places the Skills section after base/variant and before User Agents Appendix", () => {
        const skills = [makeSkillEntry()];

        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills,
          userAgents: "Operator note",
        });

        const objectiveIdx = systemPrompt.indexOf("## Objective");
        const skillsIdx = systemPrompt.indexOf("## Skills");
        const operatorIdx = systemPrompt.indexOf("Operator note");

        expect(skillsIdx).toBeGreaterThan(objectiveIdx);
        expect(operatorIdx).toBeGreaterThan(skillsIdx);
      });

      it("omits Skills section when skills param is not provided (no-op for summarize variant)", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
        });

        expect(systemPrompt).not.toContain("## Skills");
      });
    });
  });

  describe("user prompt", () => {
    it("contains the task id", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ id: "task-abc-123" }),
        comments: [],
      });

      expect(userPrompt).toContain("task-abc-123");
    });

    it("contains the task title", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ title: "Deploy to production" }),
        comments: [],
      });

      expect(userPrompt).toContain("Deploy to production");
    });

    it("contains the task description when present", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ description: "Steps: 1, 2, 3" }),
        comments: [],
      });

      expect(userPrompt).toContain("Steps: 1, 2, 3");
    });

    it("contains the SPEC-facing section label for InProgress", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.InProgress }),
        comments: [],
      });

      expect(userPrompt).toContain("In Progress");
    });

    it("contains the SPEC-facing section label for Backlog", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.Backlog }),
        comments: [],
      });

      expect(userPrompt).toContain("Backlog");
    });

    it("contains the SPEC-facing section label for Done", () => {
      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask({ section: Section.Done }),
        comments: [],
      });

      expect(userPrompt).toContain("Done");
    });

    it("contains comment text from history", () => {
      const comments = [makeComment("First execution: created files")];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
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
      });

      expect(userPrompt).toContain("[Bot] Progress update");
    });

    it("labels user-authored comments with [User]", () => {
      const comments = [makeComment("Please check this", "user")];

      const { userPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments,
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
        }),
      ).not.toThrow();
    });

    it("does not include description section when description is absent", () => {
      const task = makeTask({ description: undefined });

      const { userPrompt } = assembleHeartbeatPrompts({
        task,
        comments: [],
      });

      expect(userPrompt).toContain(task.title);
      expect(userPrompt).not.toContain("undefined");
      expect(userPrompt).not.toContain("null");
    });
  });
});

describe("assembleChannelSystemPrompt", () => {
  it("opens with goal-oriented language, not role-based framing", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toMatch(/^You are/);
    expect(systemPrompt).not.toMatch(/\nYou are /);
  });

  it("includes the shared base operating principles", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).toContain("## Operating Principles");
    expect(systemPrompt.toLowerCase()).toContain("guess");
  });

  it("includes channel-specific conversation guidance (no reply tool, concise)", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).toContain("## Conversation Style");
    expect(systemPrompt).toContain("`reply`");
    expect(systemPrompt.toLowerCase()).toContain("concise");
  });

  it("does not include the heartbeat-only board workflow sections", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toContain("## Workflow");
    expect(systemPrompt).not.toContain("## Domain Knowledge");
  });

  it("does not contain a Tools section (tool definitions are provided via AI SDK tools parameter per SPEC L733)", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toContain("## Tools");
  });

  it("orders sections from stable to dynamic: base → variant → Skills → User Agents Appendix", () => {
    const skills = [makeSkillEntry()];
    const systemPrompt = assembleChannelSystemPrompt({
      skills,
      userAgents: "Operator note",
    });

    const principlesIdx = systemPrompt.indexOf("## Operating Principles");
    const styleIdx = systemPrompt.indexOf("## Conversation Style");
    const skillsIdx = systemPrompt.indexOf("## Skills");
    const operatorIdx = systemPrompt.indexOf("Operator note");

    expect(principlesIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(principlesIdx);
    expect(skillsIdx).toBeGreaterThan(styleIdx);
    expect(operatorIdx).toBeGreaterThan(skillsIdx);
  });

  it("appends userAgents content when provided", () => {
    const systemPrompt = assembleChannelSystemPrompt({
      userAgents: "Channel-wide operator note",
    });

    expect(systemPrompt).toContain("Channel-wide operator note");
  });

  it("emits the Skills section header even when the catalog is empty", () => {
    const systemPrompt = assembleChannelSystemPrompt({
      skills: [],
    });

    expect(systemPrompt).toContain("## Skills");
  });

  it("renders skill entries in the channel system prompt", () => {
    const skills = [
      makeSkillEntry({
        name: "triage",
        description: "Triage incoming messages",
        skillFilePath: "/skills/triage/SKILL.md",
      }),
    ];

    const systemPrompt = assembleChannelSystemPrompt({ skills });

    expect(systemPrompt).toContain("triage");
    expect(systemPrompt).toContain("Triage incoming messages");
    expect(systemPrompt).toContain("/skills/triage/SKILL.md");
  });

  it("places Skills section after variant and before User Agents Appendix in channel prompt", () => {
    const skills = [makeSkillEntry()];

    const systemPrompt = assembleChannelSystemPrompt({
      skills,
      userAgents: "Operator channel note",
    });

    const styleIdx = systemPrompt.indexOf("## Conversation Style");
    const skillsIdx = systemPrompt.indexOf("## Skills");
    const operatorIdx = systemPrompt.indexOf("Operator channel note");

    expect(skillsIdx).toBeGreaterThan(styleIdx);
    expect(operatorIdx).toBeGreaterThan(skillsIdx);
  });

  it("shares the same base section as the heartbeat variant", () => {
    const heartbeat = assembleHeartbeatPrompts({
      task: makeTask(),
      comments: [],
    }).systemPrompt;
    const channel = assembleChannelSystemPrompt({});

    // Both should start with the same base content up to the first variant heading.
    const heartbeatBase = heartbeat.slice(0, heartbeat.indexOf("## Objective"));
    const channelBase = channel.slice(0, channel.indexOf("## Objective"));

    expect(heartbeatBase).toBe(channelBase);
    expect(heartbeatBase).toContain("## Operating Principles");
  });
});

describe("assembleSummarizeSystemPrompt", () => {
  it("includes the shared base operating principles", () => {
    const systemPrompt = assembleSummarizeSystemPrompt();

    expect(systemPrompt).toContain("## Operating Principles");
  });

  it("includes the summarize objective and preservation guidance", () => {
    const systemPrompt = assembleSummarizeSystemPrompt();

    expect(systemPrompt).toContain("## Objective");
    expect(systemPrompt).toContain("## What to Preserve");
    expect(systemPrompt).toContain("## Output Format");
  });

  it("does not include a Tools section (summarize has no tool loop)", () => {
    const systemPrompt = assembleSummarizeSystemPrompt();

    expect(systemPrompt).not.toContain("## Tools");
  });

  it("orders sections from stable to dynamic: base → variant", () => {
    const systemPrompt = assembleSummarizeSystemPrompt();

    const principlesIdx = systemPrompt.indexOf("## Operating Principles");
    const objectiveIdx = systemPrompt.indexOf("## Objective");

    expect(principlesIdx).toBeGreaterThan(-1);
    expect(objectiveIdx).toBeGreaterThan(principlesIdx);
  });

  it("shares the same base section as the channel variant", () => {
    const summarize = assembleSummarizeSystemPrompt();
    const channel = assembleChannelSystemPrompt({});

    const summarizeBase = summarize.slice(0, summarize.indexOf("## Objective"));
    const channelBase = channel.slice(0, channel.indexOf("## Objective"));

    expect(summarizeBase).toBe(channelBase);
  });

  it("is a pure function (same output for repeated calls)", () => {
    expect(assembleSummarizeSystemPrompt()).toBe(
      assembleSummarizeSystemPrompt(),
    );
  });
});
