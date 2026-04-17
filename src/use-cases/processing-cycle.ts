import { randomUUID } from "node:crypto";
import { selectTask } from "../entities/task-selector";
import { Section } from "../entities/section";
import { assemble } from "./prompt-assembler";
import { BoardSectionMissingError } from "./ports/board-repository";
import type { BoardRepository } from "./ports/board-repository";
import type { MainAgent } from "./ports/main-agent";
import type { ToolProviderFactory } from "./ports/tool-provider-factory";
import type { LoggerPort } from "./ports/logger";
import type { TelemetryPort } from "./ports/telemetry";

export type ProcessingCycleConfig = {
  board: BoardRepository;
  mainAgent: MainAgent;
  toolProviderFactory: ToolProviderFactory;
  maxSteps: number;
  logger: LoggerPort;
  telemetry: TelemetryPort;
};

export class ProcessingCycle {
  private readonly board: BoardRepository;
  private readonly mainAgent: MainAgent;
  private readonly toolProviderFactory: ToolProviderFactory;
  private readonly maxSteps: number;
  private readonly logger: LoggerPort;
  private readonly telemetry: TelemetryPort;

  constructor({
    board,
    mainAgent,
    toolProviderFactory,
    maxSteps,
    logger,
    telemetry,
  }: ProcessingCycleConfig) {
    this.board = board;
    this.mainAgent = mainAgent;
    this.toolProviderFactory = toolProviderFactory;
    this.maxSteps = maxSteps;
    this.logger = logger;
    this.telemetry = telemetry;
  }

  async run(): Promise<void> {
    // TODO: Use crypto.randomUUID() v7 when Node.js exposes it natively;
    // currently returns v4 which is the acceptable fallback per spec.
    const heartbeatId = randomUUID();

    return this.telemetry.runInSpan("shrimp.processing-cycle", async () => {
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

      const { systemPrompt, userPrompt } = assemble({
        task: selectedTask,
        comments,
        tools,
      });

      this.logger.debug("cycle invoking main agent", { taskId: task.id });
      const result = await this.mainAgent.run({
        systemPrompt,
        userPrompt,
        tools: toolProvider.getTools(),
        maxSteps: this.maxSteps,
        heartbeatId,
      });

      this.logger.info("cycle finished", {
        taskId: task.id,
        reason: result.reason,
      });
    });
  }
}
