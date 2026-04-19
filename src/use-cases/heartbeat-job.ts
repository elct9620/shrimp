import { randomUUID } from "node:crypto";
import { selectTask } from "../entities/task-selector";
import { Section } from "../entities/section";
import { assembleHeartbeatPrompts } from "./prompt-assembler";
import { BoardSectionMissingError } from "./ports/board-repository";
import type { BoardRepository } from "./ports/board-repository";
import type { ShrimpAgent } from "./ports/shrimp-agent";
import type { ToolProviderFactory } from "./ports/tool-provider-factory";
import type { LoggerPort } from "./ports/logger";
import type { SpanAttributes, TelemetryPort } from "./ports/telemetry";

export type HeartbeatJobConfig = {
  board: BoardRepository;
  shrimpAgent: ShrimpAgent;
  toolProviderFactory: ToolProviderFactory;
  maxSteps: number;
  logger: LoggerPort;
  telemetry: TelemetryPort;
};

export class HeartbeatJob {
  private readonly board: BoardRepository;
  private readonly shrimpAgent: ShrimpAgent;
  private readonly toolProviderFactory: ToolProviderFactory;
  private readonly maxSteps: number;
  private readonly logger: LoggerPort;
  private readonly telemetry: TelemetryPort;

  constructor({
    board,
    shrimpAgent,
    toolProviderFactory,
    maxSteps,
    logger,
    telemetry,
  }: HeartbeatJobConfig) {
    this.board = board;
    this.shrimpAgent = shrimpAgent;
    this.toolProviderFactory = toolProviderFactory;
    this.maxSteps = maxSteps;
    this.logger = logger;
    this.telemetry = telemetry;
  }

  async run(input: {
    telemetry: { spanName: string; attributes: SpanAttributes };
  }): Promise<void> {
    // TODO: Use crypto.randomUUID() v7 when Node.js exposes it natively;
    // currently returns v4 which is the acceptable fallback per spec.
    const jobId = randomUUID();

    return this.telemetry.runInSpan(
      input.telemetry.spanName,
      async () => {
        this.logger.info("cycle started");

        let inProgressTasks, backlogTasks;

        try {
          await this.board.validateSections();
          inProgressTasks = await this.board.getTasks(Section.InProgress);
          backlogTasks = await this.board.getTasks(Section.Backlog);
        } catch (error) {
          if (error instanceof BoardSectionMissingError) {
            this.logger.warn("cycle skipped — board section missing", {
              missingSection: error.message,
            });
            return;
          }
          throw error;
        }

        const task = selectTask(inProgressTasks, backlogTasks);
        if (task === null) {
          this.logger.info("cycle idle", {
            reason: "no tasks available",
            inProgressCount: inProgressTasks.length,
            backlogCount: backlogTasks.length,
          });
          return;
        }

        this.logger.info("cycle task selected", {
          taskId: task.id,
          section: task.section,
          priority: task.priority,
        });

        let selectedTask = task;
        if (task.section === Section.Backlog) {
          await this.board.moveTask(task.id, Section.InProgress);
          selectedTask = { ...task, section: Section.InProgress };
          this.logger.debug("cycle task promoted", { taskId: task.id });
        }

        const comments = await this.board.getComments(selectedTask.id);
        const toolProvider = this.toolProviderFactory.create();
        const tools = toolProvider.getToolDescriptions();

        const { systemPrompt, userPrompt } = assembleHeartbeatPrompts({
          task: selectedTask,
          comments,
          tools,
        });

        this.logger.debug("cycle invoking shrimp agent", { taskId: task.id });
        const result = await this.shrimpAgent.run({
          systemPrompt,
          userPrompt,
          tools: toolProvider.getTools(),
          maxSteps: this.maxSteps,
          jobId,
          history: [],
        });

        this.logger.info("cycle finished", {
          taskId: task.id,
          reason: result.reason,
        });
      },
      input.telemetry.attributes,
    );
  }
}
