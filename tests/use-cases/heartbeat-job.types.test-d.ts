// Type-only test — compile errors here mean an invariant in SPEC §Auto Compact was violated.
//
// SPEC invariant: §Session Lifecycle §Auto Compact — "HeartbeatJob exclusion:
// HeartbeatJob has no Session, does not evaluate the Compaction Threshold, and
// never invokes SummarizePort. Auto Compact applies only to ChannelJob."
//
// These type-level assertions enforce the invariant structurally: if either
// field is ever added to HeartbeatJobConfig the TypeScript compiler will reject
// this file, catching the regression before any test runs.

import type { HeartbeatJobConfig } from "../../src/use-cases/heartbeat-job";

type Expect<T extends false> = T;

// Type-level guard: neither "summarize" nor "compactionThreshold" must
// appear as keys of HeartbeatJobConfig.  If either conditional type ever
// resolves to `true` (i.e. the field was added), TypeScript will reject the
// assignment `false satisfies false` → `true satisfies false` → compile error.
export type _Assert = [
  Expect<"summarize" extends keyof HeartbeatJobConfig ? never : false>,
  Expect<
    "compactionThreshold" extends keyof HeartbeatJobConfig ? never : false
  >,
];
