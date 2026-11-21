// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Type<T = object> = new (...args: any[]) => T;

export interface ICommandHandler<TCommand extends object, TResult = unknown> {
  execute(command: TCommand): Promise<TResult>;
}

export interface IQueryHandler<TQuery extends object, TResult = unknown> {
  execute(query: TQuery): Promise<TResult>;
}

/** A domain event as it travels through the outbox and the queue. */
export interface IDomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  correlationId?: string | null;
}

export interface IEventHandler<TPayload = Record<string, unknown>> {
  handle(event: IDomainEvent<TPayload>): Promise<void>;
}

/** Static shape every event class exposes, so handlers can subscribe by class. */
export interface EventType {
  readonly type: string;
  readonly aggregateType: string;
}
