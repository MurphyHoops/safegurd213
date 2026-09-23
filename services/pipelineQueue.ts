/**
 * Pipeline Execution Queue Coordinator - Strict Sequential Pipeline
 * 严格按照流水线由上至下顺序单线执行，严禁【行情启动趋势】与【横盘蓄势/大行情】同时并发运行！
 * 
 * 顺序闭环：
 * 1. start_trend (行情启动底池扫描) -> 完成后生成底池并派发接力
 * 2. major_trend (横盘蓄势过滤 -> 回溯周期过滤) -> 完成后更新初筛并交回接力
 */

export type TaskId = 'volume_pool' | 'start_trend' | 'major_trend';

class PipelineCoordinator {
    private currentRunning: TaskId | null = null;
    private queue: { id: TaskId; fn: () => Promise<any> }[] = [];

    /**
     * 将任务加入顺序队列。如果当前有正在执行的流水线任务，排队等待上一阶段完成后依次执行。
     */
    public enqueue(id: TaskId, fn: () => Promise<any>) {
        // 如果队列中已有相同 id 的待执行任务，替换为最新函数以保持参数最新
        const existingIdx = this.queue.findIndex(item => item.id === id);
        if (existingIdx !== -1) {
            this.queue[existingIdx].fn = fn;
        } else {
            this.queue.push({ id, fn });
        }

        if (!this.currentRunning) {
            this.processNext();
        }
    }

    private async processNext() {
        if (this.queue.length === 0) {
            this.currentRunning = null;
            return;
        }

        const nextTask = this.queue.shift();
        if (!nextTask) {
            this.currentRunning = null;
            return;
        }

        this.currentRunning = nextTask.id;
        try {
            console.log(`[PipelineQueue] 正在按序执行流水线环节: ${nextTask.id}...`);
            await nextTask.fn();
            console.log(`[PipelineQueue] 流水线环节执行完毕: ${nextTask.id}`);
        } catch (err) {
            console.error(`[PipelineQueue] 流水线环节 (${nextTask.id}) 出现异常:`, err);
        } finally {
            this.currentRunning = null;
            // 稍作 50ms 缓冲后依次执行下一棒任务
            setTimeout(() => {
                this.processNext();
            }, 50);
        }
    }

    public isTaskRunning(id?: TaskId): boolean {
        if (id) return this.currentRunning === id;
        return this.currentRunning !== null;
    }

    public getCurrentRunning(): TaskId | null {
        return this.currentRunning;
    }
}

export const pipelineCoordinator = new PipelineCoordinator();

