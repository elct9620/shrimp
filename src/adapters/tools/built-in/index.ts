import type { BoardRepository } from "../../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../../use-cases/ports/logger";
import type { ToolDescription } from "../../../use-cases/ports/tool-description";
import type { ChannelGateway } from "../../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../../entities/conversation-ref";
import { createGetTasksTool, GET_TASKS_TOOL_NAME } from "./get-tasks";
import { createGetCommentsTool, GET_COMMENTS_TOOL_NAME } from "./get-comments";
import { createPostCommentTool, POST_COMMENT_TOOL_NAME } from "./post-comment";
import { createMoveTaskTool, MOVE_TASK_TOOL_NAME } from "./move-task";
import { createReplyTool, REPLY_TOOL_NAME } from "./reply";

export function createBuiltInTools(
  repo: BoardRepository,
  logger: LoggerPort,
  gateway: ChannelGateway,
  ref: ConversationRef | undefined,
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
    reply: createReplyTool(
      gateway,
      logger.child({ module: REPLY_TOOL_NAME }),
      ref,
    ),
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
      name: REPLY_TOOL_NAME,
      description:
        "Send a text reply to the user in the originating chat channel.",
    },
  ];
}
