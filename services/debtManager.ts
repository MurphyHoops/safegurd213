/**
 * 🔒【原子化单币负债与砍仓防重复管理引擎】(Atomic Debt Manager)
 * 
 * 核心铁律：
 * 1. 砍仓过后的亏损金额记入“负债”账单，【只记入一次】，绝不得重复记入！
 * 2. 无论币安官方实盘轮询对账多少次、无论单笔订单包含多少个分笔成交 (Fills)、
 *    无论经历何种状态机转移，单笔砍仓的亏损金额严格且仅有一次记入机会。
 * 3. 权威流水去重核算：以当前对冲周期内真实的平仓/砍仓流水（按 orderId / 流水 ID 去重）为唯一事实依据，
 *    自动识别并纠偏历史脏数据与重复叠加污染。
 * 
 * @LOCKED: 每一个最小代码结构已全域严格锁定，严禁擅自修改！
 */

import { Position, TradeLog } from '../types';
import { normalizeSymbol } from './symbolUtils';

export class DebtManager {
    private static instance: DebtManager;

    // 🔒【负债记入防重注册表】已记入负债的砍仓订单与流水 Key 集合，确保单笔订单绝对只记入一次
    private processedDebtOrderKeys: Set<string> = new Set();

    // 🔒【单币周期封存时间戳登记表】记录币种最近一次解套盈利清仓或盈利平仓的封存时间
    // 任何发生在此时间点之前的历史止损/砍仓数据一律物理隔离封存，绝对严禁被新一轮开仓负债关联！
    private cycleSealedTimestamps: Map<string, number> = new Map();

    private constructor() {}

    public static getInstance(): DebtManager {
        if (!DebtManager.instance) {
            DebtManager.instance = new DebtManager();
        }
        return DebtManager.instance;
    }

    /**
     * 🔒【核心封存接口】：盈利平仓或解套盈利清仓后，将该币种之前的所有止损/对冲数据全部物理封存
     * 记录该币种的封存截断时间，并将已有历史流水标记为 cycle_sealed = true
     */
    public sealSymbolCycle(symbol: string, tradeLogs?: TradeLog[]): void {
        const cleanSym = normalizeSymbol(symbol);
        const sealTime = Date.now();
        this.cycleSealedTimestamps.set(cleanSym, sealTime);

        // 如果传入了流水数组，将该币种在此之前产生的所有 CLOSED 流水全部标记为已封存
        if (Array.isArray(tradeLogs)) {
            for (const log of tradeLogs) {
                if (normalizeSymbol(log.symbol) === cleanSym) {
                    log.cycle_sealed = true;
                }
            }
        }
        console.log(`[DebtManager] 🔒 周期数据已封存: ${cleanSym} 封存时间点: ${sealTime}，前序所有止损数据已归档，新一轮开仓负债完全隔离！`);
    }

    /**
     * 获取指定币种最近一次周期封存时间戳
     */
    public getCycleSealedTimestamp(symbol: string): number {
        const cleanSym = normalizeSymbol(symbol);
        return this.cycleSealedTimestamps.get(cleanSym) || 0;
    }

    /**
     * 检查订单是否已被计入负债
     */
    public isDebtOrderProcessed(orderId: string | number): boolean {
        if (!orderId) return false;
        return this.processedDebtOrderKeys.has(String(orderId));
    }

    /**
     * 标记订单已被计入负债
     */
    public markDebtOrderProcessed(orderId: string | number): void {
        if (orderId) {
            this.processedDebtOrderKeys.add(String(orderId));
        }
    }

    /**
     * 清空负债订单注册表（在用户点击清空全部流水时物理重置）
     */
    public clearDebtRegistry(): void {
        this.processedDebtOrderKeys.clear();
    }

    /**
     * 🔒【砍仓亏损记入 - 只记入一次铁律】
     * 仅当订单尚未被计入时，才执行累加；已处理过的订单立即拦截，严禁二次叠加。
     * 
     * @returns boolean true 表示本次成功记入，false 表示此前已记入过（防重拦截）
     */
    public recordAmputationLoss(
        symbol: string,
        lossAmount: number,
        orderId: string,
        positions: Position[]
    ): boolean {
        if (lossAmount <= 0) return false;
        const cleanOrderId = String(orderId || '');

        if (cleanOrderId && this.processedDebtOrderKeys.has(cleanOrderId)) {
            // 已记录过，彻底拦截
            return false;
        }

        if (cleanOrderId) {
            this.processedDebtOrderKeys.add(cleanOrderId);
        }

        const cleanSym = normalizeSymbol(symbol);
        const activePositions = positions.filter(p => normalizeSymbol(p.symbol) === cleanSym);

        const absLoss = Math.abs(lossAmount);
        for (const p of activePositions) {
            p.cumulativeAmputationLoss = (p.cumulativeAmputationLoss || 0) + absLoss;
        }

        return true;
    }

    /**
     * 🔒【权威单币累计负债核算与自动纠偏引擎】
     * 砍仓过后的亏损金额记入“负债”账单，【只记入一次】，不得重复记入！
     * 严格根据当前对冲生命周期内真实已执行的砍仓/断臂流水（按 orderId / 流水 ID 精确去重）计算唯一真实的累计砍仓负债，
     * 坚决剔除任何因历史轮询或多分笔重复累加导致的虚高污染。
     * 
     * @returns number 当前计算得出的真实累计负债 (USDT)
     */
    public recalculateSymbolAmputationDebt(
        symbol: string,
        positions: Position[],
        tradeLogs: TradeLog[],
        onCalibrateLog?: (msg: string) => void
    ): number {
        const cleanSym = normalizeSymbol(symbol);
        const activePositions = positions.filter(p => normalizeSymbol(p.symbol) === cleanSym);
        if (activePositions.length === 0) return 0;

        const isSymbolUnderActiveHedge = activePositions.some(p => 
            p.isHedged || !!p.mainPositionId || (p.isAmputated && (p.amputatedAmount || 0) > 0) || (p.cumulativeAmputationLoss || 0) > 0 || (p.cumulativeHedgeLoss || 0) > 0 || (p.amputationCount || 0) > 0
        );
        if (!isSymbolUnderActiveHedge) {
            for (const p of activePositions) {
                p.cumulativeAmputationLoss = 0;
            }
            return 0;
        }

        // 🔒 [周期起始时间铁律] 必须以当前存活仓位的最早入场时间 (entryTime) 作为周期基准，
        // 绝不可使用 latest lastAmputationTime，否则多次砍仓时后续砍仓会把此前所有砍仓记录过滤剔除！
        const activeEntryTimes = activePositions
            .map(p => p.backtestEntryTime || p.entryTime || 0)
            .filter(t => t > 0);
        const cycleStartTime = activeEntryTimes.length > 0 ? Math.min(...activeEntryTimes) : 0;

        // 🔒 [周期封存隔离铁律] 获取最近一次解套盈利清仓/盈利平仓的封存时间戳
        const sealedCutoff = this.getCycleSealedTimestamp(cleanSym);

        // 收集该币种在当前对冲生命周期内所有属于砍仓/断臂/减仓止损的真实流水记录
        // 关键改动：必须严格过滤掉任何在封存时间点之前的旧数据，以及已标记 cycle_sealed 的流水！
        const relevantCutLogs = tradeLogs.filter(l => 
            normalizeSymbol(l.symbol) === cleanSym &&
            l.status === 'CLOSED' &&
            !l.cycle_sealed && // 严禁读取已被封存的上一轮流水
            (l.profit_usdt || 0) < 0 &&
            (
                l.exit_reason?.includes('砍仓') || 
                l.exit_reason?.includes('断臂') || 
                l.exit_reason?.includes('减仓') ||
                l.exit_reason?.includes('止损') ||
                l.is_hedge ||
                l.events?.some(e => e.action?.includes('砍仓') || e.action?.includes('断臂') || e.action?.includes('减仓') || e.action?.includes('止损'))
            ) &&
            (sealedCutoff === 0 || ((l.exit_timestamp || l.entry_timestamp || 0) > sealedCutoff)) && // 严禁读取封存时间点之前的记录
            (cycleStartTime === 0 || (l.exit_timestamp || l.entry_timestamp || 0) >= cycleStartTime - 300000)
        );

        // 🔒 按 orderId / entry_id 严格唯一去重，每笔订单/砍仓流水只计算一次真实的已实现亏损，并将多次砍仓完整累加！
        const seenOrders = new Set<string>();
        let trueTotalLoss = 0;

        for (const log of relevantCutLogs) {
            const uniqueKey = log.binance_order_id ? String(log.binance_order_id) : (log.entry_id || `${log.symbol}_${log.exit_timestamp}`);
            if (uniqueKey && !seenOrders.has(uniqueKey)) {
                seenOrders.add(uniqueKey);
                trueTotalLoss += Math.abs(log.profit_usdt || 0);
            }
        }

        // 四舍五入保留4位小数，避免浮点累积
        trueTotalLoss = Math.round(trueTotalLoss * 10000) / 10000;

        const currentOldMax = Math.max(0, ...activePositions.map(p => p.cumulativeAmputationLoss || 0));
        let finalLoss = trueTotalLoss;

        if (trueTotalLoss === 0 && currentOldMax > 0) {
            // 流水尚未完成同步或正在对账中，保全内存中已记录的累计砍仓亏损
            finalLoss = currentOldMax;
        } else if (trueTotalLoss > 0 && currentOldMax > trueTotalLoss * 3 + 10) {
            // 如果旧持仓上的负债值显著成倍高于真实流水去重总和（典型如 1630.76 vs 0.76 的重复记入污染），则纠偏
            if (onCalibrateLog) {
                onCalibrateLog(
                    `🛡️ [负债账单校准] 剔除重复记入污染: ${cleanSym} 负债已从异常值 ${currentOldMax.toFixed(2)} USDT 精准校准为真实砍仓亏损: ${trueTotalLoss.toFixed(2)} USDT (只记入一次)`
                );
            }
            finalLoss = trueTotalLoss;
        } else {
            // 正常情况下取流水真实累加值与内存最大值的合理上限，确保每一次砍仓亏损均100%累计
            finalLoss = Math.max(trueTotalLoss, currentOldMax);
        }

        finalLoss = Math.round(finalLoss * 10000) / 10000;

        // 校准并同步给该币种的所有活动持仓，确保双方一致且累计亏损完整
        for (const p of activePositions) {
            p.cumulativeAmputationLoss = finalLoss;
        }

        return finalLoss;
    }
}

export const debtManager = DebtManager.getInstance();
