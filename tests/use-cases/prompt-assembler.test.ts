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

    it("includes ## Approach and ## Working Style sections (replaced Operating Principles)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).toContain("## Approach");
      expect(systemPrompt).toContain("## Working Style");
      expect(systemPrompt).not.toContain("## Operating Principles");
    });

    it("## Approach section contains skill-first workflow directive", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      const approachIdx = systemPrompt.indexOf("## Approach");
      const workingStyleIdx = systemPrompt.indexOf("## Working Style");
      const approachSection = systemPrompt.slice(approachIdx, workingStyleIdx);

      expect(approachSection.toLowerCase()).toContain("skill");
    });

    it("## Working Style section contains positive behavioural norms (ask when uncertain, report facts)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      const workingStyleIdx = systemPrompt.indexOf("## Working Style");
      const nextSection = systemPrompt.indexOf("\n## ", workingStyleIdx + 1);
      const workingStyleSection =
        nextSection === -1
          ? systemPrompt.slice(workingStyleIdx)
          : systemPrompt.slice(workingStyleIdx, nextSection);

      expect(workingStyleSection.toLowerCase()).toContain("guess");
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

    it("orders sections from stable to dynamic: base → variant → Skills → Tools → User Agents Appendix", () => {
      const skills = [makeSkillEntry()];
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        skills,
        userAgents: "Operator note",
      });

      const approachIdx = systemPrompt.indexOf("## Approach");
      const objectiveIdx = systemPrompt.indexOf("## Objective");
      const skillsIdx = systemPrompt.indexOf("## Skills");
      const toolsIdx = systemPrompt.indexOf("## Tools");
      const operatorIdx = systemPrompt.indexOf("Operator note");

      expect(approachIdx).toBeGreaterThan(-1);
      expect(objectiveIdx).toBeGreaterThan(approachIdx);
      expect(skillsIdx).toBeGreaterThan(objectiveIdx);
      expect(toolsIdx).toBeGreaterThan(skillsIdx);
      expect(operatorIdx).toBeGreaterThan(toolsIdx);
    });

    it("AGENTS.md (User Agents Appendix) is the final block — nothing follows it", () => {
      const skills = [makeSkillEntry()];
      const userAgents = "Operator note: final section marker";
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        skills,
        userAgents,
      });

      const operatorIdx = systemPrompt.indexOf(userAgents);
      expect(operatorIdx).toBeGreaterThan(-1);
      // Nothing substantive follows the user agents block
      const after = systemPrompt.slice(operatorIdx + userAgents.length).trim();
      expect(after).toBe("");
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

      it("renders each skill entry with name and description only (no absolute path)", () => {
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
        expect(systemPrompt).not.toContain("/skills/deploy/SKILL.md");
        expect(systemPrompt).not.toContain("Path:");
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

      it("omits Skills section when skills param is not provided", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
        });

        expect(systemPrompt).not.toContain("## Skills");
      });

      it("emits a Tools section when skills are provided", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        expect(systemPrompt).toContain("## Tools");
      });

      it("Tools section describes skill(name) and read(path) tools", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        expect(systemPrompt).toContain("skill(name)");
        expect(systemPrompt).toContain("read(path)");
      });

      it("Tools section positions skill/read as primary loaders with fallback note for direct tool use", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        // Primary loaders are described
        expect(systemPrompt).toContain("skill(name)");
        expect(systemPrompt).toContain("read(path)");
        // Fallback positioning is explicit
        expect(systemPrompt.toLowerCase()).toContain("no skill matches");
      });

      it("omits Tools section when skills param is not provided", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
        });

        expect(systemPrompt).not.toContain("## Tools");
      });

      it("emits Tools section even when the catalog is empty", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [],
        });

        expect(systemPrompt).toContain("## Tools");
      });

      it("places Tools section after Skills and before User Agents Appendix", () => {
        const skills = [makeSkillEntry()];

        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills,
          userAgents: "Operator note",
        });

        const skillsIdx = systemPrompt.indexOf("## Skills");
        const toolsIdx = systemPrompt.indexOf("## Tools");
        const operatorIdx = systemPrompt.indexOf("Operator note");

        expect(toolsIdx).toBeGreaterThan(skillsIdx);
        expect(operatorIdx).toBeGreaterThan(toolsIdx);
      });

      it("## Approach section has skill-first directive", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        const approachIdx = systemPrompt.indexOf("## Approach");
        const approachSection = systemPrompt.slice(approachIdx);
        expect(approachSection.toLowerCase()).toContain("skill");
      });

      it("Skills section header describes catalog as primary playbooks", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        expect(systemPrompt.toLowerCase()).toContain("playbook");
      });

      it("Tools section mentions fallback for direct tool use when no skill matches", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        expect(systemPrompt.toLowerCase()).toContain("no skill matches");
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

  it("includes ## Approach and ## Working Style sections (replaced Operating Principles)", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).toContain("## Approach");
    expect(systemPrompt).toContain("## Working Style");
    expect(systemPrompt).not.toContain("## Operating Principles");
  });

  it("includes channel-specific conversation guidance (concise)", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).toContain("## Conversation Style");
    expect(systemPrompt.toLowerCase()).toContain("concise");
  });

  it("does not include the heartbeat-only board workflow sections", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toContain("## Workflow");
    expect(systemPrompt).not.toContain("## Domain Knowledge");
  });

  it("includes Reply Format section between Tools and User Agents Appendix", () => {
    const skills = [makeSkillEntry()];
    const systemPrompt = assembleChannelSystemPrompt({
      skills,
      userAgents: "Operator note",
    });

    const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
    const toolsIdx = systemPrompt.indexOf("## Tools");
    const operatorIdx = systemPrompt.indexOf("Operator note");

    expect(replyFormatIdx).toBeGreaterThan(-1);
    expect(replyFormatIdx).toBeGreaterThan(toolsIdx);
    expect(operatorIdx).toBeGreaterThan(replyFormatIdx);
  });

  it("orders sections: base → variant → Skills → Tools → Reply Format → User Agents Appendix", () => {
    const skills = [makeSkillEntry()];
    const systemPrompt = assembleChannelSystemPrompt({
      skills,
      userAgents: "Operator note",
    });

    const approachIdx = systemPrompt.indexOf("## Approach");
    const styleIdx = systemPrompt.indexOf("## Conversation Style");
    const skillsIdx = systemPrompt.indexOf("## Skills");
    const toolsIdx = systemPrompt.indexOf("## Tools");
    const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
    const operatorIdx = systemPrompt.indexOf("Operator note");

    expect(approachIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(approachIdx);
    expect(skillsIdx).toBeGreaterThan(styleIdx);
    expect(toolsIdx).toBeGreaterThan(skillsIdx);
    expect(replyFormatIdx).toBeGreaterThan(toolsIdx);
    expect(operatorIdx).toBeGreaterThan(replyFormatIdx);
  });

  it("AGENTS.md (User Agents Appendix) is the final block — nothing follows it", () => {
    const skills = [makeSkillEntry()];
    const userAgents = "Operator channel note: final section marker";
    const systemPrompt = assembleChannelSystemPrompt({ skills, userAgents });

    const operatorIdx = systemPrompt.indexOf(userAgents);
    expect(operatorIdx).toBeGreaterThan(-1);
    const after = systemPrompt.slice(operatorIdx + userAgents.length).trim();
    expect(after).toBe("");
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

  it("renders skill entries with name and description only (no absolute path) in the channel system prompt", () => {
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
    expect(systemPrompt).not.toContain("/skills/triage/SKILL.md");
    expect(systemPrompt).not.toContain("Path:");
  });

  it("emits a Tools section in the channel system prompt when skills are provided", () => {
    const systemPrompt = assembleChannelSystemPrompt({
      skills: [makeSkillEntry()],
    });

    expect(systemPrompt).toContain("## Tools");
    expect(systemPrompt).toContain("skill(name)");
    expect(systemPrompt).toContain("read(path)");
  });

  it("omits Tools section in channel prompt when skills param is not provided", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toContain("## Tools");
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
    expect(heartbeatBase).toContain("## Approach");
  });

  describe("Reply Format section (between Tools and User Agents Appendix)", () => {
    it("Reply Format section is present in the channel system prompt", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      expect(systemPrompt).toContain("## Reply Format");
    });

    it("Reply Format section sits AFTER Tools section", () => {
      const systemPrompt = assembleChannelSystemPrompt({
        skills: [makeSkillEntry()],
      });

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      const toolsIdx = systemPrompt.indexOf("## Tools");

      expect(replyFormatIdx).toBeGreaterThan(-1);
      expect(replyFormatIdx).toBeGreaterThan(toolsIdx);
    });

    it("Reply Format section sits AFTER Skills section", () => {
      const systemPrompt = assembleChannelSystemPrompt({
        skills: [makeSkillEntry()],
      });

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      const skillsIdx = systemPrompt.indexOf("## Skills");

      expect(replyFormatIdx).toBeGreaterThan(-1);
      expect(replyFormatIdx).toBeGreaterThan(skillsIdx);
    });

    it("Reply Format section comes BEFORE User Agents Appendix", () => {
      const systemPrompt = assembleChannelSystemPrompt({
        skills: [makeSkillEntry()],
        userAgents: "Operator note",
      });

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      const operatorIdx = systemPrompt.indexOf("Operator note");

      expect(replyFormatIdx).toBeGreaterThan(-1);
      expect(operatorIdx).toBeGreaterThan(replyFormatIdx);
    });

    it("Reply Format is present (as last non-empty block) when userAgents is absent", () => {
      const systemPrompt = assembleChannelSystemPrompt({
        skills: [makeSkillEntry()],
      });

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      expect(replyFormatIdx).toBeGreaterThan(-1);
      // Nothing substantive follows Reply Format when no userAgents
      const afterReplyFormat = systemPrompt
        .slice(replyFormatIdx + "## Reply Format".length)
        .trim();
      expect(afterReplyFormat.length).toBeGreaterThan(0); // has content body
      expect(afterReplyFormat).not.toContain("##"); // no further sections
    });

    it("Reply Format block is plain prose — no literal markdown syntax demonstrations", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      const replyFormatSection = systemPrompt.slice(replyFormatIdx);

      // Must NOT contain literal markdown syntax being demonstrated
      expect(replyFormatSection).not.toMatch(/\*\*\w/); // **bold**
      expect(replyFormatSection).not.toMatch(/`\w/); // `code`
      expect(replyFormatSection).not.toMatch(/\[text\]\(url\)/); // [text](url)
      expect(replyFormatSection).not.toMatch(/^- /m); // bullet list markers
    });

    it("Reply Format block uses no negative phrasing (not, do not, don't)", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      // Extract only the Reply Format block (up to next ## or end)
      const afterHeader = systemPrompt.slice(
        replyFormatIdx + "## Reply Format".length,
      );
      const nextSectionIdx = afterHeader.indexOf("\n##");
      const replyFormatBody =
        nextSectionIdx === -1
          ? afterHeader
          : afterHeader.slice(0, nextSectionIdx);

      expect(replyFormatBody).not.toMatch(/\bnot\b/i);
      expect(replyFormatBody).not.toMatch(/\bdon't\b/i);
      expect(replyFormatBody).not.toMatch(/\bdo not\b/i);
    });

    it("Reply Format block opens sentences with positive action verbs", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatIdx = systemPrompt.indexOf("## Reply Format");
      const afterHeader = systemPrompt.slice(
        replyFormatIdx + "## Reply Format".length,
      );
      const nextSectionIdx = afterHeader.indexOf("\n##");
      const replyFormatBody =
        nextSectionIdx === -1
          ? afterHeader
          : afterHeader.slice(0, nextSectionIdx);

      // Should contain at least one sentence starting with a positive imperative
      expect(replyFormatBody).toMatch(/\b(Write|Use|Put|Keep|Show|Give)\b/);
    });

    it("Heartbeat system prompt does NOT include Reply Format section", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        skills: [makeSkillEntry()],
        userAgents: "Operator note",
      });

      expect(systemPrompt).not.toContain("## Reply Format");
    });

    it("Summarize system prompt does NOT include Reply Format section", () => {
      const systemPrompt = assembleSummarizeSystemPrompt();

      expect(systemPrompt).not.toContain("## Reply Format");
    });
  });
});

describe("assembleSummarizeSystemPrompt", () => {
  it("includes ## Approach and ## Working Style sections", () => {
    const systemPrompt = assembleSummarizeSystemPrompt();

    expect(systemPrompt).toContain("## Approach");
    expect(systemPrompt).toContain("## Working Style");
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

    const approachIdx = systemPrompt.indexOf("## Approach");
    const objectiveIdx = systemPrompt.indexOf("## Objective");

    expect(approachIdx).toBeGreaterThan(-1);
    expect(objectiveIdx).toBeGreaterThan(approachIdx);
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
