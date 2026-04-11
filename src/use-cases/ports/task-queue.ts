export interface TaskQueue {
  // Returns true if the slot was free and the job was started; false if the slot
  // was busy and the job was silently dropped — per SPEC §In-Memory Task Queue.
  tryEnqueue(job: () => Promise<void>): boolean
}
