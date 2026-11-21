import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with a correlation id that every log line, audit row and outbox event
 * created inside it will carry. HTTP requests, outbox events and jobs all enter here,
 * which is what lets one batch be traced from upload to WhatsApp delivery.
 */
export function runWithContext<T>(correlationId: string | undefined, fn: () => T): T {
  return storage.run({ correlationId: correlationId || randomUUID() }, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
