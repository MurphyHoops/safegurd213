
// Web Worker Code (Inline Blob)
// This runs in a separate thread and sends a 'tick' message every 100ms.
// Browser throttling affects workers much less than the main thread.
const workerCode = `
let intervalId;
self.onmessage = function(e) {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 100); 
  } else if (e.data === 'stop') {
    clearInterval(intervalId);
  }
};
`;

export class BackgroundTimer {
  private worker: Worker | null = null;
  private onTick: () => void;

  constructor(onTick: () => void) {
    this.onTick = onTick;
    try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        this.worker.onmessage = (e) => {
          if (e.data === 'tick') {
            this.onTick();
          }
        };
    } catch (e) {
        console.error("Worker creation failed, falling back to setInterval", e);
        // Fallback for environments that restrict blob workers (rare)
        setInterval(onTick, 100);
    }
  }

  start() {
    this.worker?.postMessage('start');
  }

  stop() {
    this.worker?.postMessage('stop');
  }
}
