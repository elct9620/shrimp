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

export const TOKENS = {
  Logger: Symbol.for("shrimp.LoggerPort"),
  PinoInstance: Symbol.for("shrimp.PinoInstance"),
  BoardRepository: Symbol.for("shrimp.BoardRepository"),
  ShrimpAgent: Symbol.for("shrimp.ShrimpAgent"),
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
} as const;

export type TokenRegistry = {
  [TOKENS.Logger]: LoggerPort;
  [TOKENS.PinoInstance]: Logger;
  [TOKENS.BoardRepository]: BoardRepository;
  [TOKENS.ShrimpAgent]: ShrimpAgent;
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
};
