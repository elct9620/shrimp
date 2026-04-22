import type { BoardRepository } from "../../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../../use-cases/ports/logger";
import type { SkillCatalog } from "../../../use-cases/ports/skill-catalog";
import type { ToolDescription } from "../../../use-cases/ports/tool-description";
import { createGetTasksTool, GET_TASKS_TOOL_NAME } from "./get-tasks";
import { createGetCommentsTool, GET_COMMENTS_TOOL_NAME } from "./get-comments";
import { createPostCommentTool, POST_COMMENT_TOOL_NAME } from "./post-comment";
import { createMoveTaskTool, MOVE_TASK_TOOL_NAME } from "./move-task";
import { createSkillTool, SKILL_TOOL_NAME } from "./skill-tool";
import { createReadTool, READ_TOOL_NAME } from "./read-tool";

export function createBuiltInTools(
  repo: BoardRepository,
  skillCatalog: SkillCatalog,
  logger: LoggerPort,
) {
  return {
    getTasks: createGetTasksTool(
      repo,
      logger.child({ tool: GET_TASKS_TOOL_NAME }),
    ),
    getComments: createGetCommentsTool(
      repo,
      logger.child({ tool: GET_COMMENTS_TOOL_NAME }),
    ),
    postComment: createPostCommentTool(
      repo,
      logger.child({ tool: POST_COMMENT_TOOL_NAME }),
    ),
    moveTask: createMoveTaskTool(
      repo,
      logger.child({ tool: MOVE_TASK_TOOL_NAME }),
    ),
    skill: createSkillTool(
      skillCatalog,
      logger.child({ tool: SKILL_TOOL_NAME }),
    ),
    read: createReadTool(skillCatalog, logger.child({ tool: READ_TOOL_NAME })),
  };
}

export function createBuiltInToolDescriptions(): ToolDescription[] {
  return [
    {
      name: GET_TASKS_TOOL_NAME,
      description:
        "List tasks in the specified board section (Backlog, In Progress, or Done).",
    },
    {
      name: GET_COMMENTS_TOOL_NAME,
      description: "List comments on a Todoist task by its ID.",
    },
    {
      name: POST_COMMENT_TOOL_NAME,
      description:
        "Post a comment on a Todoist task to report progress or summarize results.",
    },
    {
      name: MOVE_TASK_TOOL_NAME,
      description:
        "Move a Todoist task to a different board section (Backlog, In Progress, or Done).",
    },
    {
      name: SKILL_TOOL_NAME,
      description:
        "Load the full SKILL.md content for a skill by name. Returns the skill body with relative resource paths rewritten to absolute paths.",
    },
    {
      name: READ_TOOL_NAME,
      description:
        "Read the content of a file under the Built-in or Custom skills root. Paths outside both skill roots are refused with an error result.",
    },
  ];
}
