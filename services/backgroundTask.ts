
// Web Worker Code (Inline Blob)
// This runs in a separate thread and sends a 'tick' message every 1000ms (1s).
// Browser throttling affects workers much less than the main thread.
const workerCode = `
let intervalId;
self.onmessage = function(e) {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 500); 
  } else if (e.data === 'stop') {
    clearInterval(intervalId);
  }
};
`;

export class BackgroundTimer {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private onTick: () => void;
  private fallbackInterval: any = null;

  constructor(onTick: () => void) {
    this.onTick = onTick;
    try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = (e) => {
          if (e.data === 'tick') {
            this.onTick();
          }
        };
    } catch (e) {
        console.error("Worker creation failed, falling back to setInterval", e);
        // Fallback for environments that restrict blob workers
        this.fallbackInterval = setInterval(onTick, 500);
    }
  }

  start() {
    this.worker?.postMessage('start');
  }

  stop() {
    try {
      if (this.worker) {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.postMessage('stop');
        this.worker.terminate();
      }
    } catch (_) {}
    this.worker = null;
    if (this.workerUrl) {
      try {
        URL.revokeObjectURL(this.workerUrl);
      } catch (_) {}
      this.workerUrl = null;
    }
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
  }
}
