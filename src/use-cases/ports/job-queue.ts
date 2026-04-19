export interface JobQueue {
  // Returns true if the slot was free AND no jobs are pending, and the job was
  // started immediately; false otherwise (busy or pending). Heartbeat ticks use
  // this so polling does not pile up behind in-flight work.
  tryEnqueue(job: () => Promise<void>): boolean;

  // Appends the job to a FIFO pending queue; runs it as soon as the slot is
  // free. Channel-driven Jobs use this so user messages are never dropped
  // while compaction or a prior Job still holds the slot.
  enqueue(job: () => Promise<void>): void;
}
