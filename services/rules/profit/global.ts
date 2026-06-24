import { Position, AppSettings } from '../../../types';

/**
 * 检查全局止盈止损规则
 */
export function checkGlobalRules(
    positions: Position[],
    account: { totalBalance: number, marginBalance: number },
    settings: AppSettings,
    closeAll: (reason: string) => void
): boolean {
    const profitSettings = settings.profit;
    if (!profitSettings.enabled) return false;

    // 全局模式激活条件：主模式是 GLOBAL，或者并联开关 O 开启了 GLOBAL
    const isGlobalActive = profitSettings.profitMode === 'GLOBAL' || (profitSettings.oEnabledMap && profitSettings.oEnabledMap['GLOBAL']);
    if (!isGlobalActive) return false;

    const globalSettings = profitSettings.global;
    
    // 计算所有持仓的总未实现盈亏 (包括已启动对冲的仓位)
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    
    // 如果没有持仓，则不触发全局止盈止损
    if (positions.length === 0) return false;
    
    // 1. 全局止盈 (按金额)
    if (globalSettings.profitAmount > 0 && totalUnrealizedPnL >= globalSettings.profitAmount) {
        closeAll(`全局止盈触发: 总盈利 ${totalUnrealizedPnL.toFixed(2)} >= ${globalSettings.profitAmount}`);
        return true;
    }

    // 2. 全局止损 (按金额) - 注意 totalUnrealizedPnL 是负数
    if (globalSettings.lossAmount > 0 && totalUnrealizedPnL <= -globalSettings.lossAmount) {
        closeAll(`全局止损触发: 总亏损 ${totalUnrealizedPnL.toFixed(2)} <= -${globalSettings.lossAmount}`);
        return true;
    }

    // 3. 全局止盈 (按百分比 - 相对于余额)
    // 假设基准是 marginBalance (本金)
    if (account.marginBalance > 0) {
        const pnlPercent = (totalUnrealizedPnL / account.marginBalance) * 100;

        if (globalSettings.profitPercent > 0 && pnlPercent >= globalSettings.profitPercent) {
            closeAll(`全局止盈触发: 总盈率 ${pnlPercent.toFixed(2)}% >= ${globalSettings.profitPercent}%`);
            return true;
        }

        if (globalSettings.lossPercent > 0 && pnlPercent <= -globalSettings.lossPercent) {
            closeAll(`全局止损触发: 总亏率 ${pnlPercent.toFixed(2)}% <= -${globalSettings.lossPercent}%`);
            return true;
        }
    }

    return false;
}
