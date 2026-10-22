import type { DesignHingeEvent, DesignHingeEventType } from "./eventTypes";
import type { InterventionOutcome } from "../policy/types";

export type EventStoreState = { events: DesignHingeEvent[] };

export function createEventStore(): EventStoreState {
  return { events: [] };
}

// Append-only: never mutates or drops prior events. deep_research.md stresses
// that intervention_eligible must be recorded even when nothing is shown, so
// "what if we hadn't intervened" stays comparable later (see replay/shadowMode.ts).
export function appendEvent(store: EventStoreState, event: DesignHingeEvent): EventStoreState {
  return { events: [...store.events, event] };
}

export function selectEventsByType<T extends DesignHingeEventType>(
  store: EventStoreState,
  type: T,
): Array<Extract<DesignHingeEvent, { type: T }>> {
  return store.events.filter((event): event is Extract<DesignHingeEvent, { type: T }> => event.type === type);
}

export function selectInterventionOutcome(store: EventStoreState, cardId: string): InterventionOutcome {
  const wasDelivered = store.events.some((event) => event.type === "intervention_delivered" && event.card.id === cardId);
  if (!wasDelivered) return "shadow_only";

  const wasAccepted = store.events.some((event) => event.type === "intervention_accepted" && event.cardId === cardId);
  if (wasAccepted) return "accepted";

  const wasDismissed = store.events.some((event) => event.type === "intervention_dismissed" && event.cardId === cardId);
  if (wasDismissed) return "dismissed";

  return "delivered";
}
