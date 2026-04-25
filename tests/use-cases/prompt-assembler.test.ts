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

/**
 * Returns the content of a `## Heading` section: from the line after the heading
 * to (but not including) the next `## ` heading line, or end-of-string.
 * Trailing whitespace is trimmed. Throws if the heading is not found.
 */
function extractSection(prompt: string, heading: string): string {
  const lines = prompt.split("\n");
  const headingLine = `## ${heading}`;
  const startIdx = lines.findIndex((line) => line === headingLine);
  if (startIdx === -1) {
    throw new Error(`Section "${heading}" not found in prompt`);
  }
  const bodyLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    bodyLines.push(lines[i]);
  }
  return bodyLines.join("\n").trimEnd();
}

/**
 * Returns the given headings sorted by their first occurrence in the prompt.
 * Headings not found in the prompt are sorted to the end.
 */
function sectionOrder(prompt: string, headings: string[]): string[] {
  return [...headings].sort((a, b) => {
    const ai = prompt.indexOf(a);
    const bi = prompt.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/**
 * Markdown syntax patterns that must NOT appear in the Output Format section body.
 * Small-model voice renderers (e.g. Telegram) display these as literal characters,
 * hurting readability — so the prompt explicitly forbids them and the section itself
 * must be free of them.
 *
 * Each entry pairs a pattern with a label for readable failure output.
 */
const MARKDOWN_SYNTAX_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "bold (**word)", pattern: /\*\*/ },
  { label: "italic (*word*)", pattern: /\*\w/ },
  { label: "inline code (`word)", pattern: /`\w/ },
  { label: "hyphen-bullet list (^- )", pattern: /^- /m },
  { label: "blockquote (^> )", pattern: /^> /m },
  { label: "numbered list (^1. )", pattern: /^\d+\. /m },
  { label: "link syntax ([text](url))", pattern: /\[.+\]\(https?:\/\//m },
];

/**
 * English names for forbidden symbol classes that the Output Format prohibition
 * paragraph must mention by name, so that small models understand which characters
 * to avoid even when they cannot render the characters themselves.
 * Every word in this list maps to an explicit term in buildOutputFormatSection().
 */
const FORBIDDEN_SYMBOL_WORDS = [
  "hash",
  "asterisk",
  "backtick",
  "hyphen",
  "blockquote",
  "bracket",
] as const;

describe("assembleHeartbeatPrompts", () => {
  describe("system prompt", () => {
    it("opens with goal-oriented language, not role-based framing", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      expect(systemPrompt).toMatch(/^Help /);
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

      const approachSection = extractSection(systemPrompt, "Approach");

      expect(approachSection.toLowerCase()).toContain("skill");
    });

    it("## Working Style section contains positive behavioural norms (ask when uncertain, report facts)", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
      });

      const workingStyleSection = extractSection(systemPrompt, "Working Style");

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

    it.each([
      {
        name: "with skills and userAgents",
        skills: [makeSkillEntry()],
        userAgents: "Operator note",
        expectedOrder: [
          "## Approach",
          "## Objective",
          "## Skills",
          "## Tools",
          "Operator note",
        ],
      },
      {
        name: "with skills only (no userAgents)",
        skills: [makeSkillEntry()],
        userAgents: undefined,
        expectedOrder: ["## Approach", "## Objective", "## Skills", "## Tools"],
      },
      {
        name: "with no skills and no userAgents",
        skills: undefined,
        userAgents: undefined,
        expectedOrder: ["## Approach", "## Objective"],
      },
    ])(
      "orders sections from stable to dynamic: base → variant → Skills → Tools → User Agents Appendix ($name)",
      ({ skills, userAgents, expectedOrder }) => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills,
          userAgents,
        });

        const actualOrder = sectionOrder(systemPrompt, expectedOrder);
        expect(actualOrder).toEqual(expectedOrder);
      },
    );

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

    it("trims leading and trailing whitespace from non-empty userAgents before appending", () => {
      const trimmedValue = "MCP tool X";
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents: `  ${trimmedValue}\n`,
      });

      // The trimmed form appears in the prompt
      expect(systemPrompt).toContain(trimmedValue);
      // Leading spaces and trailing newline are stripped
      expect(systemPrompt).not.toMatch(/  MCP tool X/);
      expect(systemPrompt.endsWith(trimmedValue)).toBe(true);
    });

    it("passes through embedded quotes and newlines verbatim (no escaping or crash)", () => {
      const userAgents = 'Say "hello"\nnext line';
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents,
      });

      // Both parts of the multi-line value appear in the prompt
      expect(systemPrompt).toContain('Say "hello"');
      expect(systemPrompt).toContain("next line");
    });

    it("passes through markdown-like fragments verbatim — they do not break surrounding prompt structure", () => {
      const userAgents = "Use **bold** or `code` or [link](http://example.com)";
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents,
      });

      // The markdown fragments appear unchanged — source does no escaping
      expect(systemPrompt).toContain(userAgents);
      // The base sections still exist — surrounding structure is intact
      expect(systemPrompt).toContain("## Approach");
      expect(systemPrompt).toContain("## Working Style");
    });

    it("handles extremely long userAgents input without crashing and includes full content", () => {
      const longValue = "A".repeat(10_000);
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        userAgents: longValue,
      });

      // No length cap — full content appears verbatim
      expect(systemPrompt).toContain(longValue);
      // Base structure still intact after appending a large block
      expect(systemPrompt).toContain("## Approach");
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

        const order = sectionOrder(systemPrompt, [
          "## Objective",
          "## Skills",
          "Operator note",
        ]);
        expect(order).toEqual(["## Objective", "## Skills", "Operator note"]);
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

      it("Tools section positions skill/read as primary loaders — additional tools reached through skills", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        // Primary loaders are described
        expect(systemPrompt).toContain("skill(name)");
        expect(systemPrompt).toContain("read(path)");
        // New framing: tools reached through skills
        expect(systemPrompt.toLowerCase()).toMatch(
          /reached through skills|instructs you to call/,
        );
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

        const order = sectionOrder(systemPrompt, [
          "## Skills",
          "## Tools",
          "Operator note",
        ]);
        expect(order).toEqual(["## Skills", "## Tools", "Operator note"]);
      });

      it("## Approach section has skill-first directive", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        const approachSection = extractSection(systemPrompt, "Approach");
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

      it("Tools section does NOT contain old escape-hatch phrasing", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        expect(systemPrompt.toLowerCase()).not.toContain(
          "you may use those tools directly",
        );
        expect(systemPrompt.toLowerCase()).not.toContain("no skill matches");
      });

      it("## Approach section does NOT contain old tool-bypass fallback", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        const approachSection = extractSection(systemPrompt, "Approach");

        expect(approachSection.toLowerCase()).not.toContain(
          "reason from the task directly",
        );
        expect(approachSection.toLowerCase()).not.toContain("tools directly");
      });

      it("## Approach section fallback describes asking for clarification when no skill matches", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        const approachSection = extractSection(systemPrompt, "Approach");

        expect(approachSection.toLowerCase()).toMatch(
          /state what|ask for clarification/,
        );
      });

      it("## Skills header contains 'before doing anything else' ordering directive", () => {
        const { systemPrompt } = assembleHeartbeatPrompts({
          task: makeTask(),
          comments: [],
          skills: [makeSkillEntry()],
        });

        const skillsHeader = extractSection(systemPrompt, "Skills");

        expect(skillsHeader.toLowerCase()).toContain(
          "before doing anything else",
        );
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

    expect(systemPrompt).toMatch(/^Help /);
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

  it("Channel ## Objective does not contain output-format language (plain, text, markdown, format)", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    const objectiveSection = extractSection(systemPrompt, "Objective");

    expect(objectiveSection.toLowerCase()).not.toContain("plain text");
    expect(objectiveSection.toLowerCase()).not.toContain("plain");
    expect(objectiveSection.toLowerCase()).not.toContain("markdown");
    expect(objectiveSection.toLowerCase()).not.toContain("format");
  });

  it("does not include the heartbeat-only board workflow sections", () => {
    const systemPrompt = assembleChannelSystemPrompt({});

    expect(systemPrompt).not.toContain("## Workflow");
    expect(systemPrompt).not.toContain("## Domain Knowledge");
  });

  it.each([
    {
      name: "with skills and userAgents",
      skills: [makeSkillEntry()],
      userAgents: "Operator note",
      expectedOrder: [
        "## Approach",
        "## Conversation Style",
        "## Skills",
        "## Tools",
        "## Output Format",
        "Operator note",
      ],
    },
    {
      name: "with skills only (no userAgents)",
      skills: [makeSkillEntry()],
      userAgents: undefined,
      expectedOrder: [
        "## Approach",
        "## Conversation Style",
        "## Skills",
        "## Tools",
        "## Output Format",
      ],
    },
    {
      name: "with no skills and no userAgents",
      skills: undefined,
      userAgents: undefined,
      expectedOrder: [
        "## Approach",
        "## Conversation Style",
        "## Output Format",
      ],
    },
  ])(
    "orders sections: base → variant → Skills → Tools → Output Format → User Agents Appendix ($name)",
    ({ skills, userAgents, expectedOrder }) => {
      const systemPrompt = assembleChannelSystemPrompt({ skills, userAgents });

      const actualOrder = sectionOrder(systemPrompt, expectedOrder);
      expect(actualOrder).toEqual(expectedOrder);
    },
  );

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

    const order = sectionOrder(systemPrompt, [
      "## Conversation Style",
      "## Skills",
      "Operator channel note",
    ]);
    expect(order).toEqual([
      "## Conversation Style",
      "## Skills",
      "Operator channel note",
    ]);
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

  describe("Output Format section (between Tools and User Agents Appendix)", () => {
    it("Output Format section is present in the channel system prompt", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      expect(systemPrompt).toContain("## Output Format");
    });

    it.each([
      {
        name: "sits after Skills and Tools (skills provided)",
        skills: [makeSkillEntry()],
        userAgents: undefined,
        expectedOrder: ["## Skills", "## Tools", "## Output Format"],
      },
      {
        name: "comes before User Agents Appendix (skills and userAgents provided)",
        skills: [makeSkillEntry()],
        userAgents: "Operator note",
        expectedOrder: [
          "## Skills",
          "## Tools",
          "## Output Format",
          "Operator note",
        ],
      },
    ])(
      "Output Format section position: $name",
      ({ skills, userAgents, expectedOrder }) => {
        const systemPrompt = assembleChannelSystemPrompt({
          skills,
          userAgents,
        });

        const actualOrder = sectionOrder(systemPrompt, expectedOrder);
        expect(actualOrder).toEqual(expectedOrder);
      },
    );

    it("Output Format is present (as last non-empty block) when userAgents is absent", () => {
      const systemPrompt = assembleChannelSystemPrompt({
        skills: [makeSkillEntry()],
      });

      const outputFormatIdx = systemPrompt.indexOf("## Output Format");
      expect(outputFormatIdx).toBeGreaterThan(-1);
      // Nothing substantive follows Output Format when no userAgents
      const afterReplyFormat = systemPrompt
        .slice(outputFormatIdx + "## Output Format".length)
        .trim();
      expect(afterReplyFormat.length).toBeGreaterThan(0); // has content body
      expect(afterReplyFormat).not.toContain("##"); // no further sections
    });

    it("Output Format block MUST NOT contain raw Markdown characters", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Hard constraint: the body that the channel delivers to users must itself
      // be free of the markup characters it instructs the model not to use.
      for (const { label, pattern } of MARKDOWN_SYNTAX_PATTERNS) {
        expect(
          replyFormatBody,
          `Output Format body must not contain ${label}`,
        ).not.toMatch(pattern);
      }
    });

    it("Output Format block opens with positive plain-text definition ('Plain text means')", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Para 1: positive definition marker
      expect(replyFormatBody.toLowerCase()).toContain("plain text means");
    });

    it("Output Format block contains channel display context ('no Markdown or HTML rendering')", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Para 2: client-side rendering context
      expect(replyFormatBody).toContain("no Markdown or HTML rendering");
    });

    it("Output Format block contains explicit 'Do not use' prohibition", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Para 3: explicit prohibition — this is the designated spot
      expect(replyFormatBody).toContain("Do not use");
    });

    it("Output Format block prohibition names every forbidden symbol by its English word", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // The prohibition paragraph must name every symbol class by its English word so
      // that small models without rendering context understand exactly what to avoid.
      for (const word of FORBIDDEN_SYMBOL_WORDS) {
        expect(
          replyFormatBody.toLowerCase(),
          `Output Format prohibition must name "${word}"`,
        ).toContain(word);
      }
    });

    it("Output Format block contains both concrete examples verbatim", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      expect(replyFormatBody).toContain("For example:");
      expect(replyFormatBody).toContain("Another example:");
      expect(replyFormatBody).toContain(
        "Hakodate has three great spots: the morning market, the cable car up Mt. Hakodate at sunset, and the old brick warehouses in Motomachi.",
      );
      expect(replyFormatBody).toContain(
        "I checked with the search skill. The Hakodate ropeway closes at 10pm from October through April.",
      );
    });

    it("Output Format block contains skill-content closing clause", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      expect(replyFormatBody).toContain("put the outcome into your own words");
    });

    it("Output Format block prohibition includes 'numbered lists'", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      expect(replyFormatBody.toLowerCase()).toContain("numbered lists");
    });

    it("Output Format block contains multi-item weaving rule ('weave' or 'running sentences')", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      expect(replyFormatBody.toLowerCase()).toMatch(/weave|running sentences/);
    });

    it("Output Format block contains three example introductions", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Must contain at least two of the three markers; third is new long-form example
      const markerCount = [
        "For example:",
        "Another example:",
        "For a longer reply",
      ].filter((marker) => replyFormatBody.includes(marker)).length;

      expect(markerCount).toBeGreaterThanOrEqual(3);
    });

    it("Output Format long-form example contains no list structure", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      // Extract content inside the long-form example quote
      const longerReplyIdx = replyFormatBody.indexOf("For a longer reply");
      expect(longerReplyIdx).toBeGreaterThan(-1);

      // Find the quoted content (between first " after the marker and closing ")
      const afterMarker = replyFormatBody.slice(longerReplyIdx);
      const quoteStart = afterMarker.indexOf('"');
      const quoteEnd = afterMarker.lastIndexOf('"');
      expect(quoteStart).toBeGreaterThan(-1);
      expect(quoteEnd).toBeGreaterThan(quoteStart);

      const exampleContent = afterMarker.slice(quoteStart + 1, quoteEnd);

      // No numbered list items (digits followed by dot and space at start of text segment)
      expect(exampleContent).not.toMatch(/\d+\.\s/);
      // No hyphen-bullets
      expect(exampleContent).not.toMatch(/^- /m);
      // No asterisk-bullets
      expect(exampleContent).not.toMatch(/^\* /m);
      // No section headers
      expect(exampleContent).not.toMatch(/^### /m);
    });

    it("Output Format block is under 220 words", () => {
      const systemPrompt = assembleChannelSystemPrompt({});

      const replyFormatBody = extractSection(systemPrompt, "Output Format");

      const wordCount = replyFormatBody
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      expect(wordCount).toBeLessThanOrEqual(220);
    });

    it("Heartbeat system prompt does NOT include Output Format section", () => {
      const { systemPrompt } = assembleHeartbeatPrompts({
        task: makeTask(),
        comments: [],
        skills: [makeSkillEntry()],
        userAgents: "Operator note",
      });

      expect(systemPrompt).not.toContain("## Output Format");
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

    const expectedOrder = ["## Approach", "## Objective"];
    expect(sectionOrder(systemPrompt, expectedOrder)).toEqual(expectedOrder);
  });

  it("shares the same base section as the channel variant", () => {
    const summarize = assembleSummarizeSystemPrompt();
    const channel = assembleChannelSystemPrompt({});

    const summarizeBase = summarize.slice(0, summarize.indexOf("## Objective"));
    const channelBase = channel.slice(0, channel.indexOf("## Objective"));

    expect(summarizeBase).toBe(channelBase);
  });

  it("is a pure function (same output for repeated calls)", () => {
    expect(assembleSummarizeSystemPrompt()).toEqual(
      assembleSummarizeSystemPrompt(),
    );
  });
});
