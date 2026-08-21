/**
 * Pipeline Execution Queue Coordinator
 * Ensures strict top-to-bottom execution order when timers overlap:
 * Step 1: 交易额过滤底池 (Volume Pool from Binance)
 * Step 2: 行情启动底池 (Start Trend Pool from Volume Pool)
 * Step 3: 大行情发现 (Major Trend Discovery from Start Trend Pool)
 */

type TaskId = 'volume_pool' | 'start_trend' | 'major_trend';

interface PipelineTask {
    id: TaskId;
    priority: number; // 1: highest (volume_pool), 2: start_trend, 3: major_trend
    fn: () => Promise<any>;
}

class PipelineCoordinator {
    private queue: PipelineTask[] = [];
    private isRunning: boolean = false;
    private runningTaskId: TaskId | null = null;

    public enqueue(id: TaskId, fn: () => Promise<any>) {
        const priority = id === 'volume_pool' ? 1 : id === 'start_trend' ? 2 : 3;

        // If task with same ID already in queue, replace with latest fn
        const existingIdx = this.queue.findIndex(t => t.id === id);
        if (existingIdx >= 0) {
            this.queue[existingIdx].fn = fn;
        } else {
            this.queue.push({ id, priority, fn });
        }

        // Sort queue by priority ascending (1 -> 2 -> 3)
        this.queue.sort((a, b) => a.priority - b.priority);

        this.processNext();
    }

    private async processNext() {
        if (this.isRunning || this.queue.length === 0) return;

        this.isRunning = true;
        const task = this.queue.shift();
        if (!task) {
            this.isRunning = false;
            return;
        }

        this.runningTaskId = task.id;
        try {
            console.log(`[PipelineQueue] Executing Step ${task.priority}: ${task.id}...`);
            await task.fn();
            console.log(`[PipelineQueue] Finished Step ${task.priority}: ${task.id}`);
        } catch (err) {
            console.error(`[PipelineQueue] Error in Step ${task.priority} (${task.id}):`, err);
        } finally {
            this.runningTaskId = null;
            this.isRunning = false;
            // Process next task in queue
            if (this.queue.length > 0) {
                setTimeout(() => this.processNext(), 50);
            }
        }
    }

    public isTaskRunning(id: TaskId): boolean {
        return this.runningTaskId === id;
    }
}

export const pipelineCoordinator = new PipelineCoordinator();
