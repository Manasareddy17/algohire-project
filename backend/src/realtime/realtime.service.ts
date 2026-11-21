import { Role } from '@prisma/client';
import { Response } from 'express';
import Redis from 'ioredis';
import { IDomainEvent } from '../core/cqrs';
import { UserResponse } from '../core/interfaces/user.interface';
import { Logger } from '../core/logger/logger';

export const REALTIME_CHANNEL = 'certiflow:events';

interface Client {
  user: UserResponse;
  res: Response;
}

/**
 * "Everyone sees changes as they happen, without refreshing the page."
 *
 * The worker publishes every committed domain event on a Redis channel. Each API instance
 * subscribes and pushes the event to its connected browsers over Server-Sent Events,
 * but only to users allowed to see that batch. The browser then re-fetches the data.
 */
export class RealtimeService {
  private logger = new Logger(this.constructor.name);
  private clients = new Set<Client>();

  constructor(private readonly subscriber: Redis) {}

  async start() {
    await this.subscriber.subscribe(REALTIME_CHANNEL);
    this.subscriber.on('message', (_channel, message) => {
      try {
        this.broadcast(JSON.parse(message) as IDomainEvent);
      } catch (err) {
        this.logger.warn(`[Realtime] Bad message: ${(err as Error).message}`);
      }
    });
  }

  addClient(user: UserResponse, res: Response) {
    const client = { user, res };
    this.clients.add(client);
    res.on('close', () => this.clients.delete(client));
  }

  private broadcast(event: IDomainEvent) {
    const payload = event.payload as { centreId?: number; districtId?: number };
    const message = `event: update\ndata: ${JSON.stringify({ type: event.type, aggregateId: event.aggregateId, payload: event.payload })}\n\n`;
    for (const client of this.clients) {
      if (this.canSee(client.user, payload)) client.res.write(message);
    }
  }

  private canSee(user: UserResponse, payload: { centreId?: number; districtId?: number }) {
    switch (user.role) {
      case Role.CENTRE:
        return user.centreId === payload.centreId;
      case Role.DISTRICT_OFFICER:
        return user.districtId === payload.districtId;
      default:
        return true;
    }
  }
}
