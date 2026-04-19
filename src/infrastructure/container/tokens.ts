import type { Logger } from "pino";
import type { LanguageModel } from "ai";
import type { Tracer } from "@opentelemetry/api";
import type { BoardRepository } from "../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { ShrimpAgent } from "../../use-cases/ports/shrimp-agent";
import type { JobQueue } from "../../use-cases/ports/job-queue";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";
import type { ToolProviderFactory } from "../../use-cases/ports/tool-provider-factory";
import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { EnvConfig } from "../config/env-config";
import type { McpConfig } from "../config/mcp-config";
import type { McpClientFactory } from "../mcp/mcp-tool-loader";
import type { HeartbeatJob } from "../../use-cases/heartbeat-job";
import type { SessionRepository } from "../../use-cases/ports/session-repository";
import type { ChannelJob } from "../../use-cases/channel-job";
import type { StartNewSession } from "../../use-cases/start-new-session";
import type { UserAgentsPort } from "../../use-cases/ports/user-agents";
import type { SummarizePort } from "../../use-cases/ports/summarize";

export const TOKENS = {
  Logger: Symbol.for("shrimp.LoggerPort"),
  PinoInstance: Symbol.for("shrimp.PinoInstance"),
  BoardRepository: Symbol.for("shrimp.BoardRepository"),
  ShrimpAgent: Symbol.for("shrimp.ShrimpAgent"),
  Summarize: Symbol.for("shrimp.SummarizePort"),
  JobQueue: Symbol.for("shrimp.JobQueue"),
  Telemetry: Symbol.for("shrimp.TelemetryPort"),
  Tracer: Symbol.for("shrimp.Tracer"),
  ToolProviderFactory: Symbol.for("shrimp.ToolProviderFactory"),
  LanguageModel: Symbol.for("shrimp.LanguageModel"),
  EnvConfig: Symbol.for("shrimp.EnvConfig"),
  McpConfig: Symbol.for("shrimp.McpConfig"),
  McpClientFactory: Symbol.for("shrimp.McpClientFactory"),
  HeartbeatJob: Symbol.for("shrimp.HeartbeatJob"),
  ChannelGateway: Symbol.for("shrimp.ChannelGateway"),
  SessionRepository: Symbol.for("shrimp.SessionRepository"),
  ChannelJob: Symbol.for("shrimp.ChannelJob"),
  StartNewSession: Symbol.for("shrimp.StartNewSession"),
  UserAgents: Symbol.for("shrimp.UserAgentsPort"),
} as const;

export type TokenRegistry = {
  [TOKENS.Logger]: LoggerPort;
  [TOKENS.PinoInstance]: Logger;
  [TOKENS.BoardRepository]: BoardRepository;
  [TOKENS.ShrimpAgent]: ShrimpAgent;
  [TOKENS.Summarize]: SummarizePort;
  [TOKENS.JobQueue]: JobQueue;
  [TOKENS.Telemetry]: TelemetryPort;
  [TOKENS.Tracer]: Tracer;
  [TOKENS.ToolProviderFactory]: ToolProviderFactory;
  [TOKENS.LanguageModel]: LanguageModel;
  [TOKENS.EnvConfig]: EnvConfig;
  [TOKENS.McpConfig]: McpConfig;
  [TOKENS.McpClientFactory]: McpClientFactory;
  [TOKENS.HeartbeatJob]: HeartbeatJob;
  [TOKENS.ChannelGateway]: ChannelGateway;
  [TOKENS.SessionRepository]: SessionRepository;
  [TOKENS.ChannelJob]: ChannelJob;
  [TOKENS.StartNewSession]: StartNewSession;
  [TOKENS.UserAgents]: UserAgentsPort;
};
