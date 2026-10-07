// 🔒 LOCKED_MODULE: LIST 1 [市场初筛列表 - 原子差量增删更新引擎]
// @LOCKED: 严格原子化锁定。未经用户明确的专属书面指令，严禁擅自修改、重构或变动任何算法与流转逻辑。

export interface DiffSyncResult {
    previousCandidates: string[];
    newCandidates: string[];
    added: string[];
    removed: string[];
    retained: string[];
    finalSet: Set<string>;
    matchedUniqueCount: number;
}

/**
 * 严格按当前启用的做多/做空方向统计符合条件的唯一币种数量
 * 绝不因多空双向标签翻倍，确保显示数字与初筛列表 100% 绝对一致
 */
export function getMatchedUniqueSymbolsCount(
    symbolsSet: Set<string>,
    enableLong: boolean,
    enableShort: boolean
): number {
    const uniqueSet = new Set<string>();
    symbolsSet.forEach(cand => {
        const sym = cand.replace('_LONG', '').replace('_SHORT', '');
        const hasL = symbolsSet.has(`${sym}_LONG`) || symbolsSet.has(sym);
        const hasS = symbolsSet.has(`${sym}_SHORT`) || symbolsSet.has(sym);
        if (enableLong && enableShort) {
            if (hasL || hasS) uniqueSet.add(sym);
        } else if (enableLong) {
            if (hasL) uniqueSet.add(sym);
        } else if (enableShort) {
            if (hasS) uniqueSet.add(sym);
        }
    });
    return uniqueSet.size;
}

/**
 * 执行市场初筛列表原子差量比对计算
 * 规则铁律：
 * 1. 永不清零、纯差量对比增删 Diff 机制；
 * 2. 如果新过滤结果减少了，初筛列表精准减去少的那一个/几个；
 * 3. 如果新过滤结果增加了，初筛列表精准加上多的那一个/几个；
 * 4. 既有依然符合的币种保持平稳，一次性完成原子差量对齐更新！
 */
export function computeCandidatesDiff(
    previousCandidates: string[],
    newPassedSymbols: Set<string>,
    enableLong: boolean,
    enableShort: boolean
): DiffSyncResult {
    const prevSet = new Set(previousCandidates);
    const newCandidates = Array.from(newPassedSymbols);
    const newSet = new Set(newCandidates);

    const added = newCandidates.filter(x => !prevSet.has(x));
    const removed = previousCandidates.filter(x => !newSet.has(x));
    const retained = previousCandidates.filter(x => newSet.has(x));

    const finalSet = new Set(newCandidates);
    const matchedUniqueCount = getMatchedUniqueSymbolsCount(finalSet, enableLong, enableShort);

    return {
        previousCandidates,
        newCandidates,
        added,
        removed,
        retained,
        finalSet,
        matchedUniqueCount
    };
}
