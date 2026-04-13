import type { HttpBindings } from "@hono/node-server";
import type { Logger } from "pino";

export type AppEnv = {
  Bindings: HttpBindings;
};

declare module "hono" {
  interface ContextVariableMap {
    logger: Logger;
    requestId: string;
  }
}
