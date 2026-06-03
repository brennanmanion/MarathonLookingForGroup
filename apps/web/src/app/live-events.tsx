import { useEffect } from 'react';

import { queryClient } from './query-client';
import { useAuth } from './auth';
import { useToast } from './toasts';

interface RealtimeEvent {
  eventId: string;
  type:
    | 'party.join_requested'
    | 'party.join_accepted'
    | 'party.join_declined'
    | 'party.kicked'
    | 'party.left'
    | 'party.cancelled';
  partyId: string;
  actorUserId: string;
  occurredAt: string;
}

function messageForEvent(event: RealtimeEvent): string | null {
  switch (event.type) {
    case 'party.join_requested':
      return 'New join request received.';
    case 'party.join_accepted':
      return 'A party approved your request.';
    case 'party.join_declined':
      return 'A host declined your request.';
    case 'party.kicked':
      return 'You were removed from a party.';
    case 'party.left':
      return 'A member left your party.';
    case 'party.cancelled':
      return 'A party you were in was cancelled.';
    default:
      return null;
  }
}

function toastKindForEvent(event: RealtimeEvent): 'success' | 'error' | 'info' {
  switch (event.type) {
    case 'party.join_accepted':
      return 'success';
    case 'party.join_declined':
    case 'party.kicked':
    case 'party.cancelled':
      return 'error';
    default:
      return 'info';
  }
}

export function LiveEventBridge() {
  const { status } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }

    const source = new EventSource('/events/stream', {
      withCredentials: true
    });

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;

        queryClient.invalidateQueries({ queryKey: ['parties'] });
        queryClient.invalidateQueries({ queryKey: ['party', event.partyId] });
        queryClient.invalidateQueries({ queryKey: ['me'] });

        const toastMessage = messageForEvent(event);
        if (toastMessage) {
          showToast({
            kind: toastKindForEvent(event),
            message: toastMessage
          });
        }
      } catch {
        // Ignore malformed event payloads and let the stream continue.
      }
    };

    source.onerror = () => {
      // The browser will reconnect automatically. Keep this silent for now.
    };

    return () => {
      source.close();
    };
  }, [showToast, status]);

  return null;
}
