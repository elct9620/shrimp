import type { ToolSet } from "./tool-set";

export type MainAgentTerminationReason =
  | "finished"
  | "maxStepsReached"
  | "error";

export type MainAgentInput = {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  maxSteps: number;
};

export type MainAgentResult = {
  reason: MainAgentTerminationReason;
};

export interface MainAgent {
  run(input: MainAgentInput): Promise<MainAgentResult>;
}
