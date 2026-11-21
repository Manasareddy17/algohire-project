import { useEffect, useState } from 'react';
import { session } from './api';

export interface LiveEvent {
  type: string;
  aggregateId: string;
  payload: { code?: string; status?: string; reason?: string; [key: string]: unknown };
}

/**
 * Opens one Server-Sent Events stream for the logged-in user. Every time the server
 * reports a change, `version` goes up, and pages that depend on it reload their data.
 * EventSource reconnects by itself if the connection drops.
 */
export function useLiveUpdates(userKey: string | undefined) {
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);

  useEffect(() => {
    if (!userKey || !session.token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    source.addEventListener('update', (message) => {
      setLastEvent(JSON.parse((message as MessageEvent).data));
      setVersion((value) => value + 1);
    });
    return () => source.close();
  }, [userKey]);

  return { version, lastEvent };
}
