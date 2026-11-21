import { EventType, Type } from './interfaces';

// Decorators only record which message a handler class serves; the buses read it on register().
// Same API as @nestjs/cqrs, without a DI container.
const commandMetadata = new WeakMap<Function, Type>();
const queryMetadata = new WeakMap<Function, Type>();
const eventMetadata = new WeakMap<Function, EventType[]>();

export function CommandHandler(command: Type) {
  return (target: Function) => {
    commandMetadata.set(target, command);
  };
}

export function QueryHandler(query: Type) {
  return (target: Function) => {
    queryMetadata.set(target, query);
  };
}

export function EventsHandler(...events: EventType[]) {
  return (target: Function) => {
    eventMetadata.set(target, events);
  };
}

export const getCommandFor = (handler: Function) => commandMetadata.get(handler);
export const getQueryFor = (handler: Function) => queryMetadata.get(handler);
export const getEventsFor = (handler: Function) => eventMetadata.get(handler) ?? [];
