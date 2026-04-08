import { randomUUID } from 'node:crypto';

export type PartyRealtimeEventType =
  | 'party.join_requested'
  | 'party.join_accepted'
  | 'party.join_declined'
  | 'party.kicked'
  | 'party.left'
  | 'party.cancelled';

export interface PartyRealtimeEvent {
  eventId: string;
  type: PartyRealtimeEventType;
  partyId: string;
  actorUserId: string;
  occurredAt: string;
}

export interface PartyEventBus {
  subscribe(userId: string, listener: (event: PartyRealtimeEvent) => void): () => void;
  publishToUsers(
    userIds: string[],
    input: Omit<PartyRealtimeEvent, 'eventId' | 'occurredAt'>
  ): void;
  close(): void;
}

export class InMemoryPartyEventBus implements PartyEventBus {
  private readonly listenersByUser = new Map<string, Map<string, (event: PartyRealtimeEvent) => void>>();

  public subscribe(userId: string, listener: (event: PartyRealtimeEvent) => void): () => void {
    const listenerId = randomUUID();
    const listeners = this.listenersByUser.get(userId) ?? new Map<string, (event: PartyRealtimeEvent) => void>();
    listeners.set(listenerId, listener);
    this.listenersByUser.set(userId, listeners);

    return () => {
      const activeListeners = this.listenersByUser.get(userId);
      if (!activeListeners) {
        return;
      }

      activeListeners.delete(listenerId);
      if (activeListeners.size === 0) {
        this.listenersByUser.delete(userId);
      }
    };
  }

  public publishToUsers(
    userIds: string[],
    input: Omit<PartyRealtimeEvent, 'eventId' | 'occurredAt'>
  ): void {
    const recipients = [...new Set(userIds.filter((userId) => userId.length > 0))];
    if (recipients.length === 0) {
      return;
    }

    const event: PartyRealtimeEvent = {
      ...input,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString()
    };

    for (const userId of recipients) {
      const listeners = this.listenersByUser.get(userId);
      if (!listeners) {
        continue;
      }

      for (const listener of listeners.values()) {
        listener(event);
      }
    }
  }

  public close(): void {
    this.listenersByUser.clear();
  }
}
