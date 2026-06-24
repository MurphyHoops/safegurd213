type EventCallback = (payload?: any) => void;

class SystemEventBus {
    private listeners: Record<string, EventCallback[]> = {};

    subscribe(event: string, callback: EventCallback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);

        return () => {
            if (!this.listeners[event]) return;
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        };
    }

    emit(event: string, payload?: any) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(payload);
            } catch (err) {
                console.error(`[EventBus] Error in listener for event ${event}:`, err);
            }
        });
    }

    clear(event: string) {
        delete this.listeners[event];
    }
}

export const eventBus = new SystemEventBus();
