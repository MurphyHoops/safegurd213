import React, { useState, useEffect } from 'react';
import { Layers, Trash2, RefreshCw, ChevronDown, Database, AlertCircle, FolderTree } from 'lucide-react';
import { deepCleanAndResetSystem, logger } from '../services/monitor/monitorService';
import { priceRegistry } from '../services/priceRegistry';

interface ModuleDomStat {
    id: string;
    name: string;
    selector: string;
    count: number;
    color: string;
}

interface List1SubmoduleStat {
    id: string;
    name: string;
    count: number;
    color: string;
    desc: string;
}

interface CacheDatabaseStat {
    key: string;
    name: string;
    sizeStr: string;
    itemCount: number;
    type: 'MEMORY' | 'STORAGE' | 'DOM';
}

interface DomHistoryRecord {
    timestamp: number;
    timeStr: string;
    totalNodes: number;
    highestModule: string;
    highestCount: number;
    status: 'NORMAL' | 'WARN' | 'DANGER';
}

export const DomTrackerWidget: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'LIST1_DEEP_DIVE' | 'CACHE_DB' | 'HISTORY'>('OVERVIEW');
    const [totalNodes, setTotalNodes] = useState<number>(0);
    const [moduleStats, setModuleStats] = useState<ModuleDomStat[]>([]);
    const [list1Substats, setList1Substats] = useState<List1SubmoduleStat[]>([]);
    const [cacheDbStats, setCacheDbStats] = useState<CacheDatabaseStat[]>([]);
    const [historyLogs, setHistoryLogs] = useState<DomHistoryRecord[]>([]);
    const [lastCleanTime, setLastCleanTime] = useState<string>('未清理');

    const sampleDom = () => {
        if (typeof document === 'undefined') return;
        
        const total = document.getElementsByTagName('*').length;
        setTotalNodes(total);

        // 1. Overall Main Modules
        const list1Count = document.querySelectorAll('#module-list1 *').length;
        const list2Count = document.querySelectorAll('#module-list2 *').length;
        const list3Count = document.querySelectorAll('#module-list3 *').length;
        const list4Count = document.querySelectorAll('#module-list4 *').length;
        const battlefieldCount = document.querySelectorAll('#module-battlefield *').length;
        const commandCount = document.querySelectorAll('#module-command *').length;
        const logsCount = document.querySelectorAll('#module-system-logs *, #module-system-monitor *').length;

        const mainStats: ModuleDomStat[] = [
            { id: 'module-list1', name: 'List 1 全域初筛', selector: '#module-list1 *', count: list1Count, color: 'text-indigo-400' },
            { id: 'module-list2', name: 'List 2 大十字星/发散', selector: '#module-list2 *', count: list2Count, color: 'text-blue-400' },
            { id: 'module-list3', name: 'List 3 结构审计', selector: '#module-list3 *', count: list3Count, color: 'text-purple-400' },
            { id: 'module-list4', name: 'List 4 动能突破', selector: '#module-list4 *', count: list4Count, color: 'text-amber-400' },
            { id: 'module-battlefield', name: 'List 5 战场实况', selector: '#module-battlefield *', count: battlefieldCount, color: 'text-emerald-400' },
            { id: 'module-command', name: 'List 6 战术终端', selector: '#module-command *', count: commandCount, color: 'text-cyan-400' },
            { id: 'module-system-logs', name: '系统运行日志/黑匣子', selector: '#module-system-logs *', count: logsCount, color: 'text-rose-400' }
        ];

        const accountedSum = mainStats.reduce((acc, curr) => acc + curr.count, 0);
        const globalBaseCount = Math.max(0, total - accountedSum);
        mainStats.push({
            id: 'module-global-base',
            name: '全局框架/弹窗/其他组件',
            selector: 'other',
            count: globalBaseCount,
            color: 'text-slate-400'
        });
        setModuleStats(mainStats);

        // 2. List 1 Deep-Dive Submodules & Pool Boxes (Exact Nesting Math)
        const list1ItemCount = document.querySelectorAll('#submodule-list1-items *').length;
        const rawFilterContainerCount = document.querySelectorAll('#submodule-filter-section *').length;
        
        const startTrendCount = document.querySelectorAll('#submodule-start-trend *').length;
        const volumePoolCount = document.querySelectorAll('#submodule-volume-pool *').length;
        const sidewaysPoolCount = document.querySelectorAll('#submodule-sideways-pool *').length;
        const lookbackPoolCount = document.querySelectorAll('#submodule-lookback-pool *').length;
        const antiChasePoolCount = document.querySelectorAll('#submodule-antichase-pool *').length;
        const breakoutPoolCount = document.querySelectorAll('#submodule-breakout-pool *').length;
        const majorTrendCount = document.querySelectorAll('#submodule-majortrend-pool *').length;

        // Correct nested math: filter container includes all the inner pool boxes
        const poolBoxesSum = startTrendCount + volumePoolCount + sidewaysPoolCount + lookbackPoolCount + antiChasePoolCount + breakoutPoolCount + majorTrendCount;
        const pureFilterControlsCount = Math.max(0, rawFilterContainerCount - poolBoxesSum);
        
        const list1SubSum = list1ItemCount + rawFilterContainerCount;
        const list1HeaderFrameCount = Math.max(0, list1Count - list1SubSum);

        const subStats: List1SubmoduleStat[] = [
            { id: 'volume', name: '📊 成交额过滤底池 (VolumePoolBox)', count: volumePoolCount, color: 'text-purple-300', desc: '成交额筛选候选池卡片与列表节点' },
            { id: 'sideways', name: '🧱 横盘蓄势/爆破底池 (SidewaysPoolBox)', count: sidewaysPoolCount, color: 'text-amber-300', desc: '横盘突破候选池卡片与控件节点' },
            { id: 'start-trend', name: '🚀 行情启动趋势底池 (StartTrendPoolBox)', count: startTrendCount, color: 'text-blue-300', desc: '扫描起爆点候选列表与弹窗节点' },
            { id: 'lookback', name: '⏳ 回溯周期底池 (LookbackPoolBox)', count: lookbackPoolCount, color: 'text-cyan-300', desc: '过往突破候选列表卡片节点' },
            { id: 'items', name: '🏁 通关候选卡片列表 (List1Item)', count: list1ItemCount, color: 'text-rose-400', desc: ' List 1 通关候选币卡片（单卡片约含 35 个 DOM）' },
            { id: 'antichase', name: '🛡️ 初筛极值拦截底池 (AntiChasePoolBox)', count: antiChasePoolCount, color: 'text-emerald-300', desc: '追高防冲熔断拦截候选卡片节点' },
            { id: 'breakout', name: '⚡ 5K 突破推进底池 (BreakoutPoolBox)', count: breakoutPoolCount, color: 'text-pink-300', desc: '5K 爆发推进候选池卡片节点' },
            { id: 'majortrend', name: '📈 大周期趋势底池 (MajorTrendSection)', count: majorTrendCount, color: 'text-violet-300', desc: '日线/大周期趋势筛选面板节点' },
            { id: 'filter-controls', name: '⚙️ 常规选币模式配置面板 (FilterSection)', count: pureFilterControlsCount, color: 'text-indigo-300', desc: '多空选择、涨跌幅、成交额阈值控制组件' },
            { id: 'header-frame', name: '🖼️ 头部标题/搜币框/排序工具栏', count: list1HeaderFrameCount, color: 'text-slate-400', desc: 'List 1 顶部固定框架与多重排序栏节点' }
        ].sort((a, b) => b.count - a.count); // Highest node counts rendered first
        
        setList1Substats(subStats);

        // 3. Cache Database & Memory Audit
        const dbStats: CacheDatabaseStat[] = [];
        try {
            const rawSnap = localStorage.getItem('SCANNER_RAW_DATA') || '';
            let rawCount = 0;
            try { rawCount = JSON.parse(rawSnap).length || 0; } catch (_) {}
            dbStats.push({
                key: 'SCANNER_RAW_DATA',
                name: '24H 全行情快照数据库',
                sizeStr: `${(rawSnap.length / 1024).toFixed(1)} KB`,
                itemCount: rawCount,
                type: 'STORAGE'
            });

            const vol8am = localStorage.getItem('SAVIOR_VOLUME_8AM_CACHE') || '';
            let volCount = 0;
            try { volCount = Object.keys(JSON.parse(vol8am)).length || 0; } catch (_) {}
            dbStats.push({
                key: 'SAVIOR_VOLUME_8AM_CACHE',
                name: '早上 8 点起成交额缓存库',
                sizeStr: `${(vol8am.length / 1024).toFixed(1)} KB`,
                itemCount: volCount,
                type: 'STORAGE'
            });

            const l2map = localStorage.getItem('SCANNER_LIST2_CACHE_MAP') || '';
            const l3map = localStorage.getItem('SCANNER_LIST3_CACHE_MAP') || '';
            const l4map = localStorage.getItem('SCANNER_LIST4_CACHE_MAP') || '';
            const totalMapBytes = l2map.length + l3map.length + l4map.length;
            dbStats.push({
                key: 'SCANNER_CANDIDATE_CACHE_MAPS',
                name: 'List 2/3/4 候选流与多周期缓存 Map',
                sizeStr: `${(totalMapBytes / 1024).toFixed(1)} KB`,
                itemCount: 3,
                type: 'STORAGE'
            });

            let dailyKlineCount = 0;
            if (typeof window !== 'undefined' && (window as any).__DAILY_KLINE_CACHE__) {
                dailyKlineCount = Object.keys((window as any).__DAILY_KLINE_CACHE__).length;
            }
            dbStats.push({
                key: '__DAILY_KLINE_CACHE__',
                name: '日线历史 K 线内存数据库',
                sizeStr: '内存常驻',
                itemCount: dailyKlineCount,
                type: 'MEMORY'
            });

            const registryStats = priceRegistry.getRegistryStats();
            dbStats.push({
                key: 'PRICE_REGISTRY_DOM_BYPASS',
                name: 'DOM Bypass 价格/盈亏高速注册表',
                sizeStr: `${registryStats.totalPriceRegistered + registryStats.totalPnlRegistered} 绑定`,
                itemCount: registryStats.totalPriceRegistered + registryStats.totalPnlRegistered,
                type: 'DOM'
            });

        } catch (_) {}
        setCacheDbStats(dbStats);

        // Find highest main module
        const highest = [...mainStats].filter(s => s.id !== 'module-global-base').sort((a, b) => b.count - a.count)[0];
        const now = Date.now();
        const timeStr = new Date(now).toLocaleTimeString([], { hour12: false });
        
        let status: 'NORMAL' | 'WARN' | 'DANGER' = 'NORMAL';
        if (total > 25000 || (highest && highest.count > 10000)) {
            status = 'DANGER';
        } else if (total > 15000 || (highest && highest.count > 6000)) {
            status = 'WARN';
        }

        setHistoryLogs(prev => {
            const last = prev[0];
            if (!last || (now - last.timestamp >= 30000) || Math.abs(total - last.totalNodes) > 1000) {
                const newRec: DomHistoryRecord = {
                    timestamp: now,
                    timeStr,
                    totalNodes: total,
                    highestModule: highest ? highest.name : '无',
                    highestCount: highest ? highest.count : 0,
                    status
                };
                return [newRec, ...prev].slice(0, 30);
            }
            return prev;
        });

        if (status === 'DANGER' && (!historyLogs[0] || historyLogs[0].status !== 'DANGER')) {
            logger.warn('DOM_SHIELD', `🚨 DOM 节点过高预警 (${total} 节点), List 1 节点: ${list1Count}`);
        }
    };

    useEffect(() => {
        sampleDom();
        const interval = setInterval(sampleDom, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleCleanDOM = () => {
        const res = deepCleanAndResetSystem();
        setLastCleanTime(new Date().toLocaleTimeString([], { hour12: false }));
        sampleDom();
        alert(`🧹 DOM 清理与防爆重置完成！已释放 ${res.freedItems} 项冗余数据与游离 DOM 节点。`);
    };

    const handleCollapseList1Cards = () => {
        window.dispatchEvent(new CustomEvent('savior_cap_list1_limit', { detail: { limit: 40 } }));
        setTimeout(sampleDom, 500);
        alert('⚡ 已指示 List 1 前台收起至前 40 项卡片！后台全量并发计算与策略推送不受任何影响。');
    };

    const getStatusBadge = () => {
        if (totalNodes > 25000) {
            return {
                bg: 'bg-red-950/80 border-red-500/60 text-red-400 animate-pulse',
                label: `💥 DOM 超标 (${totalNodes.toLocaleString()})`,
                dot: 'bg-red-500'
            };
        }
        if (totalNodes > 15000) {
            return {
                bg: 'bg-amber-950/70 border-amber-500/50 text-amber-300',
                label: `⚠️ DOM 较高 (${totalNodes.toLocaleString()})`,
                dot: 'bg-amber-400'
            };
        }
        return {
            bg: 'bg-slate-900/90 border-slate-700/80 text-cyan-300 hover:border-slate-600',
            label: `🧠 DOM: ${totalNodes.toLocaleString()}`,
            dot: 'bg-emerald-400'
        };
    };

    const badgeStyle = getStatusBadge();
    const list1TotalDom = moduleStats.find(s => s.id === 'module-list1')?.count || 0;
    const topSubstat = list1Substats[0];
    const topSubPercent = list1TotalDom > 0 && topSubstat ? Math.round((topSubstat.count / list1TotalDom) * 100) : 0;

    return (
        <div className="relative inline-block text-left">
            {/* Header Badge Trigger */}
            <button
                type="button"
                onClick={() => {
                    sampleDom();
                    setIsOpen(!isOpen);
                }}
                className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer select-none ${badgeStyle.bg}`}
                title="点击查看各模块及 List 1 内部嵌套子目录 DOM 归因诊断"
            >
                <span className={`w-2 h-2 rounded-full ${badgeStyle.dot}`} />
                <span>{badgeStyle.label}</span>
                <ChevronDown size={11} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Diagnostic Panel Dropdown */}
            {isOpen && (
                <div 
                    className="absolute top-full left-0 mt-1.5 w-[540px] bg-[#0d1017] border border-slate-700 rounded-lg shadow-2xl z-[9999] p-3 text-slate-300 font-mono text-[10px] space-y-3 animate-in fade-in zoom-in-95 duration-150"
                    style={{ zIndex: 9999 }}
                >
                    {/* Panel Header */}
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                            <Layers size={14} className="text-cyan-400" />
                            <span className="font-bold text-white text-[11px]">DOM 节点归因诊断与嵌套子目录大盘</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={handleCleanDOM}
                                className="px-2 py-0.5 rounded bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/50 text-[9px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                                <Trash2 size={10} /> 深度清理/释放 DOM
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="text-slate-500 hover:text-white px-1 cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Tab Switcher */}
                    <div className="flex items-center gap-1 border-b border-slate-800 pb-1.5 text-[9px]">
                        <button
                            type="button"
                            onClick={() => setActiveTab('OVERVIEW')}
                            className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${activeTab === 'OVERVIEW' ? 'bg-cyan-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                        >
                            📊 整体 6 级流水线概览
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('LIST1_DEEP_DIVE')}
                            className={`px-2 py-1 rounded font-bold transition-all cursor-pointer flex items-center gap-1 ${activeTab === 'LIST1_DEEP_DIVE' ? 'bg-indigo-600 text-white' : 'bg-indigo-950/40 text-indigo-300 border border-indigo-500/30'}`}
                        >
                            <FolderTree size={10} /> 📂 List 1 嵌套子目录拆解
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('CACHE_DB')}
                            className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${activeTab === 'CACHE_DB' ? 'bg-purple-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                        >
                            💾 缓存数据库存储
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('HISTORY')}
                            className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${activeTab === 'HISTORY' ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                        >
                            ⏱️ 采样日志
                        </button>
                    </div>

                    {/* TAB 1: OVERVIEW */}
                    {activeTab === 'OVERVIEW' && (
                        <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2 bg-slate-900/80 p-2 rounded border border-slate-800 text-[9.5px]">
                                <div>
                                    <span className="text-slate-500 block">全域 DOM 总节点</span>
                                    <span className={`font-bold text-xs ${totalNodes > 20000 ? 'text-red-400 font-black' : 'text-cyan-300'}`}>
                                        {totalNodes.toLocaleString()} 节点
                                    </span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">最高占比模块</span>
                                    <span className="font-bold text-slate-200 truncate block">
                                        {[...moduleStats].filter(s => s.id !== 'module-global-base').sort((a,b) => b.count - a.count)[0]?.name || '--'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-slate-500 block">上次释放重置</span>
                                    <span className="font-bold text-emerald-400">{lastCleanTime}</span>
                                </div>
                            </div>

                            <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold">
                                <span>6 级选币流水线 DOM 分布</span>
                                <button onClick={sampleDom} className="text-cyan-400 hover:underline flex items-center gap-0.5 cursor-pointer">
                                    <RefreshCw size={9} /> 刷新
                                </button>
                            </div>
                            <div className="space-y-1.5 max-h-[210px] overflow-y-auto custom-scrollbar pr-1">
                                {moduleStats.map((stat) => {
                                    const percent = totalNodes > 0 ? Math.round((stat.count / totalNodes) * 100) : 0;
                                    const isHeavy = percent >= 50;
                                    return (
                                        <div key={stat.id} className="bg-slate-900/50 p-1.5 rounded border border-slate-800/80 space-y-1">
                                            <div className="flex items-center justify-between text-[9px]">
                                                <span className={`font-bold ${stat.color} flex items-center gap-1`}>
                                                    {stat.name}
                                                    {isHeavy && <span className="px-1 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-800/40 text-[7px] font-bold">高占比 ({percent}%)</span>}
                                                </span>
                                                <span className="text-slate-300 font-mono">
                                                    <strong className="text-white">{stat.count.toLocaleString()}</strong> 节点 ({percent}%)
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full transition-all duration-300 ${isHeavy ? 'bg-rose-500' : 'bg-cyan-500'}`}
                                                    style={{ width: `${Math.min(100, percent)}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* TAB 2: LIST 1 NESTED SUB-DIRECTORY DEEP DIVE */}
                    {activeTab === 'LIST1_DEEP_DIVE' && (
                        <div className="space-y-2">
                            {/* Expert Conclusion Box */}
                            <div className="p-2 rounded bg-indigo-950/70 border border-indigo-500/50 space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-indigo-200 text-[10px] flex items-center gap-1">
                                        <AlertCircle size={12} className="text-amber-400" />
                                        🎯 List 1 内部嵌套子目录 DOM 精准归因结论：
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleCollapseList1Cards}
                                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[8.5px] font-bold transition-colors cursor-pointer shadow"
                                    >
                                        ⚡ 一键优化：前台收起至前40项
                                    </button>
                                </div>
                                <p className="text-slate-300 text-[9px] leading-relaxed">
                                    对 List 1 内部展开后，当前占用最多的具体地方是：<strong className="text-amber-300 font-bold">{topSubstat?.name} ({topSubstat?.count.toLocaleString()} 节点，占 List 1 的 {topSubPercent}%)</strong>！底池中展开渲染了大量候选币，每张候选币展示行含数据数字与小按钮，从而产生了巨量 DOM 节点。
                                </p>
                            </div>

                            <div className="text-[9px] text-slate-400 font-bold flex justify-between items-center border-b border-slate-800/80 pb-1">
                                <span className="flex items-center gap-1 text-white">
                                    <FolderTree size={11} className="text-indigo-400" /> 📂 List 1 内部 10 个子目录/底池组件节点树：
                                </span>
                                <span className="text-indigo-300 font-mono">List 1 总 DOM: {list1TotalDom.toLocaleString()} 节点</span>
                            </div>

                            <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                                {list1Substats.map((sub, idx) => {
                                    const percentOfList1 = list1TotalDom > 0 ? Math.round((sub.count / list1TotalDom) * 100) : 0;
                                    const isTop = idx === 0 && sub.count > 0;
                                    return (
                                        <div key={sub.id} className={`p-1.5 rounded border space-y-1 transition-all ${isTop ? 'bg-amber-950/30 border-amber-500/50' : 'bg-slate-900/60 border-slate-800'}`}>
                                            <div className="flex items-center justify-between text-[9px]">
                                                <div>
                                                    <span className={`font-bold ${sub.color} flex items-center gap-1`}>
                                                        <span className="text-slate-600 font-normal">├──</span>
                                                        {sub.name}
                                                        {isTop && <span className="px-1 py-0.2 rounded bg-amber-500 text-black text-[7.5px] font-black">🔥 占用大头 ({percentOfList1}%)</span>}
                                                    </span>
                                                    <span className="text-slate-500 text-[8px] pl-4 block">{sub.desc}</span>
                                                </div>
                                                <div className="text-right shrink-0 ml-2 font-mono">
                                                    <strong className={`text-[10px] ${isTop ? 'text-amber-300 font-black' : 'text-white'}`}>{sub.count.toLocaleString()}</strong> 节点 ({percentOfList1}%)
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-800/80 h-1 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full transition-all duration-300 ${isTop ? 'bg-amber-400' : 'bg-indigo-400'}`}
                                                    style={{ width: `${Math.min(100, percentOfList1)}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: CACHE DATABASE AUDIT */}
                    {activeTab === 'CACHE_DB' && (
                        <div className="space-y-2">
                            <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[9px] text-slate-400 leading-relaxed">
                                💡 <b>底层缓存数据库说明</b>：以下为 List 1 相关的离线快照库、日线数据库与 DOM Bypass 注册表。这些数据库保存在浏览器 LocalStorage 和 V8 堆内存中，即使存储数万行行情报文，也不会增加网页上的 DOM 节点数。
                            </div>

                            <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                                {cacheDbStats.map((db) => (
                                    <div key={db.key} className="p-2 rounded bg-slate-900/80 border border-slate-800 flex items-center justify-between text-[9px]">
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-1.5">
                                                <Database size={10} className="text-purple-400" />
                                                <span className="font-bold text-white">{db.name}</span>
                                                <span className={`px-1 py-0.2 rounded text-[7.5px] font-bold ${db.type === 'STORAGE' ? 'bg-blue-950 text-blue-300 border border-blue-800/40' : db.type === 'MEMORY' ? 'bg-purple-950 text-purple-300 border border-purple-800/40' : 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'}`}>
                                                    {db.type}
                                                </span>
                                            </div>
                                            <span className="text-slate-500 font-mono text-[8px] block">Key: {db.key}</span>
                                        </div>
                                        <div className="text-right font-mono">
                                            <span className="text-purple-300 font-bold block">{db.sizeStr}</span>
                                            <span className="text-slate-400 text-[8px]">{db.itemCount} 项记录</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* TAB 4: SAMPLING LOGS */}
                    {activeTab === 'HISTORY' && (
                        <div className="space-y-2">
                            <div className="text-[9px] text-slate-400 font-bold flex items-center justify-between">
                                <span>⏱️ DOM 节点历史采样趋势记录</span>
                                <span className="text-slate-500 text-[8px]">{historyLogs.length} 条采样</span>
                            </div>
                            <div className="max-h-[200px] overflow-y-auto custom-scrollbar border border-slate-800 rounded bg-slate-950/60 p-1">
                                {historyLogs.length === 0 ? (
                                    <div className="text-center text-slate-600 py-3">采样记录生成中...</div>
                                ) : (
                                    <table className="w-full text-left text-[8px] font-mono border-collapse">
                                        <thead>
                                            <tr className="text-slate-500 border-b border-slate-800">
                                                <th className="py-1 px-1">时间</th>
                                                <th className="py-1 px-1">DOM 总数</th>
                                                <th className="py-1 px-1">大头模块</th>
                                                <th className="py-1 px-1 text-right">状态评估</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyLogs.map((log, idx) => (
                                                <tr key={idx} className="border-b border-slate-900/60 hover:bg-slate-900/40">
                                                    <td className="py-1 px-1 text-slate-400">{log.timeStr}</td>
                                                    <td className="py-1 px-1 font-bold text-slate-200">{log.totalNodes.toLocaleString()}</td>
                                                    <td className="py-1 px-1 text-slate-400 truncate max-w-[130px]">{log.highestModule} ({log.highestCount})</td>
                                                    <td className="py-1 px-1 text-right">
                                                        {log.status === 'DANGER' ? (
                                                            <span className="text-red-400 font-bold">🔴 严重超标</span>
                                                        ) : log.status === 'WARN' ? (
                                                            <span className="text-amber-400 font-bold">🟡 偏高</span>
                                                        ) : (
                                                            <span className="text-emerald-400">🟢 正常</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="text-[8px] text-slate-500 text-center border-t border-slate-800/80 pt-1">
                        💡 提示：后台策略全速全量运行，点击【一键优化】仅限制前台物理 DOM 渲染项数，不影响任何选币与开仓。
                    </div>
                </div>
            )}
        </div>
    );
};
