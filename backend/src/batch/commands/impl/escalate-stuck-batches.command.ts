/** Sent by the SLA timer in the worker, not by a user. */
export class EscalateStuckBatchesCommand {
  constructor(public readonly now: Date = new Date()) {}
}
