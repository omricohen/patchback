/** Minimal typed event emitter (no dependencies). */
export type WidgetEventMap = {
  submitted: { feedbackId: string; jobId: string };
  statusChange: { jobId: string; state: string };
  error: { error: unknown };
};

export type WidgetEventName = keyof WidgetEventMap;

export interface Emitter {
  on<E extends WidgetEventName>(
    event: E,
    listener: (payload: WidgetEventMap[E]) => void,
  ): () => void;
  emit<E extends WidgetEventName>(event: E, payload: WidgetEventMap[E]): void;
  clear(): void;
}

export function createEmitter(): Emitter {
  const listeners = new Map<WidgetEventName, Set<(payload: never) => void>>();
  return {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: never) => void);
      listeners.set(event, set);
      return () => {
        set.delete(listener as (payload: never) => void);
      };
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        try {
          (listener as (p: typeof payload) => void)(payload);
        } catch {
          // Listener errors never break the widget.
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
