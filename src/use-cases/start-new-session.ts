import type { LoggerPort } from "./ports/logger";
import type { Session, SessionRepository } from "./ports/session-repository";

export class StartNewSession {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<Session> {
    const session = await this.sessionRepository.createNew();
    this.logger.info("session started", { sessionId: session.id });
    return session;
  }
}
