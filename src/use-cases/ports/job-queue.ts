export interface JobQueue {
  // Appends the job to a FIFO pending queue; runs it as soon as the slot is
  // free. Both HeartbeatJob and ChannelJob use this — any pre-filtering
  // (e.g. Heartbeat Pre-Check) happens on the producer side before the Job
  // reaches the Queue. The Queue itself is unconditional FIFO.
  enqueue(job: () => Promise<void>): void;
}
