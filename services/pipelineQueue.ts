/**
 * Pipeline Execution Queue Coordinator - Channel-based Independent Pipelines
 * 确保各业务线各行其道、互不干扰、互不阻塞：
 * Channel 1: volume_pool (交易额过滤底池)
 * Channel 2: start_trend (行情启动底池)
 * Channel 3: major_trend (大行情发现)
 * 
 * 🔒 铁律保障：每个通道各自独立运行，启动底池扫描与大行情扫描各行其道，绝不互相排队阻塞死锁！
 */

export type TaskId = 'volume_pool' | 'start_trend' | 'major_trend';

class PipelineCoordinator {
    private runningTasks: Set<TaskId> = new Set();
    private pendingTasks: Map<TaskId, () => Promise<any>> = new Map();

    /**
     * 将任务加入指定独立通道，不同通道完全并发运行（各行其道）
     */
    public enqueue(id: TaskId, fn: () => Promise<any>) {
        // 如果该通道当前正在执行中，更新该通道的待执行任务为最新函数（保鲜），防止同一通道内部重入混乱
        if (this.runningTasks.has(id)) {
            this.pendingTasks.set(id, fn);
            return;
        }

        this.executeChannel(id, fn);
    }

    private async executeChannel(id: TaskId, fn: () => Promise<any>) {
        this.runningTasks.add(id);
        try {
            console.log(`[PipelineQueue] Executing independent track: ${id}...`);
            await fn();
            console.log(`[PipelineQueue] Finished independent track: ${id}`);
        } catch (err) {
            console.error(`[PipelineQueue] Error in track (${id}):`, err);
        } finally {
            this.runningTasks.delete(id);
            // 检查该通道是否有排队的最新待执行任务，若有则在微小间隔后平滑执行
            const nextFn = this.pendingTasks.get(id);
            if (nextFn) {
                this.pendingTasks.delete(id);
                setTimeout(() => this.executeChannel(id, nextFn), 50);
            }
        }
    }

    public isTaskRunning(id: TaskId): boolean {
        return this.runningTasks.has(id);
    }
}

export const pipelineCoordinator = new PipelineCoordinator();

