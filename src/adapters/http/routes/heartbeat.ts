import { Hono } from "hono";
import type { AppEnv } from "../context-variables";
import type { JobQueue } from "../../../use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../../use-cases/heartbeat-job";
import type { BoardRepository } from "../../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export type HeartbeatJobRunner = Pick<HeartbeatJob, "run">;
import { Section } from "../../../entities/section";
import { collectHttpSpanAttributes } from "../telemetry-attributes";
import { timingSafeEqualStr } from "../timing-safe-compare";

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  if (!header.startsWith(BEARER_PREFIX)) return undefined;
  return header.slice(BEARER_PREFIX.length);
}

type PreCheckDecision = { enqueue: true } | { enqueue: false; reason: string };

/**
 * Heartbeat Pre-Check (producer-side, per SPEC §POST /heartbeat):
 *   - Backlog empty                 → skip (nothing to promote)
 *   - In Progress count > 1         → skip (already saturated)
 *   - BoardRepository throws        → Fail-Open: skip, next heartbeat retries
 *   - Otherwise                     → enqueue
 */
async function decideHeartbeatEnqueue(
  board: BoardRepository,
  logger: LoggerPort,
): Promise<PreCheckDecision> {
  try {
    const [backlog, inProgress] = await Promise.all([
      board.getTasks(Section.Backlog),
      board.getTasks(Section.InProgress),
    ]);
    if (backlog.length === 0) {
      return { enqueue: false, reason: "backlog empty" };
    }
    if (inProgress.length > 1) {
      return { enqueue: false, reason: "in progress saturated (n>1)" };
    }
    return { enqueue: true };
  } catch (err) {
    logger.warn("heartbeat pre-check board query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { enqueue: false, reason: "board query failed" };
  }
}

export function createHeartbeatRoute(deps: {
  jobQueue: JobQueue;
  heartbeatJob: HeartbeatJobRunner;
  board: BoardRepository;
  logger: LoggerPort;
  heartbeatToken?: string;
  /** Test seam: invoked with the fire-and-forget pre-check promise so tests can await completion. Production leaves this undefined. */
  onPreCheckSettled?: (p: Promise<void>) => void;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/heartbeat", (c) => {
    if (deps.heartbeatToken) {
      const provided = extractBearerToken(c.req.header("authorization"));
      if (!provided || !timingSafeEqualStr(provided, deps.heartbeatToken)) {
        deps.logger.warn("heartbeat rejected");
        return c.body(null, 401);
      }
    }

    deps.logger.info("heartbeat received");
    const attributes = collectHttpSpanAttributes(c, "/heartbeat");

    // Fire-and-forget: pre-check + enqueue run after the 202 is returned.
    // Errors never propagate to the HTTP boundary (Fail-Open).
    const chain = decideHeartbeatEnqueue(deps.board, deps.logger)
      .then((decision) => {
        if (!decision.enqueue) {
          deps.logger.info("heartbeat pre-check skipped", {
            reason: decision.reason,
          });
          return;
        }
        deps.jobQueue.enqueue(() =>
          deps.heartbeatJob.run({
            telemetry: { spanName: "POST /heartbeat", attributes },
          }),
        );
        deps.logger.info("heartbeat enqueued");
      })
      .catch((err) => {
        // Defense-in-depth: decideHeartbeatEnqueue already catches; this
        // guards against logger.info / enqueue itself throwing.
        deps.logger.warn("heartbeat pre-check unexpected failure", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    void chain;
    deps.onPreCheckSettled?.(chain);

    return c.json({ status: "accepted" }, 202);
  });

  return app;
}
